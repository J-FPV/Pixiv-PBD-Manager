import { useEffect, useRef, useState } from "react";
import { getProjectRoot, getPythonCommand, runGuiApi } from "../api";
import type {
  ApiEvent,
  AppSettings,
  Artist,
  CleanupSummary,
  ConfirmState,
  Language,
  LogEntry,
  PromptState,
  ScanPreviewPayload,
  SimilarResult,
  TabKey,
  UnmatchedFolder
} from "../types";
import { DEFAULT_SETTINGS, SIMILAR_RESULT_CACHE_KEY, UNMATCHED_CACHE_KEY } from "../constants";
import { loadJson } from "../utils/storage";
import { similarResultNeedsUpgrade, upgradeSimilarResult } from "../utils/similarCleanup";
import { normalizedUiState } from "../utils/uiState";
import { describeProgressEvent } from "../utils/progressEvents";
import { useLibraryState } from "./useLibraryState";
import { useTaskRunner } from "./useTaskRunner";
import { useTheme } from "./useTheme";

const INITIAL_UI_STATE = normalizedUiState();
const EMPTY_CLEANUP_SUMMARY: CleanupSummary = {
  state_path: "",
  operations: [],
  ignored_groups: []
};

// Owns all of App's React state plus the cross-cutting primitives (logging,
// toasts, the IPC event handler, the task runner). It returns a single "bag"
// that the action hooks consume directly — collapsing what used to be ~100
// lines of per-hook dependency wiring in App into one object. AppState is the
// inferred shape of that bag, so adding a field here exposes it everywhere.
export function useAppState() {
  const [activeTab, setActiveTab] = useState<TabKey>(INITIAL_UI_STATE.activeTab || "artists");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [language, setLanguageState] = useState<Language>("zh");
  const [cookieConsent, setCookieConsent] = useState(false);
  const [pixivCookie, setPixivCookie] = useState("");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [artistTags, setArtistTags] = useState<string[]>([]);
  const library = useLibraryState();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState(INITIAL_UI_STATE.filter || "");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [similarResult, setSimilarResult] = useState<SimilarResult | null>(() =>
    loadJson<SimilarResult | null>(SIMILAR_RESULT_CACHE_KEY, null)
  );
  const [cleanupSummary, setCleanupSummary] = useState<CleanupSummary>(EMPTY_CLEANUP_SUMMARY);
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
  // Tracks unmatched paths whose exclude IPC is in flight, so rapid clicks
  // during cold-sidecar startup don't re-fire on a row that just shifted.
  const [pendingExcludeFolders, setPendingExcludeFolders] = useState<Set<string>>(() => new Set());
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [disclaimer, setDisclaimer] = useState<"accept" | "view" | null>(null);
  const [scanPreview, setScanPreview] = useState<ScanPreviewPayload | null>(null);
  // Modal visibility is tracked separately from the data so dismissing the
  // preview (backdrop click / Cancel) keeps the last result around to reopen
  // without rescanning.
  const [scanPreviewOpen, setScanPreviewOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!similarResultNeedsUpgrade(similarResult) || !similarResult) return;
    let active = true;
    void upgradeSimilarResult(similarResult)
      .then((upgraded) => {
        if (active) setSimilarResult(upgraded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [similarResult]);

  const languageValue = settings.language || language;
  useTheme(settings.theme || "system");

  const appendLog = (level: LogEntry["level"], message: string) => {
    setLogs((current) => [...current.slice(-999), { id: Date.now() + Math.random(), level, message }]);
  };
  const handleEventRef = useRef<(event: ApiEvent) => void>(() => undefined);
  const appendLogRef = useRef<(level: LogEntry["level"], message: string) => void>(() => undefined);

  const taskRunner = useTaskRunner(languageValue, appendLog);
  // Per-lane busy: the library lane gates scan/update/download buttons, the
  // similar lane gates Find Similar, so the two can run at the same time.
  const libraryBusy = taskRunner.lanes.library.runningTask !== null;
  const similarBusy = taskRunner.lanes.similar.runningTask !== null;
  const anyBusy = libraryBusy || similarBusy;

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
    const { logText, progressUpdate, lane } = describeProgressEvent(languageValue, event);
    if (progressUpdate) {
      taskRunner.setLaneProgress(lane, progressUpdate);
    }
    if (logText) {
      appendLog(event.type === "error" ? "error" : "info", logText);
      taskRunner.setStatus(logText);
    }
  };

  useEffect(() => {
    handleEventRef.current = handleEvent;
    appendLogRef.current = appendLog;
  });

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    []
  );

  const revealFile = async (path: string) => {
    await runGuiApi<{ opened: boolean }>("file.reveal", { path }, handleEvent);
  };

  return {
    ...taskRunner,
    libraryBusy, similarBusy, anyBusy,
    language: languageValue,
    initialSimilarSkipPixivPages: INITIAL_UI_STATE.similarSkipPixivPages,
    appendLog, showToast, handleEvent, handleEventRef, appendLogRef, revealFile,
    activeTab, setActiveTab, settings, setSettings, setLanguageState,
    cookieConsent, setCookieConsent, pixivCookie, setPixivCookie,
    artists, setArtists, artistTags, setArtistTags, selected, setSelected, filter, setFilter, logs,
    ...library,
    similarResult, setSimilarResult, cleanupSummary, setCleanupSummary, expandedGroups, setExpandedGroups,
    projectRootValue, setProjectRootState, pythonCommandValue, setPythonCommandState,
    similarRoots, setSimilarRoots, similarExcludes, setSimilarExcludes,
    similarRootBoxHeight, setSimilarRootBoxHeight, similarExcludeBoxHeight, setSimilarExcludeBoxHeight,
    unmatchedFolders, setUnmatchedFolders, pendingExcludeFolders, setPendingExcludeFolders,
    prompt, setPrompt, confirm, setConfirm, disclaimer, setDisclaimer,
    scanPreview, setScanPreview, scanPreviewOpen, setScanPreviewOpen, toastMessage
  };
}

export type AppState = ReturnType<typeof useAppState>;
