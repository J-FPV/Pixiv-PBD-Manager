import type { Dispatch, SetStateAction } from "react";
import { runGuiApi, setProjectRoot } from "../api";
import { t } from "../i18n";
import { parseTags, setFavorite } from "./artistFavoriteActions";
import { addTag, assignTag, deleteTag, renameTag } from "./artistTagActions";
import type {
  ApiEvent,
  AppSettings,
  Artist,
  ArtistNameRefreshResult,
  ArtistsPayload,
  ConfirmState,
  DownloadResult,
  Language,
  LogEntry,
  PromptState,
  ScanApplyPayload,
  ScanChange,
  ScanPreviewPayload,
  SettingsPayload,
  UnmatchedFolder,
  UpdateResult,
  WorkIndexRebuildResult
} from "../types";
import type { TaskRunner } from "./useTaskRunner";

// Everything the artist/scan/unmatched actions read or write. State stays owned
// by App; this hook only houses the action logic so App reads as wiring. Each
// action is a module-level function taking `deps`; the hook binds them.
export interface ArtistActionsDeps {
  language: Language;
  settings: AppSettings;
  selected: Set<string>;
  artists: Artist[];
  cookieConsent: boolean;
  pendingExcludeFolders: Set<string>;
  setArtists: Dispatch<SetStateAction<Artist[]>>;
  setArtistTags: Dispatch<SetStateAction<string[]>>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setUnmatchedFolders: Dispatch<SetStateAction<UnmatchedFolder[]>>;
  setPendingExcludeFolders: Dispatch<SetStateAction<Set<string>>>;
  scanPreview: ScanPreviewPayload | null;
  setScanPreview: Dispatch<SetStateAction<ScanPreviewPayload | null>>;
  setScanPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setProjectRootState: Dispatch<SetStateAction<string>>;
  setPrompt: Dispatch<SetStateAction<PromptState | null>>;
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
  appendLog: (level: LogEntry["level"], message: string) => void;
  showToast: (message: string) => void;
  handleEvent: (event: ApiEvent) => void;
  runTask: TaskRunner["runTask"];
}

export interface ArtistActions {
  loadArtists: () => Promise<void>;
  scan: () => void;
  reopenScanPreview: () => void;
  applyScanChanges: (operations: ScanChange[]) => Promise<void>;
  excludeFolder: (path: string) => Promise<void>;
  assignUnmatchedFolder: (path: string) => void;
  checkUpdates: () => void;
  checkArtistUpdates: (id: string) => void;
  refreshArtistNames: () => void;
  rebuildWorkIndex: () => void;
  downloadUpdated: () => void;
  downloadArtistUpdated: (id: string) => void;
  openSelected: () => Promise<void>;
  copyUrls: () => Promise<void>;
  copyArtistUrl: (id: string) => Promise<void>;
  removeSelectedArtists: () => void;
  removeArtist: (id: string) => void;
  addArtist: () => void;
  editArtist: (id: string) => void;
  setFavorite: (id: string, favorite: boolean) => void;
  addTag: () => void;
  assignTag: (artistIds: string[], name: string) => void;
  renameTag: (name: string) => void;
  deleteTag: (name: string) => void;
  openArtist: (id: string) => Promise<void>;
  toggleArtist: (id: string) => void;
}

async function loadArtists(deps: ArtistActionsDeps): Promise<void> {
  const { handleEvent, setArtists, setArtistTags, setProjectRootState } = deps;
  const payload = await runGuiApi<ArtistsPayload>("artists.list", {}, handleEvent);
  setArtists(payload.artists);
  setArtistTags(payload.tags ?? []);
  if (payload.project_root) {
    setProjectRootState(payload.project_root);
    setProjectRoot(payload.project_root);
  }
}

