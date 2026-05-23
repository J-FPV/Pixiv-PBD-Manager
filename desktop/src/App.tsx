import {
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderSearch,
  Globe,
  Image as ImageIcon,
  Key,
  List,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  UserPlus,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";

import {
  browsePath,
  GuiApiCancelledError,
  getProjectRoot,
  getPythonCommand,
  runGuiApi,
  setProjectRoot,
  setPythonCommand
} from "./api";
import type { PathPickKind, TaskControls } from "./api";
import { t } from "./i18n";
import type {
  ApiEvent,
  AppSettings,
  Artist,
  ArtistsPayload,
  DownloadResult,
  Language,
  LogEntry,
  ScanApplyPayload,
  ScanChange,
  ScanChangeKind,
  ScanPreviewPayload,
  SettingsPayload,
  SimilarEntry,
  SimilarGroup,
  SimilarResult,
  SimilarThreshold,
  TabKey,
  UnmatchedFolder,
  UpdateResult
} from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  language: "zh",
  database: ".pixiv-pbd-manager/artists.json",
  download_roots: [],
  exclude_roots: [],
  delay: 1,
  limit: 10,
  watch_interval: 30,
  resolve_online: true,
  resolve_limit: 3,
  fuzzy_search: false,
  fuzzy_min_score: 0.35,
  ssl_fallback: true,
  similar_threshold: "likely",
  similar_skip_pixiv_pages: false,
  scan_local_subfolders: false,
  update_check_pages: 0,
  separate_r18: false,
  show_progress_percent: true
};

const UI_STATE_KEY = "pixiv-pbd-manager.uiState.v1";
const WINDOW_STATE_KEY = "pixiv-pbd-manager.windowState.v1";
const UNMATCHED_CACHE_KEY = "pixiv-pbd-manager.unmatchedFolders.v1";
const SIMILAR_RESULT_CACHE_KEY = "pixiv-pbd-manager.similarResult.v1";
const VALID_TABS: TabKey[] = ["artists", "unmatched", "similar", "settings", "logs"];

interface PersistedUiState {
  activeTab?: TabKey;
  filter?: string;
  similarRoots?: string;
  similarExcludes?: string;
  similarRootBoxHeight?: number;
  similarExcludeBoxHeight?: number;
  similarSkipPixivPages?: boolean;
  expandedGroups?: number[];
}

interface SavedWindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximized?: boolean;
}

interface ImageThumbnailPayload {
  path: string;
  data_url: string;
  width: number;
  height: number;
}

const thumbnailCache = new Map<string, ImageThumbnailPayload>();

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be full when a very large similar-image report is cached.
  }
}

function normalizedUiState(): PersistedUiState {
  const state = loadJson<PersistedUiState>(UI_STATE_KEY, {});
  return {
    ...state,
    activeTab: VALID_TABS.includes(state.activeTab as TabKey) ? state.activeTab : "artists",
    similarRootBoxHeight: clampTextareaHeight(state.similarRootBoxHeight),
    similarExcludeBoxHeight: clampTextareaHeight(state.similarExcludeBoxHeight),
    similarSkipPixivPages: typeof state.similarSkipPixivPages === "boolean" ? state.similarSkipPixivPages : undefined,
    expandedGroups: Array.isArray(state.expandedGroups)
      ? state.expandedGroups.filter((item) => Number.isFinite(Number(item))).map(Number)
      : []
  };
}

const INITIAL_UI_STATE = normalizedUiState();

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function savedWindowSize(state: SavedWindowState | null): { width: number; height: number } {
  return {
    width: finiteNumber(state?.width) && state.width >= 980 ? state.width : 1180,
    height: finiteNumber(state?.height) && state.height >= 660 ? state.height : 800
  };
}

function windowIntersectsWorkArea(
  state: SavedWindowState,
  monitor: { workArea: { position: PhysicalPosition; size: PhysicalSize } }
): boolean {
  if (!finiteNumber(state.x) || !finiteNumber(state.y)) {
    return false;
  }
  const { width, height } = savedWindowSize(state);
  const area = monitor.workArea;
  const overlapWidth =
    Math.min(state.x + width, area.position.x + area.size.width) - Math.max(state.x, area.position.x);
  const overlapHeight =
    Math.min(state.y + height, area.position.y + area.size.height) - Math.max(state.y, area.position.y);
  return overlapWidth >= Math.min(180, width) && overlapHeight >= Math.min(120, height);
}

