import {
  CheckSquare,
  FolderSearch,
  Image as ImageIcon,
  List,
  Pause,
  Play,
  Settings as SettingsIcon,
  Terminal,
  XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  browsePath,
  getProjectRoot,
  getPythonCommand,
  runGuiApi,
  setProjectRoot,
  setPythonCommand
} from "./api";
import { t } from "./i18n";
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
  SimilarResult,
  TabKey,
  ThemeMode,
  UnmatchedFolder,
  UpdateResult
} from "./types";
import {
  DEFAULT_SETTINGS,
  SIMILAR_RESULT_CACHE_KEY,
  UI_STATE_KEY,
  UNMATCHED_CACHE_KEY
} from "./constants";
import { joinLines, splitLines } from "./utils/paths";
import { loadJson, persistJson } from "./utils/storage";
import { normalizedUiState } from "./utils/uiState";
import { describeProgressEvent } from "./utils/progressEvents";
import { useTaskRunner } from "./hooks/useTaskRunner";
import { useWindowStatePersistence } from "./hooks/useWindowStatePersistence";
import { ArtistsView } from "./components/ArtistsView";
import { Button } from "./components/Button";
import { ConfirmModal } from "./components/ConfirmModal";
import { DisclaimerModal } from "./components/DisclaimerModal";
import { LogsView } from "./components/LogsView";
import { ProgressLine } from "./components/ProgressLine";
import { PromptModal } from "./components/PromptModal";
import { ScanPreviewModal } from "./components/ScanPreviewModal";
import { SettingsView } from "./components/SettingsView";
import { SimilarView } from "./components/SimilarView";
import { UnmatchedView } from "./components/UnmatchedView";

const INITIAL_UI_STATE = normalizedUiState();

type EffectiveTheme = Exclude<ThemeMode, "system">;