function scan(deps: ArtistActionsDeps): void {
  const {
    language: languageValue,
    settings,
    handleEvent,
    appendLog,
    setUnmatchedFolders,
    setScanPreview,
    setScanPreviewOpen,
    runTask
  } = deps;
  void runTask("library", t(languageValue, "scan"), async (signal, registerControls) => {
    // Drop any earlier result so a scan that finds nothing doesn't leave a
    // stale "scan results" button pointing at the previous run.
    setScanPreview(null);
    setScanPreviewOpen(false);
    const result = await runGuiApi<ScanPreviewPayload>("scan.preview", settings, handleEvent, {
      signal,
      onStart: registerControls,
      gracefulCancel: true
    });
    // Graceful cancel returns a partial result with cancelled=true (no exception),
    // so don't pop the preview or overwrite the unmatched list — just stop.
    if (result.cancelled) {
      appendLog("info", t(languageValue, "taskCancelled"));
      return;
    }
    appendLog("info", `Scan preview: ${result.files_seen} files, ${result.changes.length} proposed change(s)`);
    setUnmatchedFolders(result.unmatched_folders || []);
    if (result.changes.length === 0) {
      if (result.name_only_artists > 0 && !settings.resolve_online) {
        appendLog(
          "warn",
          t(languageValue, "scanNameOnlyNeedsResolve").replace("{count}", String(result.name_only_artists))
        );
      } else if (
        result.name_only_artists > 0 &&
        result.resolved_name_only === 0 &&
        result.fuzzy_resolved_name_only === 0
      ) {
        appendLog(
          "warn",
          t(languageValue, "scanNameOnlyUnresolved").replace("{count}", String(result.name_only_artists))
        );
      }
      appendLog("info", t(languageValue, "scanNoChanges"));
      return;
    }
    setScanPreview(result);
    setScanPreviewOpen(true);
  });
}

function reopenScanPreview(deps: ArtistActionsDeps): void {
  if (deps.scanPreview) {
    deps.setScanPreviewOpen(true);
  }
}

async function applyScanChanges(deps: ArtistActionsDeps, operations: ScanChange[]): Promise<void> {
  const { language: languageValue, settings, handleEvent, appendLog, setArtists, setScanPreview, setScanPreviewOpen } =
    deps;
  setScanPreview(null);
  setScanPreviewOpen(false);
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
    // Backend now includes the updated artist list in the response, so we can
    // update state without a second ``artists.list`` IPC. Skipping that
    // follow-up round-trip removes the cold-sidecar delay the user sees as
    // "scan applied but list is still empty".
    if (Array.isArray(res.artists)) {
      setArtists(res.artists);
    } else {
      await loadArtists(deps);
    }
  } catch (error) {
    appendLog("error", error instanceof Error ? error.message : String(error));
  }
}

async function excludeFolder(deps: ArtistActionsDeps, path: string): Promise<void> {
  const {
    language: languageValue,
    settings,
    cookieConsent,
    pendingExcludeFolders,
    setSettings,
    setUnmatchedFolders,
    setPendingExcludeFolders,
    handleEvent,
    appendLog
  } = deps;
  const current = settings.exclude_roots || [];
  if (current.includes(path)) {
    setUnmatchedFolders((list) => list.filter((item) => item.path !== path));
    return;
  }
  // Don't drop the row optimistically — under the slow cold sidecar startup,
  // removing immediately shifts the next row into the clicked screen position,
  // so a second click hits a different row. Instead, mark this row as "pending"
  // (greyed + disabled) and only remove on IPC success.
  if (pendingExcludeFolders.has(path)) {
    return;
  }
  setPendingExcludeFolders((set) => new Set(set).add(path));
  const nextSettings = { ...settings, exclude_roots: [...current, path] };
  try {
    await runGuiApi<SettingsPayload>(
      "settings.save",
      { settings: nextSettings, cookie_consent: cookieConsent },
      handleEvent
    );
    setSettings(nextSettings);
    setUnmatchedFolders((list) => list.filter((item) => item.path !== path));
    appendLog("info", `${t(languageValue, "excludeFolder")}: ${path}`);
  } catch (error) {
    appendLog("error", error instanceof Error ? error.message : String(error));
  } finally {
    setPendingExcludeFolders((set) => {
      const next = new Set(set);
      next.delete(path);
      return next;
    });
  }
}

