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

import { getProjectRoot, getPythonCommand, runGuiApi, setProjectRoot } from "./api";
import { t } from "./i18n";
import type {
  ApiEvent,
  AppSettings,
  Artist,
  ArtistsPayload,
  ConfirmState,
  Language,
  LogEntry,
  PromptState,
  ScanPreviewPayload,
  SettingsPayload,
  SimilarResult,
  TabKey,
  ThemeMode,
  UnmatchedFolder
} from "./types";
import {
  DEFAULT_SETTINGS,
  SIMILAR_RESULT_CACHE_KEY,
  UI_STATE_KEY,
  UNMATCHED_CACHE_KEY
} from "./constants";
import { loadJson, persistJson } from "./utils/storage";
import { normalizedUiState } from "./utils/uiState";
import { describeProgressEvent } from "./utils/progressEvents";
import { useTaskRunner } from "./hooks/useTaskRunner";
import { useWindowStatePersistence } from "./hooks/useWindowStatePersistence";
import { useArtistActions } from "./hooks/useArtistActions";
import { useSettingsActions } from "./hooks/useSettingsActions";
import { useSettingsAutosave, settingsAutosaveSignature } from "./hooks/useSettingsAutosave";
import { useSimilarActions } from "./hooks/useSimilarActions";
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

  // Action logic lives in dedicated hooks; App owns the state above and just
  // wires it in. Each hook closes over the current state every render, so the
  // callbacks behave exactly as the previously-inline functions did.
  const {
    applySettingsPayload,
    setLanguage,
    onToggleConsent,
    acceptDisclaimer,
    resetSettings,
    resetWindowLayout,
    openReleasePage
  } = useSettingsActions({
    language: languageValue,
    settings,
    cookieConsent,
    initialSimilarSkipPixivPages: INITIAL_UI_STATE.similarSkipPixivPages,
    setSettings,
    setLanguageState,
    setCookieConsent,
    setPixivCookie,
    setSimilarRoots,
    setSimilarExcludes,
    setSimilarRootBoxHeight,
    setSimilarExcludeBoxHeight,
    setExpandedGroups,
    setProjectRootState,
    setPythonCommandState,
    setDisclaimer,
    setConfirm,
    appendLog,
    showToast,
    handleEvent
  });

  const {
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
  } = useArtistActions({
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
  });

  const { findSimilar, toggleGroup } = useSimilarActions({
    language: languageValue,
    settings,
    similarRoots,
    similarExcludes,
    setActiveTab,
    setSimilarResult,
    setExpandedGroups,
    appendLog,
    handleEvent,
    runTask
  });

  const { markAutosaveReady } = useSettingsAutosave({
    settings,
    cookieConsent,
    pixivCookie,
    projectRootValue,
    pythonCommandValue,
    handleEventRef,
    appendLogRef
  });

  const revealFile = async (path: string) => {
    await runGuiApi<{ opened: boolean }>("file.reveal", { path }, handleEvent);
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
      markAutosaveReady(
        settingsAutosaveSignature(
          mergedSettings,
          payload.cookie_consent,
          payload.pixiv_cookie || "",
          artistPayload.project_root || payload.project_root || projectRootValue,
          pythonCommandValue
        )
      );
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
            resetWindowLayout={() => void resetWindowLayout()}
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
