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
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [disclaimer, setDisclaimer] = useState<"accept" | "view" | null>(null);
  const [scanPreview, setScanPreview] = useState<ScanPreviewPayload | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const toastTimerRef = useRef<number | null>(null);

  const languageValue = settings.language || language;

  const appendLog = (level: LogEntry["level"], message: string) => {
    setLogs((current) => [...current.slice(-999), { id: Date.now() + Math.random(), level, message }]);
  };

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
