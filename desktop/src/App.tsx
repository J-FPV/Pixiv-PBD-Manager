import {
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Key,
  List,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Square,
  Terminal
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  browsePath,
  getProjectRoot,
  getPythonCommand,
  runGuiApi,
  setProjectRoot,
  setPythonCommand
} from "./api";
import type { PathPickKind } from "./api";
import { t } from "./i18n";
import type {
  ApiEvent,
  AppSettings,
  Artist,
  ArtistsPayload,
  DownloadResult,
  Language,
  LogEntry,
  ScanResult,
  SettingsPayload,
  SimilarEntry,
  SimilarGroup,
  SimilarResult,
  SimilarThreshold,
  TabKey,
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
  scan_local_subfolders: false,
  update_check_pages: 0,
  separate_r18: false
};

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
      return `Downloading ${p.artists} artist(s)`;
    case "progress_download_artist":
      return `Downloading: ${p.current}/${p.total} ${p.artist}`;
    case "progress_download_work":
      return `Artwork: ${p.current}/${p.total} ${p.work_id}`;
    case "progress_download_error":
      return `${t(language, "error")}: ${p.work_id} - ${p.error}`;
    case "progress_similar_start":
      return `Similar scan started: ${p.roots} folder(s)`;
    case "progress_similar_files":
      return `Similar: ${p.files} files, ${p.indexed} indexed, ${p.reused} reused, ${p.errors} errors`;
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
  variant?: "default" | "primary" | "quiet";
}) {
  return (
    <button className={`button ${variant}`} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
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
  addArtist,
  editArtistId,
  editSavePath,
  openArtist
}: {
  language: Language;
  artists: Artist[];
  selected: Set<string>;
  filter: string;
  busy: boolean;
  setFilter: (value: string) => void;
  toggleArtist: (id: string) => void;
  selectAll: () => void;
  clearAll: () => void;
  scan: () => void;
  checkUpdates: () => void;
  downloadUpdated: () => void;
  openSelected: () => void;
  copyUrls: () => void;
  addArtist: () => void;
  editArtistId: (id: string) => void;
  editSavePath: (id: string) => void;
  openArtist: (id: string) => void;
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
        </div>
        <Button icon={<CheckSquare size={16} />} onClick={selectAll}>
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
        <Button icon={<ExternalLink size={16} />} onClick={openSelected}>
          {t(language, "openSelected")}
        </Button>
        <Button icon={<Copy size={16} />} onClick={copyUrls}>
          {t(language, "copyUrls")}
        </Button>
        <Button icon={<Plus size={16} />} onClick={addArtist}>
          {t(language, "addArtist")}
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
                  <span className="pathText">{artist.save_paths.join("; ")}</span>
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

function SimilarView({
  language,
  result,
  threshold,
  busy,
  expanded,
  roots,
  excludes,
  setRoots,
  setExcludes,
  setThreshold,
  findSimilar,
  toggleGroup,
  revealFile
}: {
  language: Language;
  result: SimilarResult | null;
  threshold: SimilarThreshold;
  busy: boolean;
  expanded: Set<number>;
  roots: string;
  excludes: string;
  setRoots: (value: string) => void;
  setExcludes: (value: string) => void;
  setThreshold: (value: SimilarThreshold) => void;
  findSimilar: () => void;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
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
    estimateSize: () => 42,
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

  return (
    <section className="panel">
      <div className="similarHeader">
        <div className="similarPaths">
          <label>
            <span>{t(language, "similarRoots")}</span>
            <textarea value={roots} onChange={(event) => setRoots(event.target.value)} placeholder={t(language, "similarRootsHint")} />
            <button type="button" className="button browseButton" onClick={() => void appendFolder(roots, setRoots)}>
              {t(language, "addFolder")}
            </button>
          </label>
          <label>
            <span>{t(language, "excludeRoots")}</span>
            <textarea value={excludes} onChange={(event) => setExcludes(event.target.value)} />
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
                      <span>{item.group.entries.length} files, pHash {item.group.best_phash_distance}, dHash {item.group.best_dhash_distance}</span>
                      <span />
                      <span />
                    </button>
                  );
                }
                return (
                  <button
                    className="tableRow similarEntryRow"
                    key={`${item.group.id}-${item.entry.path}`}
                    style={{ transform: `translateY(${row.start}px)` }}
                    onDoubleClick={() => revealFile(item.entry.path)}
                  >
                    <span />
                    <span />
                    <span className="pathText">{item.entry.path}</span>
                    <span>{item.entry.resolution}</span>
                    <span className="numeric">{formatBytes(item.entry.size_bytes)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="emptyState">{t(language, "empty")}</div>
          )}
        </div>
      </div>
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
  const [activeTab, setActiveTab] = useState<TabKey>("artists");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [language, setLanguageState] = useState<Language>("zh");
  const [cookieConsent, setCookieConsent] = useState(false);
  const [pixivCookie, setPixivCookie] = useState("");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [similarResult, setSimilarResult] = useState<SimilarResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [projectRootValue, setProjectRootState] = useState(getProjectRoot());
  const [pythonCommandValue, setPythonCommandState] = useState(getPythonCommand());
  const [similarRoots, setSimilarRoots] = useState("");
  const [similarExcludes, setSimilarExcludes] = useState("");
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [disclaimer, setDisclaimer] = useState<"accept" | "view" | null>(null);

  const languageValue = settings.language || language;
  const busy = runningTask !== null;

  const appendLog = (level: LogEntry["level"], message: string) => {
    setLogs((current) => [...current.slice(-999), { id: Date.now() + Math.random(), level, message }]);
  };

  const handleEvent = (event: ApiEvent) => {
    const message = progressText(languageValue, event);
    if (message) {
      appendLog(event.type === "error" ? "error" : "info", message);
      setStatus(message);
    }
  };

  const applySettingsPayload = (payload: SettingsPayload) => {
    const merged = { ...DEFAULT_SETTINGS, ...payload.settings };
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

  const setLanguage = (value: Language) => {
    setLanguageState(value);
    setSettings({ ...settings, language: value });
  };

  const runTask = async (label: string, task: () => Promise<void>) => {
    if (runningTask) {
      appendLog("warn", `${t(languageValue, "running")}: ${runningTask}`);
      return;
    }
    setRunningTask(label);
    setStatus(`${t(languageValue, "running")}: ${label}`);
    try {
      await task();
      setStatus(t(languageValue, "ready"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog("error", message);
      setStatus(message);
    } finally {
      setRunningTask(null);
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
    runTask(t(languageValue, "scan"), async () => {
      const result = await runGuiApi<ScanResult>("scan.run", settings, handleEvent);
      appendLog("info", `Scan result: ${result.files_seen} files, ${result.artists} artists, ${result.changed} changed`);
      await loadArtists();
    });

  const checkUpdates = () =>
    runTask(t(languageValue, "checkUpdates"), async () => {
      const result = await runGuiApi<UpdateResult>(
        "updates.check",
        { ...settings, artist_ids: selectedIds },
        handleEvent
      );
      appendLog("info", `Updates: ${result.checked} checked, ${result.new_works} new works`);
      for (const err of result.errors) {
        appendLog("error", err);
      }
      await loadArtists();
    });

  const downloadUpdated = () =>
    runTask(t(languageValue, "downloadUpdated"), async () => {
      const result = await runGuiApi<DownloadResult>(
        "updates.download",
        { ...settings, artist_ids: selectedIds },
        handleEvent
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
    runTask(t(languageValue, "findSimilar"), async () => {
      setActiveTab("similar");
      const threshold = settings.similar_threshold || "likely";
      const result = await runGuiApi<SimilarResult>(
        "similar.run",
        {
          ...settings,
          threshold,
          roots: splitLines(similarRoots),
          exclude_roots: splitLines(similarExcludes)
        },
        handleEvent
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
      appendLog("info", `${t(languageValue, "copiedUrls")}: ${chosen.length}`);
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
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
        runTask(t(languageValue, "addArtist"), async () => {
          await runGuiApi(
            "artists.add",
            {
              artist_id: values.artist_id,
              name: values.name,
              save_path: values.save_path,
              database: settings.database
            },
            handleEvent
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
        runTask(t(languageValue, "editArtistId"), async () => {
          const result = await runGuiApi<{ new_id: string; name: string }>(
            "artists.rename",
            { old_id: oldId, new_id: values.new_id, database: settings.database },
            handleEvent
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
    runTask(t(languageValue, "editSavePath"), async () => {
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
        handleEvent
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
            selectAll={() => setSelected(new Set(artists.map((artist) => artist.id)))}
            clearAll={() => setSelected(new Set())}
            scan={scan}
            checkUpdates={checkUpdates}
            downloadUpdated={downloadUpdated}
            openSelected={openSelected}
            copyUrls={copyUrls}
            addArtist={addArtist}
            editArtistId={editArtistId}
            editSavePath={editSavePath}
            openArtist={openArtist}
          />
        ) : null}
        {activeTab === "similar" ? (
          <SimilarView
            language={languageValue}
            result={similarResult}
            threshold={settings.similar_threshold || "likely"}
            busy={busy}
            expanded={expandedGroups}
            roots={similarRoots}
            excludes={similarExcludes}
            setRoots={setSimilarRoots}
            setExcludes={setSimilarExcludes}
            setThreshold={(value) => setSettings({ ...settings, similar_threshold: value })}
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
      </footer>

      {prompt ? <PromptModal language={languageValue} state={prompt} onClose={() => setPrompt(null)} /> : null}
      {disclaimer ? (
        <DisclaimerModal
          language={languageValue}
          mode={disclaimer}
          onAccept={acceptDisclaimer}
          onClose={() => setDisclaimer(null)}
        />
      ) : null}
    </div>
  );
}