const readSystemTheme = (): EffectiveTheme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const settingsAutosaveSignature = (
  settings: AppSettings,
  cookieConsent: boolean,
  pixivCookie: string,
  projectRoot: string,
  pythonCommand: string
) =>
  JSON.stringify({
    settings,
    cookieConsent,
    pixivCookie,
    projectRoot,
    pythonCommand
  });

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
  // Tracks unmatched paths whose exclude IPC is in flight. Rows in this set
  // render greyed + disabled so rapid clicks during cold-sidecar startup
  // don't fire the action again on a row that just slid into the clicked
  // screen position.
  const [pendingExcludeFolders, setPendingExcludeFolders] = useState<Set<string>>(() => new Set());
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [disclaimer, setDisclaimer] = useState<"accept" | "view" | null>(null);
  const [scanPreview, setScanPreview] = useState<ScanPreviewPayload | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => readSystemTheme());
  const toastTimerRef = useRef<number | null>(null);
  const settingsAutosaveReadyRef = useRef(false);
  const lastSettingsSignatureRef = useRef("");
  const settingsSaveSeqRef = useRef(0);

  const languageValue = settings.language || language;
  const themeMode = settings.theme || "system";
  const effectiveTheme: EffectiveTheme = themeMode === "system" ? systemTheme : themeMode;

  const appendLog = (level: LogEntry["level"], message: string) => {
    setLogs((current) => [...current.slice(-999), { id: Date.now() + Math.random(), level, message }]);
  };
  const handleEventRef = useRef<(event: ApiEvent) => void>(() => undefined);
  const appendLogRef = useRef<(level: LogEntry["level"], message: string) => void>(() => undefined);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    updateTheme();
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  const taskRunner = useTaskRunner(languageValue, appendLog);
  const {
    runningTask,
    paused,
    taskProgress,
    setTaskProgress,
    setStatus,
    runTask,
    cancelCurrentTask,
    pauseCurrentTask,
    resumeCurrentTask
  } = taskRunner;
  const busy = runningTask !== null;
  const status = taskRunner.status;

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

  const handleEvent = (event: ApiEvent) => {
    const { logText, progressUpdate } = describeProgressEvent(languageValue, event);
    if (progressUpdate) {
      setTaskProgress(progressUpdate);
    }
    if (logText) {
      appendLog(event.type === "error" ? "error" : "info", logText);
      setStatus(logText);
    }
  };

  useEffect(() => {
    handleEventRef.current = handleEvent;
    appendLogRef.current = appendLog;
  });

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
    if (payload.project_root) {
      setProjectRootState(payload.project_root);
      setProjectRoot(payload.project_root);
    }
    return merged;
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
      const mergedSettings = applySettingsPayload(payload);
      const artistPayload = await runGuiApi<ArtistsPayload>("artists.list", {}, handleEvent);
      setArtists(artistPayload.artists);
      if (artistPayload.project_root) {
        setProjectRootState(artistPayload.project_root);
        setProjectRoot(artistPayload.project_root);
      }
      lastSettingsSignatureRef.current = settingsAutosaveSignature(
        mergedSettings,
        payload.cookie_consent,
        payload.pixiv_cookie || "",
        artistPayload.project_root || payload.project_root || projectRootValue,
        pythonCommandValue
      );
      settingsAutosaveReadyRef.current = true;
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

  useWindowStatePersistence();

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

  useEffect(() => {
    const signature = settingsAutosaveSignature(
      settings,
      cookieConsent,
      pixivCookie,
      projectRootValue,
      pythonCommandValue
    );
    if (!settingsAutosaveReadyRef.current) {
      lastSettingsSignatureRef.current = signature;
      return undefined;
    }
    if (signature === lastSettingsSignatureRef.current) {
      return undefined;
    }

    const saveSeq = settingsSaveSeqRef.current + 1;
    settingsSaveSeqRef.current = saveSeq;
    const timer = window.setTimeout(() => {
      setProjectRoot(projectRootValue);
      setPythonCommand(pythonCommandValue);
      void runGuiApi<SettingsPayload>(
        "settings.save",
        { settings, cookie_consent: cookieConsent, pixiv_cookie: pixivCookie },
        (event) => handleEventRef.current(event)
      )
        .then(() => {
          if (settingsSaveSeqRef.current === saveSeq) {
            lastSettingsSignatureRef.current = signature;
          }
        })
        .catch((error) => {
          if (settingsSaveSeqRef.current === saveSeq) {
            appendLogRef.current(
              "error",
              `Auto-save settings failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [settings, cookieConsent, pixivCookie, projectRootValue, pythonCommandValue]);

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

  const openReleasePage = async () => {
    try {
      const releaseUrl = "https://github.com/J-FPV/Pixiv-PBD-Manager/releases";
      const result = await runGuiApi<{ opened: number }>(
        "browser.open",
        { ...settings, urls: [releaseUrl] },
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

  const resetSettings = () => {
    setConfirm({
      title: t(languageValue, "resetSettings"),
      body: t(languageValue, "confirmResetSettings"),
      confirmLabel: t(languageValue, "resetSettings"),
      onConfirm: async () => {
        const resetValues: AppSettings = {
          ...DEFAULT_SETTINGS,
          database: settings.database || DEFAULT_SETTINGS.database
        };
        try {
          const payload = await runGuiApi<SettingsPayload>(
            "settings.save",
            {
              settings: resetValues,
              cookie_consent: false,
              pixiv_cookie: ""
            },
            handleEvent
          );
          applySettingsPayload(payload);
          setPythonCommandState("python");
          setPythonCommand("python");
          setSimilarRoots("");
          setSimilarExcludes("");
          setSimilarRootBoxHeight(undefined);
          setSimilarExcludeBoxHeight(undefined);
          setExpandedGroups(new Set());
          const message = t(languageValue, "settingsReset");
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
            refreshArtistNames={refreshArtistNames}
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
            pendingExclude={pendingExcludeFolders}
            excludeFolder={excludeFolder}
            assignFolder={assignUnmatchedFolder}
            openPath={revealFile}
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
            openReleasePage={openReleasePage}
            openPath={revealFile}
            resetSettings={resetSettings}
            busy={busy}
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
            <Button icon={<Play size={16} />} onClick={resumeCurrentTask}>
              {t(languageValue, "resumeTask")}
            </Button>
          ) : (
            <Button icon={<Pause size={16} />} onClick={pauseCurrentTask}>
              {t(languageValue, "pauseTask")}
            </Button>
          )
        ) : null}
        {runningTask ? (
          <Button icon={<XCircle size={16} />} variant="danger" onClick={cancelCurrentTask}>
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
          openArtist={openArtist}
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