function assignUnmatchedFolder(deps: ArtistActionsDeps, path: string): void {
  const { language: languageValue, settings, handleEvent, appendLog, setUnmatchedFolders, setSelected, setPrompt, runTask } =
    deps;
  setPrompt({
    title: t(languageValue, "assignFolderTitle"),
    fields: [{ key: "artist_id", label: t(languageValue, "artistId"), value: "" }],
    onSubmit: (values) => {
      const artistId = values.artist_id.trim();
      if (!/^\d+$/.test(artistId)) {
        appendLog("error", t(languageValue, "invalidArtistId"));
        return;
      }
      void runTask("library", t(languageValue, "assignArtist"), async (signal) => {
        const result = await runGuiApi<{ artist_id: string; name: string; save_path: string; work_ids: number }>(
          "artists.assign_folder",
          { artist_id: artistId, folder: path, database: settings.database },
          handleEvent,
          { signal }
        );
        setUnmatchedFolders((list) => list.filter((item) => item.path !== path));
        setSelected(new Set([result.artist_id]));
        appendLog(
          "info",
          `${t(languageValue, "assignedFolderToArtist")}: ${path} -> ${result.name || result.artist_id} (${result.work_ids})`
        );
        await loadArtists(deps);
      });
    }
  });
}

function checkUpdatesForIds(deps: ArtistActionsDeps, artistIds: string[]): void {
  const { language: languageValue, settings, handleEvent, appendLog, runTask } = deps;
  void runTask("library", t(languageValue, "checkUpdates"), async (signal, registerControls) => {
    const result = await runGuiApi<UpdateResult>(
      "updates.check",
      { ...settings, artist_ids: artistIds },
      handleEvent,
      { signal, onStart: registerControls }
    );
    appendLog("info", `Updates: ${result.checked} checked, ${result.new_works} new works`);
    for (const err of result.errors) {
      appendLog("error", err);
    }
    await loadArtists(deps);
  });
}

function checkUpdates(deps: ArtistActionsDeps): void {
  checkUpdatesForIds(deps, Array.from(deps.selected));
}

function checkArtistUpdates(deps: ArtistActionsDeps, artistId: string): void {
  if (!artistId) {
    return;
  }
  checkUpdatesForIds(deps, [artistId]);
}

function refreshArtistNames(deps: ArtistActionsDeps): void {
  const { language: languageValue, settings, selected, handleEvent, appendLog, setArtists, runTask } = deps;
  const selectedIds = Array.from(selected);
  if (!selectedIds.length) {
    appendLog("warn", t(languageValue, "noSelection"));
    return;
  }
  void runTask("library", t(languageValue, "refreshArtistNames"), async (signal, registerControls) => {
    const result = await runGuiApi<ArtistNameRefreshResult>(
      "artists.refresh_names",
      { artist_ids: selectedIds, database: settings.database },
      handleEvent,
      { signal, onStart: registerControls }
    );
    if (Array.isArray(result.artists)) {
      setArtists(result.artists);
    } else {
      await loadArtists(deps);
    }
    appendLog("info", `${t(languageValue, "refreshArtistNames")}: ${result.changed}/${result.checked}`);
    for (const err of result.errors) {
      appendLog("error", err);
    }
  });
}

function workIndexPreviewBody(language: Language, result: WorkIndexRebuildResult): string {
  const summary =
    language === "zh"
      ? [
          `扫描艺术家：${result.artists_scanned}/${result.artists_total}`,
          `扫描文件：${result.files_seen}`,
          `将修改艺术家：${result.artists_changed}`,
          `作品 ID：${result.old_ids} → ${result.new_ids}`,
          `新增 ${result.added_ids}，移除 ${result.removed_ids}`,
          `清除已下载的更新标记：${result.pending_ids_cleared}`,
          `冲突 ID：${result.conflicting_ids.length}`,
          `跳过艺术家：${result.artists_skipped}`,
          `不存在的保存路径：${result.missing_paths.length}`
        ]
      : [
          `Artists scanned: ${result.artists_scanned}/${result.artists_total}`,
          `Files scanned: ${result.files_seen}`,
          `Artists to change: ${result.artists_changed}`,
          `Work IDs: ${result.old_ids} → ${result.new_ids}`,
          `Add ${result.added_ids}, remove ${result.removed_ids}`,
          `Downloaded update markers cleared: ${result.pending_ids_cleared}`,
          `Conflicting IDs: ${result.conflicting_ids.length}`,
          `Artists skipped: ${result.artists_skipped}`,
          `Missing save paths: ${result.missing_paths.length}`
        ];
  const details = result.changes.slice(0, 8).map((change) => {
    const name = change.name || change.artist_id;
    return `${name} (${change.artist_id}): ${change.old_count} → ${change.new_count} (+${change.added_ids.length}/-${change.removed_ids.length})`;
  });
  if (result.changes.length > details.length) {
    details.push(`... +${result.changes.length - details.length}`);
  }
  return [t(language, "rebuildWorkIndexConfirm"), "", ...summary, ...(details.length ? ["", ...details] : [])].join("\n");
}

