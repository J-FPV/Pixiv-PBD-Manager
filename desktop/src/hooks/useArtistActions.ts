import type { Dispatch, SetStateAction } from "react";
import { runGuiApi, setProjectRoot } from "../api";
import { t } from "../i18n";
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
  UpdateResult
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
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setUnmatchedFolders: Dispatch<SetStateAction<UnmatchedFolder[]>>;
  setPendingExcludeFolders: Dispatch<SetStateAction<Set<string>>>;
  setScanPreview: Dispatch<SetStateAction<ScanPreviewPayload | null>>;
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
  applyScanChanges: (operations: ScanChange[]) => Promise<void>;
  excludeFolder: (path: string) => Promise<void>;
  assignUnmatchedFolder: (path: string) => void;
  checkUpdates: () => void;
  refreshArtistNames: () => void;
  downloadUpdated: () => void;
  openSelected: () => Promise<void>;
  copyUrls: () => Promise<void>;
  removeSelectedArtists: () => void;
  removeArtist: (id: string) => void;
  addArtist: () => void;
  editArtist: (id: string) => void;
  openArtist: (id: string) => Promise<void>;
  toggleArtist: (id: string) => void;
}

async function loadArtists(deps: ArtistActionsDeps): Promise<void> {
  const { handleEvent, setArtists, setProjectRootState } = deps;
  const payload = await runGuiApi<ArtistsPayload>("artists.list", {}, handleEvent);
  setArtists(payload.artists);
  if (payload.project_root) {
    setProjectRootState(payload.project_root);
    setProjectRoot(payload.project_root);
  }
}

function scan(deps: ArtistActionsDeps): void {
  const { language: languageValue, settings, handleEvent, appendLog, setUnmatchedFolders, setScanPreview, runTask } =
    deps;
  void runTask("library", t(languageValue, "scan"), async (signal, registerControls) => {
    const result = await runGuiApi<ScanPreviewPayload>("scan.preview", settings, handleEvent, {
      signal,
      onStart: registerControls
    });
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
  });
}

async function applyScanChanges(deps: ArtistActionsDeps, operations: ScanChange[]): Promise<void> {
  const { language: languageValue, settings, handleEvent, appendLog, setArtists, setScanPreview } = deps;
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

function checkUpdates(deps: ArtistActionsDeps): void {
  const { language: languageValue, settings, selected, handleEvent, appendLog, runTask } = deps;
  const selectedIds = Array.from(selected);
  void runTask("library", t(languageValue, "checkUpdates"), async (signal, registerControls) => {
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
    await loadArtists(deps);
  });
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

function downloadUpdated(deps: ArtistActionsDeps): void {
  const { language: languageValue, settings, selected, handleEvent, appendLog, runTask } = deps;
  const selectedIds = Array.from(selected);
  void runTask("library", t(languageValue, "downloadUpdated"), async (signal, registerControls) => {
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
    await loadArtists(deps);
  });
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
  const { language: languageValue, artists, selected, appendLog, showToast } = deps;
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
  // One window for both fields: the ID is a plain input; the save path is
  // typeable and gets a Browse button (PromptModal renders it for any field
  // carrying ``browse``). On submit we rename and/or reset the save path,
  // applying each only when it actually changed.
  setPrompt({
    title: t(languageValue, "edit"),
    fields: [
      { key: "artist_id", label: t(languageValue, "artistId"), value: artist.id },
      { key: "save_path", label: t(languageValue, "savePath"), value: originalPath, browse: "folder" }
    ],
    onSubmit: (values) =>
      void runTask("library", t(languageValue, "edit"), async (signal) => {
        const newId = values.artist_id.trim();
        const newPath = values.save_path.trim();
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
        setSelected(new Set([currentId]));
        await loadArtists(deps);
      })
  });
}

async function openArtist(deps: ArtistActionsDeps, id: string): Promise<void> {
  const { settings, handleEvent, appendLog } = deps;
  try {
    const result = await runGuiApi<{ opened: number }>("browser.open", { ...settings, artist_ids: [id] }, handleEvent);
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
    applyScanChanges: (operations) => applyScanChanges(deps, operations),
    excludeFolder: (path) => excludeFolder(deps, path),
    assignUnmatchedFolder: (path) => assignUnmatchedFolder(deps, path),
    checkUpdates: () => checkUpdates(deps),
    refreshArtistNames: () => refreshArtistNames(deps),
    downloadUpdated: () => downloadUpdated(deps),
    openSelected: () => openSelected(deps),
    copyUrls: () => copyUrls(deps),
    removeSelectedArtists: () => removeSelectedArtists(deps),
    removeArtist: (id) => removeArtist(deps, id),
    addArtist: () => addArtist(deps),
    editArtist: (id) => editArtist(deps, id),
    openArtist: (id) => openArtist(deps, id),
    toggleArtist: (id) => toggleArtist(deps, id)
  };
}
