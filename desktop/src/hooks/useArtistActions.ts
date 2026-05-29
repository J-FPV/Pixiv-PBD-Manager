import type { Dispatch, SetStateAction } from "react";
import { browsePath, runGuiApi, setProjectRoot } from "../api";
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
// by App; this hook only houses the action logic so App reads as wiring.
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
  addArtist: () => void;
  editArtistId: (oldId: string) => void;
  editSavePath: (artistId: string) => void;
  openArtist: (id: string) => Promise<void>;
  toggleArtist: (id: string) => void;
}

export function useArtistActions(deps: ArtistActionsDeps): ArtistActions {
  const {
    language: languageValue,
    settings,
    selected,
    artists,
    cookieConsent,
    pendingExcludeFolders,
    setArtists,
    setSelected,
    setSettings,
    setUnmatchedFolders,
    setPendingExcludeFolders,
    setScanPreview,
    setProjectRootState,
    setPrompt,
    setConfirm,
    appendLog,
    showToast,
    handleEvent,
    runTask
  } = deps;
  const selectedIds = Array.from(selected);

  const loadArtists = async () => {
    const payload = await runGuiApi<ArtistsPayload>("artists.list", {}, handleEvent);
    setArtists(payload.artists);
    if (payload.project_root) {
      setProjectRootState(payload.project_root);
      setProjectRoot(payload.project_root);
    }
  };

  const scan = () =>
    runTask(t(languageValue, "scan"), async (signal, registerControls) => {
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
      // Backend now includes the updated artist list in the response, so we
      // can update state without a second ``artists.list`` IPC. Skipping
      // that follow-up round-trip removes the cold-sidecar delay the user
      // sees as "scan applied but list is still empty".
      if (Array.isArray(res.artists)) {
        setArtists(res.artists);
      } else {
        await loadArtists();
      }
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
    // Don't drop the row optimistically — under the slow cold sidecar
    // startup, removing immediately shifts the next row into the clicked
    // screen position, so a second click hits a different row. Instead,
    // mark this row as "pending" (greyed + disabled) and only remove on
    // IPC success.
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

  const refreshArtistNames = () => {
    if (!selectedIds.length) {
      appendLog("warn", t(languageValue, "noSelection"));
      return;
    }
    runTask(t(languageValue, "refreshArtistNames"), async (signal, registerControls) => {
      const result = await runGuiApi<ArtistNameRefreshResult>(
        "artists.refresh_names",
        { artist_ids: selectedIds, database: settings.database },
        handleEvent,
        { signal, onStart: registerControls }
      );
      if (Array.isArray(result.artists)) {
        setArtists(result.artists);
      } else {
        await loadArtists();
      }
      appendLog("info", `${t(languageValue, "refreshArtistNames")}: ${result.changed}/${result.checked}`);
      for (const err of result.errors) {
        appendLog("error", err);
      }
    });
  };

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

  return {
    loadArtists,
    scan,
    applyScanChanges,
    excludeFolder,
    assignUnmatchedFolder,
    checkUpdates,
    refreshArtistNames,
    downloadUpdated,
    openSelected,
    copyUrls,
    removeSelectedArtists,
    addArtist,
    editArtistId,
    editSavePath,
    openArtist,
    toggleArtist
  };
}