function rebuildWorkIndex(deps: ArtistActionsDeps): void {
  const { language, settings, handleEvent, appendLog, showToast, setArtists, setConfirm, runTask } = deps;
  void runTask("library", t(language, "rebuildWorkIndexPreview"), async (signal, registerControls) => {
    const preview = await runGuiApi<WorkIndexRebuildResult>(
      "artists.rebuild_work_index.preview",
      settings,
      handleEvent,
      { signal, onStart: registerControls, gracefulCancel: true }
    );
    if (preview.cancelled) {
      return;
    }
    if (preview.artists_changed === 0 && preview.pending_ids_cleared === 0) {
      const message = t(language, "rebuildWorkIndexNoChanges");
      appendLog("info", message);
      showToast(message);
      return;
    }
    setConfirm({
      title: t(language, "rebuildWorkIndexConfirmTitle"),
      body: workIndexPreviewBody(language, preview),
      confirmLabel: t(language, "rebuildWorkIndex"),
      onConfirm: () =>
        runTask("library", t(language, "rebuildWorkIndex"), async (applySignal, applyControls) => {
          const result = await runGuiApi<WorkIndexRebuildResult>(
            "artists.rebuild_work_index.apply",
            settings,
            handleEvent,
            { signal: applySignal, onStart: applyControls, gracefulCancel: true }
          );
          if (result.cancelled) {
            return;
          }
          if (Array.isArray(result.artists)) {
            setArtists(result.artists);
          } else {
            await loadArtists(deps);
          }
          const message = `${t(language, "rebuildWorkIndexDone")}: ${result.artists_changed}, +${result.added_ids}/-${result.removed_ids}`;
          appendLog("info", message);
          if (result.backup_path) {
            appendLog("info", `${t(language, "databaseBackup")}: ${result.backup_path}`);
          }
          showToast(message);
        })
    });
  });
}

function downloadUpdatedForIds(deps: ArtistActionsDeps, artistIds: string[]): void {
  const { language: languageValue, settings, handleEvent, appendLog, runTask } = deps;
  void runTask("library", t(languageValue, "downloadUpdated"), async (signal, registerControls) => {
    const result = await runGuiApi<DownloadResult>(
      "updates.download",
      { ...settings, artist_ids: artistIds },
      handleEvent,
      { signal, onStart: registerControls, gracefulCancel: true }
    );
    const tail = result.cancelled ? ` (${t(languageValue, "taskCancelled")})` : "";
    appendLog(result.cancelled ? "warn" : "info", `Downloaded: ${result.artworks} artworks, ${result.pages_saved} files${tail}`);
    for (const err of result.errors) {
      appendLog("error", err);
    }
    await loadArtists(deps);
  });
}

function downloadUpdated(deps: ArtistActionsDeps): void {
  downloadUpdatedForIds(deps, Array.from(deps.selected));
}

function downloadArtistUpdated(deps: ArtistActionsDeps, artistId: string): void {
  if (!artistId) {
    return;
  }
  downloadUpdatedForIds(deps, [artistId]);
}

async function openSelected(deps: ArtistActionsDeps): Promise<void> {
  const { language: languageValue, settings, selected, handleEvent, appendLog } = deps;
  const selectedIds = Array.from(selected);
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
}

async function copyUrls(deps: ArtistActionsDeps): Promise<void> {
  const { artists, selected } = deps;
  const chosen = selected.size ? artists.filter((artist) => selected.has(artist.id)) : artists;
  await copyArtistUrls(deps, chosen);
}