function centeredPositionForMonitor(
  state: SavedWindowState | null,
  monitor: { workArea: { position: PhysicalPosition; size: PhysicalSize } } | undefined
): PhysicalPosition | null {
  if (!monitor) {
    return null;
  }
  const { width, height } = savedWindowSize(state);
  const area = monitor.workArea;
  const x = area.position.x + Math.max(0, Math.round((area.size.width - width) / 2));
  const y = area.position.y + Math.max(0, Math.round((area.size.height - height) / 2));
  return new PhysicalPosition(x, y);
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(values: string[] | undefined): string {
  return (values || []).join("\n");
}

function isPathInside(target: string, root: string): boolean {
  const norm = (value: string) => value.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  const t = norm(target);
  const r = norm(root);
  return t === r || t.startsWith(`${r}/`);
}

function isUnsafeUserDataDir(value: string, roots: string[]): boolean {
  if (!value.trim()) {
    return false;
  }
  return roots.some((root) => root.trim() && isPathInside(value, root));
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  for (const unit of units) {
    if (size < 1024 || unit === "GB") {
      return unit === "B" ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`;
    }
    size /= 1024;
  }
  return `${value} B`;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampTextareaHeight(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(56, Math.min(480, Math.round(parsed)));
}

function progressText(language: Language, event: ApiEvent): string | null {
  if (event.type === "error") {
    return `${t(language, "error")}: ${event.message}`;
  }
  if (event.type !== "progress") {
    return null;
  }
  const p = event.payload;
  switch (event.key) {
    case "progress_scan_start":
      return `Scan started: ${p.roots} folder(s)`;
    case "progress_scan_files":
      return `Scan: ${p.files} files, ${p.matched} matched, ${p.name_only} name-only`;
    case "progress_scan_done":
      return `Scan done: ${p.files} files, ${p.matched} matched`;
    case "progress_resolve_artist":
    case "progress_fuzzy_artist":
      return `Resolve: ${p.current}/${p.total} ${p.name}`;
    case "progress_check_start":
      return `Checking ${p.total} artist(s)`;
    case "progress_check_artist":
      return `Checking: ${p.current}/${p.total} ${p.artist}`;
    case "progress_check_found":
      return `Updates: ${p.artist} ${p.count}`;
    case "progress_download_start":
      return `Downloading ${p.artists} artist(s), ${p.total_works ?? 0} artwork(s)`;
    case "progress_download_artist":
      return `Downloading: ${p.current}/${p.total} ${p.artist}`;
    case "progress_download_work":
      return `Artwork: ${p.current}/${p.total} ${p.work_id}`;
    case "progress_download_file_start":
    case "progress_download_file_progress":
    case "progress_download_file_done":
    case "progress_download_work_done":
      return null;
    case "progress_download_error":
      return `${t(language, "error")}: ${p.work_id} - ${p.error}`;
    case "progress_similar_start":
      return `Similar scan started: ${p.roots} folder(s)`;
    case "progress_similar_file_start":
      return `Similar processing: ${p.files}/${p.total_files ?? "?"} ${p.name ?? ""}`;
    case "progress_similar_files":
      return `Similar: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused, ${p.errors} errors`;
    case "progress_similar_index_saved":
      return `Similar index saved: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused`;
    case "progress_similar_match_start":
      return `Similar matching started: ${p.total} indexed image(s)`;
    case "progress_similar_match":
      return `Similar matching: ${p.current}/${p.total}, ${p.pairs} candidate pair(s)`;
    case "progress_similar_done":
      return `Similar done: ${p.files} files, ${p.indexed} indexed, ${p.groups} groups`;
    default:
      return `${event.key}: ${JSON.stringify(p)}`;
  }
}

function Button({
  children,
  icon,
  disabled,
  onClick,
  variant = "default"
}: {
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "default" | "primary" | "quiet" | "danger";
}) {
  return (
    <button className={`button ${variant}`} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

interface ProgressLineState {
  label: string;
  current: number;
  total: number;
  indeterminate?: boolean;
  speedBps?: number;
}

interface TaskProgressState {
  main: ProgressLineState;
  file?: ProgressLineState;
}

function ProgressLine({
  line,
  showPercent
}: {
  line: ProgressLineState;
  showPercent: boolean;
}) {
  const percent = line.total > 0 ? Math.max(0, Math.min(100, (line.current / line.total) * 100)) : 0;
  const percentText = showPercent && !line.indeterminate && line.total > 0 ? `${percent.toFixed(0)}%` : "";
  const speedText = line.speedBps && line.speedBps > 0 ? `${formatBytes(line.speedBps)}/s` : "";
  const meterText = [percentText, speedText].filter(Boolean).join(" · ");
  const fullText = meterText ? `${line.label} (${meterText})` : line.label;
  return (
    <div className="progressLine">
      <span className="progressLabel" title={fullText}>
        {line.label}
      </span>
      <div className={`progressTrack ${line.indeterminate ? "indeterminate" : ""}`}>
        <div className="progressFill" style={{ width: line.indeterminate ? undefined : `${percent}%` }} />
      </div>
      <span className="progressMeter" title={meterText}>
        {meterText}
      </span>
    </div>
  );
}

interface PromptField {
  key: string;
  label: string;
  value: string;
  browse?: PathPickKind;
}

interface PromptState {
  title: string;
  fields: PromptField[];
  onSubmit: (values: Record<string, string>) => void;
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

function PromptModal({ language, state, onClose }: { language: Language; state: PromptState; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(state.fields.map((field) => [field.key, field.value]))
  );

  const submit = () => {
    state.onSubmit(values);
    onClose();
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3>{state.title}</h3>
        {state.fields.map((field, index) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <div className={field.browse ? "pathRow" : undefined}>
              <input
                autoFocus={index === 0}
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submit();
                  }
                }}
              />
              {field.browse ? (
                <button
                  type="button"
                  className="button browseButton"
                  onClick={async () => {
                    const picked = await browsePath(field.browse!);
                    if (picked) {
                      setValues((current) => ({ ...current, [field.key]: picked }));
                    }
                  }}
                >
                  {t(language, "browse")}
                </button>
              ) : null}
            </div>
          </label>
        ))}
        <div className="modalActions">
          <Button onClick={onClose}>{t(language, "cancel")}</Button>
          <Button variant="primary" onClick={submit}>
            {t(language, "ok")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ language, state, onClose }: { language: Language; state: ConfirmState; onClose: () => void }) {
  const confirm = () => {
    onClose();
    void state.onConfirm();
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal confirmModal" onClick={(event) => event.stopPropagation()}>
        <h3>{state.title}</h3>
        <div className="confirmBody">{state.body}</div>
        <div className="modalActions">
          <Button onClick={onClose}>{t(language, "cancel")}</Button>
          <Button variant="danger" onClick={confirm}>
            {state.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DisclaimerModal({
  language,
  mode,
  onAccept,
  onClose
}: {
  language: Language;
  mode: "accept" | "view";
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal disclaimerModal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, "disclaimerTitle")}</h3>
        <div className="disclaimerBody">{t(language, "disclaimerBody")}</div>
        <div className="modalActions">
          {mode === "accept" ? (
            <>
              <Button onClick={onClose}>{t(language, "cancel")}</Button>
              <Button variant="primary" onClick={onAccept}>
                {t(language, "accept")}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onClose}>
              {t(language, "close")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type ArtistSortKey = "id" | "name" | "works" | "new_works";
type SortDirection = "asc" | "desc";

function ScanPreviewModal({
  language,
  preview,
  onApply,
  onCancel
}: {
  language: Language;
  preview: ScanPreviewPayload;
  onApply: (operations: ScanChange[]) => void;
  onCancel: () => void;
}) {
  const defaultSelected = (kind: ScanChangeKind) => kind === "new_artist" || kind === "add_work_ids";
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const change of preview.changes) {
      init[change.id] = defaultSelected(change.kind);
    }
    return init;
  });

  const toggle = (id: string) =>
    setSelected((current) => ({ ...current, [id]: !current[id] }));

  const setGroupSelected = (kind: ScanChangeKind, value: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      for (const change of preview.changes) {
        if (change.kind === kind) {
          next[change.id] = value;
        }
      }
      return next;
    });
  };

  const setAllSelected = (value: boolean) => {
    setSelected((current) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(current)) {
        next[key] = value;
      }
      return next;
    });
  };

  const titleFor = (kind: ScanChangeKind) => {
    switch (kind) {
      case "new_artist":
        return t(language, "scanGroupNewArtist");
      case "name_change":
        return t(language, "scanGroupNameChange");
      case "add_save_paths":
        return t(language, "scanGroupAddSavePaths");
      case "add_work_ids":
        return t(language, "scanGroupAddWorkIds");
    }
  };

  const groupKinds: ScanChangeKind[] = ["new_artist", "add_work_ids", "name_change", "add_save_paths"];
  const groups = groupKinds
    .map((kind) => ({ kind, items: preview.changes.filter((change) => change.kind === kind) }))
    .filter((group) => group.items.length > 0);

  const accepted = preview.changes.filter((change) => selected[change.id]);
  const selectedCount = accepted.length;

  const renderDetail = (change: ScanChange) => {
    if (change.kind === "new_artist") {
      const savePath = change.save_paths[0] || "";
      return (
        <>
          <span className="scanChangeName">{change.name || "—"}</span>
          <span className="scanChangeDetail">
            {change.work_ids.length} {t(language, "scanWorksLabel")}
            {savePath ? ` · ${savePath}` : ""}
          </span>
        </>
      );
    }
    if (change.kind === "name_change") {
      return (
        <span className="scanChangeDetail warning">
          {t(language, "scanExistingName")}: "{change.old_name || "—"}" → {t(language, "scanNewName")}: "{change.new_name}"
        </span>
      );
    }
    if (change.kind === "add_save_paths") {
      const first = change.paths[0] || "";
      const extra = change.paths.length > 1 ? ` (+${change.paths.length - 1})` : "";
      return (
        <>
          <span className="scanChangeName">{change.name || "—"}</span>
          <span className="scanChangeDetail warning" title={change.paths.join("\n")}>
            {t(language, "scanNewlyAdded")} {first}{extra}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="scanChangeName">{change.name || "—"}</span>
        <span className="scanChangeDetail">
          {t(language, "scanNewlyAdded")} {change.work_ids.length} {t(language, "scanWorksLabel")} · {t(language, "scanExistingWorks")} {change.existing_count}
        </span>
      </>
    );
  };

  return (
    <div className="modalOverlay" onClick={onCancel}>
      <div className="modal scanPreviewModal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, "scanPreviewTitle")}</h3>
        <p className="fieldHint">{t(language, "scanPreviewSummary")}</p>
        <div className="scanPreviewToolbar">
          <Button onClick={() => setAllSelected(true)}>{t(language, "scanSelectAll")}</Button>
          <Button onClick={() => setAllSelected(false)}>{t(language, "scanDeselectAll")}</Button>
          <span className="summary">
            {selectedCount} / {preview.changes.length}
          </span>
        </div>
        <div className="scanPreviewList">
          {groups.map((group) => (
            <div key={group.kind} className="scanGroup">
              <div className="scanGroupHeader">
                <span className="scanGroupTitle">
                  {titleFor(group.kind)} ({group.items.length})
                </span>
                <button type="button" className="button quiet" onClick={() => setGroupSelected(group.kind, true)}>
                  {t(language, "scanGroupSelectAll")}
                </button>
                <button type="button" className="button quiet" onClick={() => setGroupSelected(group.kind, false)}>
                  {t(language, "scanGroupDeselectAll")}
                </button>
              </div>
              {group.items.map((change) => (
                <label key={change.id} className="scanChangeRow">
                  <input
                    type="checkbox"
                    checked={!!selected[change.id]}
                    onChange={() => toggle(change.id)}
                  />
                  <span className="scanChangeId">{change.artist_id}</span>
                  <div className="scanChangeMain">{renderDetail(change)}</div>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="modalActions">
          <Button onClick={onCancel}>{t(language, "cancel")}</Button>
          <Button variant="primary" onClick={() => onApply(accepted)} disabled={accepted.length === 0}>
            {t(language, "scanApply")} ({accepted.length})
          </Button>
        </div>
      </div>
    </div>
  );
}

function ArtistsView({
  language,
  artists,
  selected,
  filter,
  busy,
  setFilter,
  toggleArtist,
  selectAll,
  clearAll,
  scan,
  checkUpdates,
  downloadUpdated,
  openSelected,
  copyUrls,
  removeSelectedArtists,
  addArtist,
  editArtistId,
  editSavePath,
  openArtist,
  openPath
}: {
  language: Language;
  artists: Artist[];
  selected: Set<string>;
  filter: string;
  busy: boolean;
  setFilter: (value: string) => void;
  toggleArtist: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearAll: () => void;
  scan: () => void;
  checkUpdates: () => void;
  downloadUpdated: () => void;
  openSelected: () => void;
  copyUrls: () => void;
  removeSelectedArtists: () => void;
  addArtist: () => void;
  editArtistId: (id: string) => void;
  editSavePath: (id: string) => void;
  openArtist: (id: string) => void;
  openPath: (path: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; artistId: string } | null>(null);
  const [sortKey, setSortKey] = useState<ArtistSortKey>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const openMenu = (event: ReactMouseEvent, artistId: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, artistId });
  };
  const changeSort = (key: ArtistSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };
  const sortHeader = (key: ArtistSortKey, label: string, align: "left" | "right" = "left") => (
    <button className={`headerButton ${align === "right" ? "numericHeader" : ""}`} onClick={() => changeSort(key)}>
      <span>{label}</span>
      <span className={`sortArrow ${sortKey === key ? "active" : ""}`}>
        {sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : ""}
      </span>
    </button>
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const visibleArtists = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
      ? artists.filter((artist) => {
          const savePathText = artist.save_paths.join(" ").toLowerCase();
          const folderNames = artist.save_paths
            .map((path) => path.split(/[\\/]/).filter(Boolean).pop() || "")
            .join(" ")
            .toLowerCase();
          return (
            artist.id.includes(keyword) ||
            artist.name.toLowerCase().includes(keyword) ||
            savePathText.includes(keyword) ||
            folderNames.includes(keyword)
          );
        })
      : artists;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      let result = 0;
      if (sortKey === "id") {
        result = left.id.localeCompare(right.id, undefined, { numeric: true });
      } else if (sortKey === "name") {
        result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortKey === "works") {
        result = left.works - right.works;
      } else {
        result = left.new_works - right.new_works;
      }
      if (result === 0) {
        result = left.id.localeCompare(right.id, undefined, { numeric: true });
      }
      return result * direction;
    });
  }, [artists, filter, sortDirection, sortKey]);

  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [filter, sortDirection, sortKey]);

  const virtualizer = useVirtualizer({
    count: visibleArtists.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 14
  });

  return (
    <section className="panel">
      <div className="toolbar">
        <div className="searchBox">
          <Search size={16} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t(language, "search")} />
          {filter ? (
            <button className="searchClear" title={t(language, "clearSearch")} onClick={() => setFilter("")}>
              <XCircle size={16} />
            </button>
          ) : null}
        </div>
        <Button icon={<CheckSquare size={16} />} onClick={() => selectAll(visibleArtists.map((artist) => artist.id))}>
          {t(language, "selectAll")}
        </Button>
        <Button icon={<Square size={16} />} onClick={clearAll}>
          {t(language, "clearAll")}{selected.size ? ` (${selected.size})` : ""}
        </Button>
        <Button icon={<Play size={16} />} disabled={busy} onClick={scan} variant="primary">
          {t(language, "scan")}
        </Button>
        <Button icon={<RefreshCw size={16} />} disabled={busy} onClick={checkUpdates}>
          {t(language, "checkUpdates")}
        </Button>
        <Button icon={<Download size={16} />} disabled={busy} onClick={downloadUpdated}>
          {t(language, "downloadUpdated")}
        </Button>
        <Button icon={<Plus size={16} />} onClick={addArtist}>
          {t(language, "addArtist")}
        </Button>
        <Button icon={<Copy size={16} />} onClick={copyUrls}>
          {t(language, "copyUrls")}
        </Button>
        <Button icon={<ExternalLink size={16} />} onClick={openSelected}>
          {t(language, "openSelected")}
        </Button>
        <span className="toolbarSpacer" />
        <Button icon={<Trash2 size={16} />} disabled={busy || selected.size === 0} onClick={removeSelectedArtists} variant="danger">
          {t(language, "removeSelectedArtists")}{selected.size ? ` (${selected.size})` : ""}
        </Button>
      </div>

      <div className="table artistsTable">
        <div className="tableHeader">
          <span />
          {sortHeader("id", t(language, "artistId"))}
          {sortHeader("name", t(language, "artistName"))}
          {sortHeader("works", t(language, "works"), "right")}
          {sortHeader("new_works", t(language, "newWorks"), "right")}
          <span>{t(language, "savePaths")}</span>
          <span>{t(language, "lastSeen")}</span>
        </div>
        <div className="virtualList" ref={parentRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const artist = visibleArtists[row.index];
              const checked = selected.has(artist.id);
              return (
                <button
                  className={`tableRow artistRow ${checked ? "checked" : ""}`}
                  key={artist.id}
                  style={{ transform: `translateY(${row.start}px)` }}
                  onClick={() => toggleArtist(artist.id)}
                  onDoubleClick={() => openArtist(artist.id)}
                  onContextMenu={(event) => openMenu(event, artist.id)}
                >
                  <span className="checkbox">{checked ? <CheckSquare size={17} /> : <Square size={17} />}</span>
                  <span>{artist.id}</span>
                  <span>{artist.name}</span>
                  <span className="numeric">{artist.works}</span>
                  <span className="numeric strong">{artist.new_works}</span>
                  <span
                    className={`pathText ${artist.save_paths.length ? "clickablePath" : ""}`}
                    title={artist.save_paths[0] || ""}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (artist.save_paths[0]) {
                        openPath(artist.save_paths[0]);
                      }
                    }}
                  >
                    {artist.save_paths.join("; ")}
                  </span>
                  <span>{artist.last_seen}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {menu ? (
        <div className="menuOverlay" onClick={() => setMenu(null)} onContextMenu={(event) => event.preventDefault()}>
          <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => {
                editArtistId(menu.artistId);
                setMenu(null);
              }}
            >
              <Pencil size={15} />
              <span>{t(language, "editArtistId")}</span>
            </button>
            <button
              onClick={() => {
                editSavePath(menu.artistId);
                setMenu(null);
              }}
            >
              <FolderOpen size={15} />
              <span>{t(language, "editSavePath")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type SimilarRow =
  | { type: "group"; group: SimilarGroup }
  | { type: "entry"; group: SimilarGroup; entry: SimilarEntry };

function SimilarThumbnail({
  language,
  path,
  onPreview
}: {
  language: Language;
  path: string;
  onPreview: (path: string) => void;
}) {
  const [thumbnail, setThumbnail] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(path) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = thumbnailCache.get(path);
    if (cached) {
      setThumbnail(cached);
      setFailed(false);
      return () => {
        cancelled = true;
      };
    }
    setThumbnail(null);
    setFailed(false);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path, max_size: 144 })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        thumbnailCache.set(path, payload);
        setThumbnail(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <button
      type="button"
      className="thumbnailButton"
      title={t(language, "openPreview")}
      onClick={(event) => {
        event.stopPropagation();
        onPreview(path);
      }}
    >
      {thumbnail ? (
        <img src={thumbnail.data_url} alt={t(language, "preview")} loading="lazy" />
      ) : (
        <span className="thumbnailPlaceholder">{failed ? "!" : "..."}</span>
      )}
    </button>
  );
}

function ImagePreviewModal({
  language,
  path,
  onClose,
  revealFile
}: {
  language: Language;
  path: string;
  onClose: () => void;
  revealFile: (path: string) => void;
}) {
  const [image, setImage] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(path) || null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path, max_size: 1200 })
      .then((payload) => {
        if (!cancelled) {
          setImage(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal imagePreviewModal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, "preview")}</h3>
        <div className="imagePreviewBody">
          {image ? <img src={image.data_url} alt={path} /> : <span>{t(language, "loadingPreview")}</span>}
          {error ? <span className="previewError">{error}</span> : null}
        </div>
        <div className="imagePreviewPath" title={path}>{path}</div>
        <div className="modalActions">
          <Button onClick={() => revealFile(path)}>{t(language, "openFolder")}</Button>
          <Button variant="primary" onClick={onClose}>{t(language, "close")}</Button>
        </div>
      </div>
    </div>
  );
}

function SimilarView({
  language,
  result,
  threshold,
  skipPixivPages,
  busy,
  expanded,
  roots,
  excludes,
  rootBoxHeight,
  excludeBoxHeight,
  setRoots,
  setExcludes,
  setRootBoxHeight,
  setExcludeBoxHeight,
  setThreshold,
  setSkipPixivPages,
  findSimilar,
  toggleGroup,
  revealFile
}: {
  language: Language;
  result: SimilarResult | null;
  threshold: SimilarThreshold;
  skipPixivPages: boolean;
  busy: boolean;
  expanded: Set<number>;
  roots: string;
  excludes: string;
  rootBoxHeight?: number;
  excludeBoxHeight?: number;
  setRoots: (value: string) => void;
  setExcludes: (value: string) => void;
  setRootBoxHeight: (value: number | undefined) => void;
  setExcludeBoxHeight: (value: number | undefined) => void;
  setThreshold: (value: SimilarThreshold) => void;
  setSkipPixivPages: (value: boolean) => void;
  findSimilar: () => void;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rootTextareaRef = useRef<HTMLTextAreaElement>(null);
  const excludeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const rows = useMemo<SimilarRow[]>(() => {
    const output: SimilarRow[] = [];
    for (const group of result?.groups || []) {
      output.push({ type: "group", group });
      if (expanded.has(group.id)) {
        for (const entry of group.entries) {
          output.push({ type: "entry", group, entry });
        }
      }
    }
    return output;
  }, [result, expanded]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === "entry" ? 76 : 42),
    overscan: 14
  });

  const appendFolder = async (value: string, setter: (next: string) => void) => {
    const picked = await browsePath("folder");
    if (!picked) {
      return;
    }
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.includes(picked)) {
      setter([...lines, picked].join("\n"));
    }
  };

  const rememberTextareaHeight = (
    ref: RefObject<HTMLTextAreaElement | null>,
    setter: (value: number | undefined) => void
  ) => {
    setter(clampTextareaHeight(ref.current?.offsetHeight));
  };

  return (
    <section className="panel">
      <div className="similarHeader">
        <div className="similarPaths">
          <label>
            <span>{t(language, "similarRoots")}</span>
            <textarea
              ref={rootTextareaRef}
              value={roots}
              onChange={(event) => setRoots(event.target.value)}
              onMouseUp={() => rememberTextareaHeight(rootTextareaRef, setRootBoxHeight)}
              onBlur={() => rememberTextareaHeight(rootTextareaRef, setRootBoxHeight)}
              placeholder={t(language, "similarRootsHint")}
              style={rootBoxHeight ? { height: rootBoxHeight } : undefined}
            />
            <button type="button" className="button browseButton" onClick={() => void appendFolder(roots, setRoots)}>
              {t(language, "addFolder")}
            </button>
          </label>
          <label>
            <span>{t(language, "excludeRoots")}</span>
            <textarea
              ref={excludeTextareaRef}
              value={excludes}
              onChange={(event) => setExcludes(event.target.value)}
              onMouseUp={() => rememberTextareaHeight(excludeTextareaRef, setExcludeBoxHeight)}
              onBlur={() => rememberTextareaHeight(excludeTextareaRef, setExcludeBoxHeight)}
              style={excludeBoxHeight ? { height: excludeBoxHeight } : undefined}
            />
            <button type="button" className="button browseButton" onClick={() => void appendFolder(excludes, setExcludes)}>
              {t(language, "addFolder")}
            </button>
          </label>
        </div>
        <div className="toolbar">
          <div className="segmented">
            <button className={threshold === "likely" ? "active" : ""} onClick={() => setThreshold("likely")}>
              {t(language, "likely")}
            </button>
            <button className={threshold === "possible" ? "active" : ""} onClick={() => setThreshold("possible")}>
              {t(language, "possible")}
            </button>
          </div>
          <label className="checkLine compactCheck">
            <input
              type="checkbox"
              checked={skipPixivPages}
              onChange={(event) => setSkipPixivPages(event.target.checked)}
            />
            <span>{t(language, "skipPixivPages")}</span>
          </label>
          <Button icon={<ImageIcon size={16} />} disabled={busy} onClick={findSimilar} variant="primary">
            {t(language, "findSimilar")}
          </Button>
          {result ? (
            <span className="summary">
              {result.files_seen} files / {result.indexed} indexed / {result.groups.length} groups / {result.error_count} errors
            </span>
          ) : null}
        </div>
      </div>

      <div className="table similarTable">
        <div className="tableHeader">
          <span>{t(language, "group")}</span>
          <span>{t(language, "kind")}</span>
          <span>{t(language, "preview")}</span>
          <span>{t(language, "path")}</span>
          <span>{t(language, "resolution")}</span>
          <span>{t(language, "size")}</span>
        </div>
        <div className="virtualList" ref={parentRef}>
          {rows.length ? (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = rows[row.index];
                if (item.type === "group") {
                  const isExpanded = expanded.has(item.group.id);
                  return (
                    <button
                      className="tableRow similarGroupRow"
                      key={`group-${item.group.id}`}
                      style={{ transform: `translateY(${row.start}px)` }}
                      onClick={() => toggleGroup(item.group.id)}
                    >
                      <span>{isExpanded ? "v" : ">"} {t(language, "group")} {item.group.id}</span>
                      <span>{t(language, item.group.kind === "exact" ? "exact" : item.group.kind)}</span>
                      <span />
                      <span>{item.group.entries.length} files, pHash {item.group.best_phash_distance}, dHash {item.group.best_dhash_distance}</span>
                      <span />
                      <span />
                    </button>
                  );
                }
                return (
                  <div
                    className="tableRow similarEntryRow"
                    key={`${item.group.id}-${item.entry.path}`}
                    style={{ transform: `translateY(${row.start}px)` }}
                    onDoubleClick={() => revealFile(item.entry.path)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        revealFile(item.entry.path);
                      }
                    }}
                  >
                    <span />
                    <span />
                    <SimilarThumbnail language={language} path={item.entry.path} onPreview={setPreviewPath} />
                    <span className="pathText">{item.entry.path}</span>
                    <span>{item.entry.resolution}</span>
                    <span className="numeric">{formatBytes(item.entry.size_bytes)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="emptyState">{t(language, "empty")}</div>
          )}
        </div>
      </div>
      {previewPath ? (
        <ImagePreviewModal
          language={language}
          path={previewPath}
          onClose={() => setPreviewPath(null)}
          revealFile={revealFile}
        />
      ) : null}
    </section>
  );
}

type SettingsSection = "general" | "folders" | "scan" | "browser" | "cookie";

function SettingsView({
  language,
  settings,
  cookieConsent,
  pixivCookie,
  projectRoot,
  pythonCommand,
  setLanguage,
  setSettings,
  onToggleConsent,
  viewDisclaimer,
  setPixivCookie,
  setProjectRootValue,
  setPythonCommandValue,
  saveSettings,
  notify
}: {
  language: Language;
  settings: AppSettings;
  cookieConsent: boolean;
  pixivCookie: string;
  projectRoot: string;
  pythonCommand: string;
  setLanguage: (value: Language) => void;
  setSettings: (value: AppSettings) => void;
  onToggleConsent: (next: boolean) => void;
  viewDisclaimer: () => void;
  setPixivCookie: (value: string) => void;
  setProjectRootValue: (value: string) => void;
  setPythonCommandValue: (value: string) => void;
  saveSettings: () => void;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [showCookie, setShowCookie] = useState(false);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings({ ...settings, [key]: value });
  };

  const pick = async (kind: PathPickKind, apply: (value: string) => void) => {
    const picked = await browsePath(kind);
    if (picked) {
      apply(picked);
    }
  };

  const appendFolder = async (key: "download_roots" | "exclude_roots") => {
    const picked = await browsePath("folder");
    if (!picked) {
      return;
    }
    const current = settings[key] || [];
    if (!current.includes(picked)) {
      update(key, [...current, picked]);
    }
  };

  const browseButton = (kind: PathPickKind, apply: (value: string) => void) => (
    <button type="button" className="button browseButton" onClick={() => void pick(kind, apply)}>
      {t(language, "browse")}
    </button>
  );

  const pickUserDataDir = async () => {
    const picked = await browsePath("folder");
    if (!picked) {
      return;
    }
    if (isUnsafeUserDataDir(picked, settings.download_roots || [])) {
      notify(t(language, "unsafeUserDataDir"));
      return;
    }
    update("user_data_dir", picked);
  };

  const sections: { key: SettingsSection; label: string; icon: ReactNode }[] = [
    { key: "general", label: t(language, "secGeneral"), icon: <SlidersHorizontal size={16} /> },
    { key: "folders", label: t(language, "secFolders"), icon: <Folder size={16} /> },
    { key: "scan", label: t(language, "secScan"), icon: <Search size={16} /> },
    { key: "browser", label: t(language, "secBrowser"), icon: <Globe size={16} /> },
    { key: "cookie", label: t(language, "secCookie"), icon: <Key size={16} /> }
  ];

  return (
    <section className="panel settingsPanel">
      <div className="settingsLayout">
        <nav className="settingsNav">
          {sections.map((item) => (
            <button
              className={section === item.key ? "active" : ""}
              key={item.key}
              onClick={() => setSection(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settingsContent">
          {section === "general" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secGeneral")}</h3>
              <div className="fieldGrid">
                <label>
                  <span>{t(language, "language")}</span>
                  <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  <span>{t(language, "pythonCommand")}</span>
                  <select value={pythonCommand === "py" ? "py" : "python"} onChange={(event) => setPythonCommandValue(event.target.value)}>
                    <option value="python">python</option>
                    <option value="py">py</option>
                  </select>
                </label>
                <label className="full">
                  <span>{t(language, "projectRoot")}</span>
                  <div className="pathRow">
                    <input value={projectRoot} onChange={(event) => setProjectRootValue(event.target.value)} />
                    {browseButton("folder", setProjectRootValue)}
                  </div>
                </label>
                <label className="full">
                  <span>{t(language, "database")}</span>
                  <div className="pathRow">
                    <input value={settings.database || ""} onChange={(event) => update("database", event.target.value)} />
                    {browseButton("save", (value) => update("database", value))}
                  </div>
                </label>
              </div>
              <div className="checkColumn">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.show_progress_percent !== false}
                    onChange={(event) => update("show_progress_percent", event.target.checked)}
                  />
                  <span>{t(language, "showProgressPercent")}</span>
                </label>
              </div>
            </div>
          ) : null}

          {section === "folders" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secFolders")}</h3>
              <div className="fieldGrid">
                <label className="full">
                  <span>{t(language, "downloadRoots")}</span>
                  <textarea
                    value={joinLines(settings.download_roots)}
                    onChange={(event) => update("download_roots", splitLines(event.target.value))}
                  />
                  <button type="button" className="button browseButton" onClick={() => void appendFolder("download_roots")}>
                    {t(language, "addFolder")}
                  </button>
                </label>
                <label className="full">
                  <span>{t(language, "excludeRoots")}</span>
                  <textarea
                    value={joinLines(settings.exclude_roots)}
                    onChange={(event) => update("exclude_roots", splitLines(event.target.value))}
                  />
                  <button type="button" className="button browseButton" onClick={() => void appendFolder("exclude_roots")}>
                    {t(language, "addFolder")}
                  </button>
                </label>
              </div>
              <div className="checkColumn">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.separate_r18)}
                    onChange={(event) => update("separate_r18", event.target.checked)}
                  />
                  <span>{t(language, "separateR18")}</span>
                </label>
              </div>
              <p className="fieldHint">{t(language, "separateR18Hint")}</p>
            </div>
          ) : null}

          {section === "scan" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secScan")}</h3>
              <div className="checkColumn">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.resolve_online)}
                    onChange={(event) => update("resolve_online", event.target.checked)}
                  />
                  <span>{t(language, "resolveOnline")}</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.fuzzy_search)}
                    onChange={(event) => update("fuzzy_search", event.target.checked)}
                  />
                  <span>{t(language, "fuzzySearch")}</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.ssl_fallback)}
                    onChange={(event) => update("ssl_fallback", event.target.checked)}
                  />
                  <span>{t(language, "sslFallback")}</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.scan_local_subfolders)}
                    onChange={(event) => update("scan_local_subfolders", event.target.checked)}
                  />
                  <span>{t(language, "scanLocalSubfolders")}</span>
                </label>
              </div>
              <p className="fieldHint">{t(language, "scanLocalHint")}</p>
              <div className="fieldGrid">
                <label>
                  <span>{t(language, "resolveLimit")}</span>
                  <input
                    type="number"
                    value={settings.resolve_limit ?? 3}
                    onChange={(event) => update("resolve_limit", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>{t(language, "fuzzyScore")}</span>
                  <input
                    type="number"
                    step="0.05"
                    value={settings.fuzzy_min_score ?? 0.35}
                    onChange={(event) => update("fuzzy_min_score", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>{t(language, "updateCheckPages")}</span>
                  <input
                    type="number"
                    min="0"
                    value={settings.update_check_pages ?? 0}
                    onChange={(event) => update("update_check_pages", Math.max(0, Number(event.target.value) || 0))}
                  />
                </label>
              </div>
              <p className="fieldHint">{t(language, "updateCheckPagesHint")}</p>
            </div>
          ) : null}

          {section === "browser" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secBrowser")}</h3>
              <div className="fieldGrid">
                <label className="full">
                  <span>{t(language, "browser")}</span>
                  <div className="pathRow">
                    <input value={settings.browser || ""} onChange={(event) => update("browser", event.target.value)} />
                    {browseButton("file", (value) => update("browser", value))}
                  </div>
                </label>
                <label className="full">
                  <span>{t(language, "userDataDir")}</span>
                  <div className="pathRow">
                    <input value={settings.user_data_dir || ""} onChange={(event) => update("user_data_dir", event.target.value)} />
                    <button type="button" className="button browseButton" onClick={() => void pickUserDataDir()}>
                      {t(language, "browse")}
                    </button>
                  </div>
                </label>
                <label>
                  <span>{t(language, "delay")}</span>
                  <input type="number" value={settings.delay ?? 1} onChange={(event) => update("delay", Number(event.target.value))} />
                </label>
                <label>
                  <span>{t(language, "limit")}</span>
                  <input type="number" value={settings.limit ?? 10} onChange={(event) => update("limit", Number(event.target.value))} />
                </label>
              </div>
            </div>
          ) : null}

          {section === "cookie" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secCookie")}</h3>
              <div className="consentRow">
                <label className="checkLine">
                  <input type="checkbox" checked={cookieConsent} onChange={(event) => onToggleConsent(event.target.checked)} />
                  <span>{t(language, "cookieConsent")}</span>
                </label>
                <button type="button" className="button browseButton" onClick={viewDisclaimer}>
                  {t(language, "viewDisclaimer")}
                </button>
              </div>
              <p className="fieldHint">{t(language, "cookieHint")}</p>
              <div className="fieldGrid">
                <label className="full">
                  <span>{t(language, "pixivCookie")}</span>
                  <div className="pathRow">
                    <input
                      value={pixivCookie}
                      type={showCookie ? "text" : "password"}
                      onChange={(event) => setPixivCookie(event.target.value)}
                      disabled={!cookieConsent}
                    />
                    <button
                      type="button"
                      className="button browseButton"
                      disabled={!cookieConsent}
                      onClick={() => setShowCookie((value) => !value)}
                    >
                      {t(language, showCookie ? "hideCookie" : "showCookie")}
                    </button>
                  </div>
                </label>
              </div>
            </div>
          ) : null}

          <div className="settingsActions">
            <Button icon={<Save size={16} />} variant="primary" onClick={saveSettings}>
              {t(language, "save")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function UnmatchedView({
  language,
  folders,
  excludeFolder,
  assignFolder
}: {
  language: Language;
  folders: UnmatchedFolder[];
  excludeFolder: (path: string) => void;
  assignFolder: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: folders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 14
  });
  return (
    <section className="panel">
      <div className="toolbar">
        <span className="summary">
          {folders.length ? `${folders.length} ${t(language, "unmatched")}` : t(language, "unmatchedHint")}
        </span>
      </div>
      <div className="table unmatchedTable">
        <div className="tableHeader">
          <span>{t(language, "path")}</span>
          <span>{t(language, "unmatchedCount")}</span>
          <span>{t(language, "actions")}</span>
        </div>
        <div className="virtualList" ref={parentRef}>
          {folders.length ? (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = folders[row.index];
                return (
                  <div
                    className="tableRow unmatchedRow"
                    key={item.path}
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <span className="pathText" title={item.path}>
                      {item.path}
                    </span>
                    <span className="numeric">{item.count}</span>
                    <span className="unmatchedActions">
                      <Button icon={<UserPlus size={14} />} onClick={() => assignFolder(item.path)}>
                        {t(language, "assignArtist")}
                      </Button>
                      <Button icon={<XCircle size={14} />} variant="danger" onClick={() => excludeFolder(item.path)}>
                        {t(language, "excludeFolder")}
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="emptyState">{t(language, "unmatchedHint")}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function LogsView({ logs }: { logs: LogEntry[] }) {
  return (
    <section className="panel logPanel">
      {logs.map((entry) => (
        <div className={`logLine ${entry.level}`} key={entry.id}>
          {entry.message}
        </div>
      ))}
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(INITIAL_UI_STATE.activeTab || "artists");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [language, setLanguageState] = useState<Language>("zh");
  const [cookieConsent, setCookieConsent] = useState(false);
  const [pixivCookie, setPixivCookie] = useState("");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState(INITIAL_UI_STATE.filter || "");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const [paused, setPaused] = useState(false);
  const cancelCurrentTaskRef = useRef<(() => void) | null>(null);
  const pauseCurrentTaskRef = useRef<(() => void) | null>(null);
  const resumeCurrentTaskRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState("Ready");
  const [similarResult, setSimilarResult] = useState<SimilarResult | null>(() =>
    loadJson<SimilarResult | null>(SIMILAR_RESULT_CACHE_KEY, null)
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(
    () => new Set(INITIAL_UI_STATE.expandedGroups || [])
  );
  const [projectRootValue, setProjectRootState] = useState(getProjectRoot());
  const [pythonCommandValue, setPythonCommandState] = useState(getPythonCommand());
  const [similarRoots, setSimilarRoots] = useState(INITIAL_UI_STATE.similarRoots || "");
  const [similarExcludes, setSimilarExcludes] = useState(INITIAL_UI_STATE.similarExcludes || "");
  const [similarRootBoxHeight, setSimilarRootBoxHeight] = useState<number | undefined>(
    INITIAL_UI_STATE.similarRootBoxHeight
  );
  const [similarExcludeBoxHeight, setSimilarExcludeBoxHeight] = useState<number | undefined>(
    INITIAL_UI_STATE.similarExcludeBoxHeight
  );
  const [unmatchedFolders, setUnmatchedFolders] = useState<UnmatchedFolder[]>(() =>
    loadJson<UnmatchedFolder[]>(UNMATCHED_CACHE_KEY, [])
  );
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [disclaimer, setDisclaimer] = useState<"accept" | "view" | null>(null);
  const [scanPreview, setScanPreview] = useState<ScanPreviewPayload | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const toastTimerRef = useRef<number | null>(null);

  const languageValue = settings.language || language;
  const busy = runningTask !== null;

  const appendLog = (level: LogEntry["level"], message: string) => {
    setLogs((current) => [...current.slice(-999), { id: Date.now() + Math.random(), level, message }]);
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, 2400);
  };

  const updateTaskProgress = (event: ApiEvent) => {
    if (event.type !== "progress") {
      return;
    }
    const p = event.payload;
    switch (event.key) {
      case "progress_scan_start":
        setTaskProgress({ main: { label: t(languageValue, "scan"), current: 0, total: 0, indeterminate: true } });
        break;
      case "progress_scan_files":
        setTaskProgress({
          main: {
            label: `${t(languageValue, "scan")}: ${numberValue(p.files)} files`,
            current: 0,
            total: 0,
            indeterminate: true
          }
        });
        break;
      case "progress_scan_done":
        setTaskProgress({ main: { label: t(languageValue, "scan"), current: 1, total: 1 } });
        break;
      case "progress_resolve_artist":
      case "progress_fuzzy_artist":
        setTaskProgress({
          main: {
            label: `${t(languageValue, "scan")}: ${String(p.name ?? "")}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        });
        break;
      case "progress_check_start":
        setTaskProgress({
          main: { label: t(languageValue, "checkUpdates"), current: 0, total: numberValue(p.total) }
        });
        break;
      case "progress_check_artist":
        setTaskProgress({
          main: {
            label: `${t(languageValue, "checkUpdates")}: ${String(p.artist ?? "")}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        });
        break;
      case "progress_download_start":
        setTaskProgress({
          main: {
            label: t(languageValue, "totalProgress"),
            current: 0,
            total: numberValue(p.total_works),
            indeterminate: numberValue(p.total_works) === 0
          }
        });
        break;
      case "progress_download_work":
        setTaskProgress((current) => ({
          main: {
            label: `${t(languageValue, "totalProgress")}: ${String(p.artist ?? "")}`,
            current: Math.max(0, numberValue(p.global_current) - 1),
            total: numberValue(p.global_total)
          },
          file: current?.file
        }));
        break;
      case "progress_download_work_done":
        setTaskProgress((current) => ({
          main: {
            label: t(languageValue, "totalProgress"),
            current: numberValue(p.global_done),
            total: numberValue(p.global_total)
          },
          file: current?.file
        }));
        break;
      case "progress_download_file_start":
      case "progress_download_file_progress":
      case "progress_download_file_done":
        setTaskProgress((current) => ({
          main: current?.main || { label: t(languageValue, "totalProgress"), current: 0, total: 0, indeterminate: true },
          file: {
            label: `${t(languageValue, "currentFile")}: ${String(p.filename ?? p.work_id ?? "")}`,
            current: numberValue(p.downloaded_bytes),
            total: numberValue(p.total_bytes),
            indeterminate: numberValue(p.total_bytes) === 0 && event.key !== "progress_download_file_done",
            speedBps: numberValue(p.speed_bps)
          }
        }));
        break;
      case "progress_similar_start":
        setTaskProgress({ main: { label: t(languageValue, "findSimilar"), current: 0, total: 0, indeterminate: true } });
        break;
      case "progress_similar_file_start":
      case "progress_similar_files":
      case "progress_similar_index_saved":
        {
          const hasTotal = p.total_files !== undefined && p.total_files !== null;
          const totalFiles = numberValue(p.total_files);
          const files = numberValue(p.files);
          setTaskProgress({
            main: {
              label: `${t(languageValue, "findSimilar")}: ${files}/${hasTotal ? totalFiles : "?"} files / ${numberValue(p.indexed)} indexed`,
              current: files,
              total: totalFiles,
              indeterminate: !hasTotal
            }
          });
        }
        break;
      case "progress_similar_match_start":
        setTaskProgress({
          main: {
            label: `${t(languageValue, "findSimilar")}: matching`,
            current: 0,
            total: numberValue(p.total),
            indeterminate: numberValue(p.total) === 0
          }
        });
        break;
      case "progress_similar_match":
        setTaskProgress({
          main: {
            label: `${t(languageValue, "findSimilar")}: matching ${numberValue(p.pairs)} pairs`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        });
        break;
      case "progress_similar_done":
        setTaskProgress({ main: { label: t(languageValue, "findSimilar"), current: 1, total: 1 } });
        break;
      default:
        break;
    }
  };

  const handleEvent = (event: ApiEvent) => {
    updateTaskProgress(event);
    const message = progressText(languageValue, event);
    if (message) {
      appendLog(event.type === "error" ? "error" : "info", message);
      setStatus(message);
    }
  };

  const applySettingsPayload = (payload: SettingsPayload) => {
    const merged = { ...DEFAULT_SETTINGS, ...payload.settings };
    if (
      !Object.prototype.hasOwnProperty.call(payload.settings, "similar_skip_pixiv_pages") &&
      typeof INITIAL_UI_STATE.similarSkipPixivPages === "boolean"
    ) {
      merged.similar_skip_pixiv_pages = INITIAL_UI_STATE.similarSkipPixivPages;
    }
    setSettings(merged);
    setLanguageState((merged.language || "zh") as Language);
    setCookieConsent(payload.cookie_consent);
    setPixivCookie(payload.pixiv_cookie || "");
    setSimilarRoots((current) => current || joinLines(merged.download_roots));
    setSimilarExcludes((current) => current || joinLines(merged.exclude_roots));
    if (payload.project_root) {
      setProjectRootState(payload.project_root);
      setProjectRoot(payload.project_root);
    }
  };

  const loadArtists = async () => {
    const payload = await runGuiApi<ArtistsPayload>("artists.list", {}, handleEvent);
    setArtists(payload.artists);
    if (payload.project_root) {
      setProjectRootState(payload.project_root);
      setProjectRoot(payload.project_root);
    }
  };

  const loadInitial = async () => {
    try {
      const payload = await runGuiApi<SettingsPayload>("settings.get", {}, handleEvent);
      applySettingsPayload(payload);
      const artistPayload = await runGuiApi<ArtistsPayload>("artists.list", {}, handleEvent);
      setArtists(artistPayload.artists);
      if (artistPayload.project_root) {
        setProjectRootState(artistPayload.project_root);
        setProjectRoot(artistPayload.project_root);
      }
      appendLog("info", "Desktop GUI ready");
      setStatus(t(payload.settings.language || "zh", "ready"));
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
      setStatus(t(languageValue, "error"));
    }
  };

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const saved = loadJson<SavedWindowState | null>(WINDOW_STATE_KEY, null);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlistenFns: Array<() => void> = [];

    const restore = async () => {
      if (!saved) {
        return;
      }
      try {
        const size = savedWindowSize(saved);
        const monitors = await availableMonitors();
        const positionIsVisible = monitors.some((monitor) => windowIntersectsWorkArea(saved, monitor));
        await appWindow.setSize(new PhysicalSize(size.width, size.height));
        if (positionIsVisible && finiteNumber(saved.x) && finiteNumber(saved.y)) {
          await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
        } else {
          const centered = centeredPositionForMonitor(saved, monitors[0]);
          if (centered) {
            await appWindow.setPosition(centered);
          }
        }
        if (saved.maximized && positionIsVisible) {
          await appWindow.maximize();
        }
        void save(true);
      } catch (error) {
        console.warn("Failed to restore window state", error);
      }
    };

    const save = async (force = false) => {
      if (disposed && !force) {
        return;
      }
      try {
        const [position, size, maximized] = await Promise.all([
          appWindow.outerPosition(),
          appWindow.outerSize(),
          appWindow.isMaximized()
        ]);
        persistJson(WINDOW_STATE_KEY, {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          maximized
        });
      } catch (error) {
        console.warn("Failed to save window state", error);
      }
    };

    const scheduleSave = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void save();
      }, 250);
    };

    void restore();
    void Promise.all([appWindow.onResized(scheduleSave), appWindow.onMoved(scheduleSave)])
      .then((items) => {
        unlistenFns = items;
      })
      .catch((error) => console.warn("Failed to watch window state", error));

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      unlistenFns.forEach((unlisten) => unlisten());
      void save(true);
    };
  }, []);

  useEffect(() => {
    persistJson(UI_STATE_KEY, {
      activeTab,
      filter,
      similarRoots,
      similarExcludes,
      similarRootBoxHeight,
      similarExcludeBoxHeight,
      similarSkipPixivPages: settings.similar_skip_pixiv_pages,
      expandedGroups: Array.from(expandedGroups)
    });
  }, [
    activeTab,
    filter,
    similarRoots,
    similarExcludes,
    similarRootBoxHeight,
    similarExcludeBoxHeight,
    settings.similar_skip_pixiv_pages,
    expandedGroups
  ]);

  useEffect(() => {
    persistJson(UNMATCHED_CACHE_KEY, unmatchedFolders);
  }, [unmatchedFolders]);

  useEffect(() => {
    persistJson(SIMILAR_RESULT_CACHE_KEY, similarResult);
  }, [similarResult]);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    []
  );

  const setLanguage = (value: Language) => {
    setLanguageState(value);
    setSettings({ ...settings, language: value });
  };

  const runTask = async (
    label: string,
    task: (signal: AbortSignal, registerControls: (controls: TaskControls) => void) => Promise<void>
  ) => {
    if (runningTask) {
      appendLog("warn", `${t(languageValue, "running")}: ${runningTask}`);
      return;
    }
    const controller = new AbortController();
    cancelCurrentTaskRef.current = () => controller.abort();
    setRunningTask(label);
    setPaused(false);
    setTaskProgress({ main: { label, current: 0, total: 0, indeterminate: true } });
    setStatus(`${t(languageValue, "running")}: ${label}`);
    const registerControls = (controls: TaskControls) => {
      pauseCurrentTaskRef.current = () => {
        controls.pause();
        setPaused(true);
        setStatus(t(languageValue, "taskPaused"));
      };
      resumeCurrentTaskRef.current = () => {
        controls.resume();
        setPaused(false);
        setStatus(`${t(languageValue, "running")}: ${label}`);
      };
    };
    try {
      await task(controller.signal, registerControls);
      setStatus(t(languageValue, "ready"));
    } catch (error) {
      if (error instanceof GuiApiCancelledError || controller.signal.aborted) {
        appendLog("warn", t(languageValue, "taskCancelled"));
        setStatus(t(languageValue, "taskCancelled"));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      appendLog("error", message);
      setStatus(message);
    } finally {
      cancelCurrentTaskRef.current = null;
      pauseCurrentTaskRef.current = null;
      resumeCurrentTaskRef.current = null;
      setPaused(false);
      setRunningTask(null);
      setTaskProgress(null);
    }
  };

  const saveSettings = async () => {
    setProjectRoot(projectRootValue);
    setPythonCommand(pythonCommandValue);
    const payload = await runGuiApi<SettingsPayload>(
      "settings.save",
      { settings, cookie_consent: cookieConsent, pixiv_cookie: pixivCookie },
      handleEvent
    );
    applySettingsPayload(payload);
    appendLog("info", "Settings saved");
  };

  const selectedIds = Array.from(selected);

  const scan = () =>
    runTask(t(languageValue, "scan"), async (signal, registerControls) => {
      const result = await runGuiApi<ScanPreviewPayload>("scan.preview", settings, handleEvent, {
        signal,
        onStart: registerControls
      });
      appendLog("info", `Scan preview: ${result.files_seen} files, ${result.changes.length} proposed change(s)`);
      setUnmatchedFolders(result.unmatched_folders || []);
      if (result.changes.length === 0) {
        appendLog("info", t(languageValue, "scanNoChanges"));
        return;
      }
      setScanPreview(result);
    });

  const applyScanChanges = async (operations: ScanChange[]) => {
    setScanPreview(null);
    if (!operations.length) {
      return;
    }
    try {
      const res = await runGuiApi<ScanApplyPayload>(
        "scan.apply",
        { operations, database: settings.database },
        handleEvent
      );
      appendLog(
        "info",
        `${t(languageValue, "scanApplied")}: ${res.applied} (new: ${res.new_artists}, names: ${res.name_changes}, paths: ${res.save_paths_added}, works: ${res.work_ids_added})`
      );
      await loadArtists();
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  };

  const excludeFolder = async (path: string) => {
    const current = settings.exclude_roots || [];
    if (current.includes(path)) {
      setUnmatchedFolders((list) => list.filter((item) => item.path !== path));
      return;
    }
    const nextSettings = { ...settings, exclude_roots: [...current, path] };
    setSettings(nextSettings);
    try {
      await runGuiApi<SettingsPayload>(
        "settings.save",
        { settings: nextSettings, cookie_consent: cookieConsent },
        handleEvent
      );
      setUnmatchedFolders((list) => list.filter((item) => item.path !== path));
      appendLog("info", `${t(languageValue, "excludeFolder")}: ${path}`);
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  };

  const assignUnmatchedFolder = (path: string) => {
    setPrompt({
      title: t(languageValue, "assignFolderTitle"),
      fields: [{ key: "artist_id", label: t(languageValue, "artistId"), value: "" }],
      onSubmit: (values) => {
        const artistId = values.artist_id.trim();
        if (!/^\d+$/.test(artistId)) {
          appendLog("error", t(languageValue, "invalidArtistId"));
          return;
        }
        runTask(t(languageValue, "assignArtist"), async (signal) => {
          const result = await runGuiApi<{
            artist_id: string;
            name: string;
            save_path: string;
            work_ids: number;
          }>(
            "artists.assign_folder",
            {
              artist_id: artistId,
              folder: path,
              database: settings.database
            },
            handleEvent,
            { signal }
          );
          setUnmatchedFolders((list) => list.filter((item) => item.path !== path));
          setSelected(new Set([result.artist_id]));
          appendLog(
            "info",
            `${t(languageValue, "assignedFolderToArtist")}: ${path} -> ${result.name || result.artist_id} (${result.work_ids})`
          );
          await loadArtists();
        });
      }
    });
  };

  const checkUpdates = () =>
    runTask(t(languageValue, "checkUpdates"), async (signal, registerControls) => {
      const result = await runGuiApi<UpdateResult>(
        "updates.check",
        { ...settings, artist_ids: selectedIds },
        handleEvent,
        { signal, onStart: registerControls }
      );
      appendLog("info", `Updates: ${result.checked} checked, ${result.new_works} new works`);
      for (const err of result.errors) {
        appendLog("error", err);
      }
      await loadArtists();
    });

  const downloadUpdated = () =>
    runTask(t(languageValue, "downloadUpdated"), async (signal, registerControls) => {
      const result = await runGuiApi<DownloadResult>(
        "updates.download",
        { ...settings, artist_ids: selectedIds },
        handleEvent,
        { signal, onStart: registerControls }
      );
      appendLog("info", `Downloaded: ${result.artworks} artworks, ${result.pages_saved} files`);
      for (const err of result.errors) {
        appendLog("error", err);
      }
      await loadArtists();
    });

  const openSelected = async () => {
    if (!selectedIds.length) {
      appendLog("warn", t(languageValue, "noSelection"));
      return;
    }
    try {
      const result = await runGuiApi<{ opened: number }>(
        "browser.open",
        { ...settings, artist_ids: selectedIds },
        handleEvent
      );
      appendLog("info", `Opened ${result.opened} page(s)`);
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  };

  const findSimilar = () =>
    runTask(t(languageValue, "findSimilar"), async (signal, registerControls) => {
      setActiveTab("similar");
      const threshold = settings.similar_threshold || "likely";
      const result = await runGuiApi<SimilarResult>(
        "similar.run",
        {
          ...settings,
          threshold,
          similar_skip_pixiv_pages: Boolean(settings.similar_skip_pixiv_pages),
          roots: splitLines(similarRoots),
          exclude_roots: splitLines(similarExcludes)
        },
        handleEvent,
        { signal, onStart: registerControls }
      );
      setSimilarResult(result);
      setExpandedGroups(new Set());
      appendLog("info", `Similar result: ${result.files_seen} files, ${result.groups.length} groups`);
      for (const err of result.errors) {
        appendLog("error", err);
      }
    });

  const revealFile = async (path: string) => {
    await runGuiApi<{ opened: boolean }>("file.reveal", { path }, handleEvent);
  };

  const copyUrls = async () => {
    const chosen = selected.size ? artists.filter((artist) => selected.has(artist.id)) : artists;
    const text = chosen.map((artist) => artist.pixiv_url).join("\n");
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      const message = `${t(languageValue, "copiedUrls")}: ${chosen.length}`;
      appendLog("info", message);
      showToast(message);
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  };

  const removeSelectedArtists = () => {
    if (!selectedIds.length) {
      appendLog("warn", t(languageValue, "noSelection"));
      return;
    }
    const ids = [...selectedIds];
    const names = artists
      .filter((artist) => selected.has(artist.id))
      .slice(0, 8)
      .map((artist) => `${artist.name || artist.id} (${artist.id})`);
    const more = ids.length > names.length ? `\n... +${ids.length - names.length}` : "";
    setConfirm({
      title: t(languageValue, "removeSelectedArtists"),
      body: `${t(languageValue, "confirmRemoveArtists")}\n\n${names.join("\n")}${more}`,
      confirmLabel: t(languageValue, "removeSelectedArtists"),
      onConfirm: async () => {
        try {
          const result = await runGuiApi<{ removed: number; artist_ids: string[] }>(
            "artists.remove",
            { artist_ids: ids, database: settings.database },
            handleEvent
          );
          const removed = new Set(result.artist_ids);
          setSelected((current) => new Set([...current].filter((id) => !removed.has(id))));
          const message = `${t(languageValue, "removedArtists")}: ${result.removed}`;
          appendLog("info", message);
          showToast(message);
          await loadArtists();
        } catch (error) {
          appendLog("error", error instanceof Error ? error.message : String(error));
        }
      }
    });
  };

  const addArtist = () => {
    setPrompt({
      title: t(languageValue, "addArtist"),
      fields: [
        { key: "artist_id", label: t(languageValue, "artistId"), value: "" },
        { key: "name", label: t(languageValue, "artistName"), value: "" },
        { key: "save_path", label: t(languageValue, "savePath"), value: "", browse: "folder" }
      ],
      onSubmit: (values) =>
        runTask(t(languageValue, "addArtist"), async (signal) => {
          await runGuiApi(
            "artists.add",
            {
              artist_id: values.artist_id,
              name: values.name,
              save_path: values.save_path,
              database: settings.database
            },
            handleEvent,
            { signal }
          );
          appendLog("info", `Added artist ${values.artist_id}`);
          await loadArtists();
        })
    });
  };

  const editArtistId = (oldId: string) => {
    if (!oldId) {
      return;
    }
    setPrompt({
      title: t(languageValue, "editArtistId"),
      fields: [{ key: "new_id", label: t(languageValue, "artistId"), value: oldId }],
      onSubmit: (values) =>
        runTask(t(languageValue, "editArtistId"), async (signal) => {
          const result = await runGuiApi<{ new_id: string; name: string }>(
            "artists.rename",
            { old_id: oldId, new_id: values.new_id, database: settings.database },
            handleEvent,
            { signal }
          );
          appendLog("info", `Renamed ${oldId} -> ${result.new_id}${result.name ? ` (${result.name})` : ""}`);
          setSelected(new Set([result.new_id]));
          await loadArtists();
        })
    });
  };

  const onToggleConsent = (next: boolean) => {
    if (next && !cookieConsent) {
      setDisclaimer("accept");
      return;
    }
    if (!next) {
      void runGuiApi<SettingsPayload>("cookie.revoke", {}, handleEvent)
        .then((payload) => {
          applySettingsPayload(payload);
          appendLog("info", t(languageValue, "cookieRevoked"));
        })
        .catch((error) => {
          appendLog("error", error instanceof Error ? error.message : String(error));
        });
      return;
    }
    setCookieConsent(next);
  };

  const acceptDisclaimer = () => {
    setCookieConsent(true);
    setDisclaimer(null);
  };

  const openArtist = async (id: string) => {
    try {
      const result = await runGuiApi<{ opened: number }>(
        "browser.open",
        { ...settings, artist_ids: [id] },
        handleEvent
      );
      appendLog("info", `Opened ${result.opened} page(s)`);
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  };

  const editSavePath = (artistId: string) =>
    runTask(t(languageValue, "editSavePath"), async (signal) => {
      if (!artistId) {
        return;
      }
      const picked = await browsePath("folder");
      if (!picked) {
        return;
      }
      await runGuiApi(
        "artists.set_save_path",
        { artist_id: artistId, save_path: picked, database: settings.database },
        handleEvent,
        { signal }
      );
      appendLog("info", `Save path set for ${artistId}: ${picked}`);
      await loadArtists();
    });

  const toggleArtist = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleGroup = (id: number) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const tabs: { key: TabKey; label: string; icon: ReactNode }[] = [
    { key: "artists", label: t(languageValue, "artists"), icon: <List size={18} /> },
    { key: "unmatched", label: t(languageValue, "unmatched"), icon: <FolderSearch size={18} /> },
    { key: "similar", label: t(languageValue, "similar"), icon: <ImageIcon size={18} /> },
    { key: "settings", label: t(languageValue, "settings"), icon: <SettingsIcon size={18} /> },
    { key: "logs", label: t(languageValue, "logs"), icon: <Terminal size={18} /> }
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Pixiv PBD Manager</div>
        <nav className="tabs">
          {tabs.map((tab) => (
            <button
              className={activeTab === tab.key ? "active" : ""}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main>
        {activeTab === "artists" ? (
          <ArtistsView
            language={languageValue}
            artists={artists}
            selected={selected}
            filter={filter}
            busy={busy}
            setFilter={setFilter}
            toggleArtist={toggleArtist}
            selectAll={(ids) => setSelected((current) => new Set([...current, ...ids]))}
            clearAll={() => setSelected(new Set())}
            scan={scan}
            checkUpdates={checkUpdates}
            downloadUpdated={downloadUpdated}
            openSelected={openSelected}
            copyUrls={copyUrls}
            removeSelectedArtists={removeSelectedArtists}
            addArtist={addArtist}
            editArtistId={editArtistId}
            editSavePath={editSavePath}
            openArtist={openArtist}
            openPath={revealFile}
          />
        ) : null}
        {activeTab === "unmatched" ? (
          <UnmatchedView
            language={languageValue}
            folders={unmatchedFolders}
            excludeFolder={excludeFolder}
            assignFolder={assignUnmatchedFolder}
          />
        ) : null}
        {activeTab === "similar" ? (
          <SimilarView
            language={languageValue}
            result={similarResult}
            threshold={settings.similar_threshold || "likely"}
            skipPixivPages={Boolean(settings.similar_skip_pixiv_pages)}
            busy={busy}
            expanded={expandedGroups}
            roots={similarRoots}
            excludes={similarExcludes}
            rootBoxHeight={similarRootBoxHeight}
            excludeBoxHeight={similarExcludeBoxHeight}
            setRoots={setSimilarRoots}
            setExcludes={setSimilarExcludes}
            setRootBoxHeight={setSimilarRootBoxHeight}
            setExcludeBoxHeight={setSimilarExcludeBoxHeight}
            setThreshold={(value) => setSettings({ ...settings, similar_threshold: value })}
            setSkipPixivPages={(value) => setSettings({ ...settings, similar_skip_pixiv_pages: value })}
            findSimilar={findSimilar}
            toggleGroup={toggleGroup}
            revealFile={revealFile}
          />
        ) : null}
        {activeTab === "settings" ? (
          <SettingsView
            language={languageValue}
            settings={settings}
            cookieConsent={cookieConsent}
            pixivCookie={pixivCookie}
            projectRoot={projectRootValue}
            pythonCommand={pythonCommandValue}
            setLanguage={setLanguage}
            setSettings={setSettings}
            onToggleConsent={onToggleConsent}
            viewDisclaimer={() => setDisclaimer("view")}
            setPixivCookie={setPixivCookie}
            setProjectRootValue={setProjectRootState}
            setPythonCommandValue={setPythonCommandState}
            saveSettings={saveSettings}
            notify={(message) => appendLog("warn", message)}
          />
        ) : null}
        {activeTab === "logs" ? <LogsView logs={logs} /> : null}
      </main>

      <footer>
        <span>{t(languageValue, "status")}: {status}</span>
        <span>{artists.length} artists</span>
        <span>{selected.size} selected</span>
        {runningTask && taskProgress ? (
          <div className="footerProgress">
            <ProgressLine line={taskProgress.main} showPercent={settings.show_progress_percent !== false} />
            {taskProgress.file ? (
              <ProgressLine line={taskProgress.file} showPercent={settings.show_progress_percent !== false} />
            ) : null}
          </div>
        ) : null}
        {runningTask ? (
          paused ? (
            <Button icon={<Play size={16} />} onClick={() => resumeCurrentTaskRef.current?.()}>
              {t(languageValue, "resumeTask")}
            </Button>
          ) : (
            <Button icon={<Pause size={16} />} onClick={() => pauseCurrentTaskRef.current?.()}>
              {t(languageValue, "pauseTask")}
            </Button>
          )
        ) : null}
        {runningTask ? (
          <Button icon={<XCircle size={16} />} variant="danger" onClick={() => cancelCurrentTaskRef.current?.()}>
            {t(languageValue, "cancelTask")}
          </Button>
        ) : null}
      </footer>

      {prompt ? <PromptModal language={languageValue} state={prompt} onClose={() => setPrompt(null)} /> : null}
      {confirm ? <ConfirmModal language={languageValue} state={confirm} onClose={() => setConfirm(null)} /> : null}
      {disclaimer ? (
        <DisclaimerModal
          language={languageValue}
          mode={disclaimer}
          onAccept={acceptDisclaimer}
          onClose={() => setDisclaimer(null)}
        />
      ) : null}
      {scanPreview ? (
        <ScanPreviewModal
          language={languageValue}
          preview={scanPreview}
          onApply={applyScanChanges}
          onCancel={() => setScanPreview(null)}
        />
      ) : null}
      {toastMessage ? (
        <div className="toast" role="status">
          <CheckSquare size={17} />
          <span>{toastMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