async function copyArtistUrls(deps: ArtistActionsDeps, chosen: Artist[]): Promise<void> {
  const { language: languageValue, appendLog, showToast } = deps;
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
}

async function copyArtistUrl(deps: ArtistActionsDeps, artistId: string): Promise<void> {
  const { artists, appendLog } = deps;
  const artist = artists.find((item) => item.id === artistId);
  if (!artist) {
    appendLog("warn", t(deps.language, "noSelection"));
    return;
  }
  await copyArtistUrls(deps, [artist]);
}

// Shared confirm+remove for both the multi-select toolbar action and the
// single-artist context-menu delete. ``ids`` is whichever set to remove;
// ``title`` labels the dialog (both currently resolve to "删除").
function confirmRemoveArtists(deps: ArtistActionsDeps, ids: string[], title: string): void {
  const { language: languageValue, settings, artists, handleEvent, appendLog, showToast, setArtists, setSelected, setConfirm } =
    deps;
  if (!ids.length) {
    appendLog("warn", t(languageValue, "noSelection"));
    return;
  }
  const idSet = new Set(ids);
  const names = artists
    .filter((artist) => idSet.has(artist.id))
    .slice(0, 8)
    .map((artist) => `${artist.name || artist.id} (${artist.id})`);
  const more = ids.length > names.length ? `\n... +${ids.length - names.length}` : "";
  setConfirm({
    title,
    body: `${t(languageValue, "confirmRemoveArtists")}\n\n${names.join("\n")}${more}`,
    confirmLabel: title,
    onConfirm: async () => {
      try {
        const result = await runGuiApi<{ removed: number; artist_ids: string[] }>(
          "artists.remove",
          { artist_ids: ids, database: settings.database },
          handleEvent
        );
        const removed = new Set(result.artist_ids);
        // Update state directly from the IPC result instead of a follow-up
        // artists.list call — the cold sidecar startup makes that second
        // round-trip the dominant source of the "deleted but still showing"
        // delay users see.
        setArtists((list) => list.filter((artist) => !removed.has(artist.id)));
        setSelected((current) => new Set([...current].filter((id) => !removed.has(id))));
        const message = `${t(languageValue, "removedArtists")}: ${result.removed}`;
        appendLog("info", message);
        showToast(message);
      } catch (error) {
        appendLog("error", error instanceof Error ? error.message : String(error));
      }
    }
  });
}

function removeSelectedArtists(deps: ArtistActionsDeps): void {
  confirmRemoveArtists(deps, Array.from(deps.selected), t(deps.language, "removeSelectedArtists"));
}

function removeArtist(deps: ArtistActionsDeps, artistId: string): void {
  confirmRemoveArtists(deps, artistId ? [artistId] : [], t(deps.language, "removeSelectedArtists"));
}

function addArtist(deps: ArtistActionsDeps): void {
  const { language: languageValue, settings, handleEvent, appendLog, setPrompt, runTask } = deps;
  setPrompt({
    title: t(languageValue, "addArtist"),
    fields: [
      { key: "artist_id", label: t(languageValue, "artistId"), value: "" },
      { key: "name", label: t(languageValue, "artistName"), value: "" },
      { key: "save_path", label: t(languageValue, "savePath"), value: "", browse: "folder" }
    ],
    onSubmit: (values) =>
      void runTask("library", t(languageValue, "addArtist"), async (signal) => {
        await runGuiApi(
          "artists.add",
          { artist_id: values.artist_id, name: values.name, save_path: values.save_path, database: settings.database },
          handleEvent,
          { signal }
        );
        appendLog("info", `Added artist ${values.artist_id}`);
        await loadArtists(deps);
      })
  });
}

function editArtist(deps: ArtistActionsDeps, artistId: string): void {
  const { language: languageValue, settings, artists, handleEvent, appendLog, setSelected, setPrompt, runTask } = deps;
  const artist = artists.find((item) => item.id === artistId);
  if (!artist) {
    return;
  }
  const originalPath = artist.save_paths[0] || "";
  const originalTags = [...artist.tags].sort();
  // One window for the editable fields: the ID is a plain input; the save path
  // is typeable and gets a Browse button (PromptModal renders it for any field
  // carrying ``browse``); tags are a comma-separated free-text list. On submit
  // we rename / reset the save path / set tags, applying each only when changed.
  setPrompt({
    title: t(languageValue, "edit"),
    fields: [
      { key: "artist_id", label: t(languageValue, "artistId"), value: artist.id },
      { key: "save_path", label: t(languageValue, "savePath"), value: originalPath, browse: "folder" },
      { key: "tags", label: t(languageValue, "tagsLabel"), value: artist.tags.join(", ") }
    ],
    onSubmit: (values) =>
      void runTask("library", t(languageValue, "edit"), async (signal) => {
        const newId = values.artist_id.trim();
        const newPath = values.save_path.trim();
        const newTags = parseTags(values.tags);
        let currentId = artist.id;
        if (newId && newId !== artist.id) {
          const result = await runGuiApi<{ new_id: string; name: string }>(
            "artists.rename",
            { old_id: artist.id, new_id: newId, database: settings.database },
            handleEvent,
            { signal }
          );
          currentId = result.new_id;
          appendLog("info", `Renamed ${artist.id} -> ${result.new_id}${result.name ? ` (${result.name})` : ""}`);
        }
        if (newPath && newPath !== originalPath) {
          await runGuiApi(
            "artists.set_save_path",
            { artist_id: currentId, save_path: newPath, database: settings.database },
            handleEvent,
            { signal }
          );
          appendLog("info", `Save path set for ${currentId}: ${newPath}`);
        }
        if (newTags.join(" ") !== originalTags.join(" ")) {
          await runGuiApi(
            "artists.set_tags",
            { artist_id: currentId, tags: newTags, database: settings.database },
            handleEvent,
            { signal }
          );
          appendLog("info", `Tags set for ${currentId}: ${newTags.join(", ")}`);
        }
        setSelected(new Set([currentId]));
        await loadArtists(deps);
      })
  });
}

async function openArtist(deps: ArtistActionsDeps, id: string): Promise<void> {
  const { settings, handleEvent, appendLog } = deps;
  const artistId = id.trim();
  if (!artistId) {
    return;
  }
  try {
    const result = await runGuiApi<{ opened: number }>(
      "browser.open",
      { ...settings, urls: [`https://www.pixiv.net/users/${encodeURIComponent(artistId)}/artworks`] },
      handleEvent
    );
    appendLog("info", `Opened ${result.opened} page(s)`);
  } catch (error) {
    appendLog("error", error instanceof Error ? error.message : String(error));
  }
}

function toggleArtist(deps: ArtistActionsDeps, id: string): void {
  deps.setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
}

export function useArtistActions(deps: ArtistActionsDeps): ArtistActions {
  return {
    loadArtists: () => loadArtists(deps),
    scan: () => scan(deps),
    reopenScanPreview: () => reopenScanPreview(deps),
    applyScanChanges: (operations) => applyScanChanges(deps, operations),
    excludeFolder: (path) => excludeFolder(deps, path),
    assignUnmatchedFolder: (path) => assignUnmatchedFolder(deps, path),
    checkUpdates: () => checkUpdates(deps),
    checkArtistUpdates: (id) => checkArtistUpdates(deps, id),
    refreshArtistNames: () => refreshArtistNames(deps),
    rebuildWorkIndex: () => rebuildWorkIndex(deps),
    downloadUpdated: () => downloadUpdated(deps),
    downloadArtistUpdated: (id) => downloadArtistUpdated(deps, id),
    openSelected: () => openSelected(deps),
    copyUrls: () => copyUrls(deps),
    copyArtistUrl: (id) => copyArtistUrl(deps, id),
    removeSelectedArtists: () => removeSelectedArtists(deps),
    removeArtist: (id) => removeArtist(deps, id),
    addArtist: () => addArtist(deps),
    editArtist: (id) => editArtist(deps, id),
    setFavorite: (id, favorite) => setFavorite(deps, id, favorite),
    addTag: () => addTag(deps),
    assignTag: (artistIds, name) => assignTag(deps, artistIds, name),
    renameTag: (name) => renameTag(deps, name),
    deleteTag: (name) => deleteTag(deps, name),
    openArtist: (id) => openArtist(deps, id),
    toggleArtist: (id) => toggleArtist(deps, id)
  };
}
