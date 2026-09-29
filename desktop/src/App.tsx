import { useAppState } from "./hooks/useAppState";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useArtistActions } from "./hooks/useArtistActions";
import { useLibraryActions } from "./hooks/useLibraryActions";
import { useSettingsActions } from "./hooks/useSettingsActions";
import { useSettingsAutosave } from "./hooks/useSettingsAutosave";
import { useSimilarActions } from "./hooks/useSimilarActions";
import { useUiStatePersistence } from "./hooks/useUiStatePersistence";
import { useWindowStatePersistence } from "./hooks/useWindowStatePersistence";
import { AppFooter } from "./components/app/AppFooter";
import { AppModals } from "./components/app/AppModals";
import { MainContent } from "./components/app/MainContent";
import { TopBar } from "./components/app/TopBar";
import { RecoveryContext } from "./hooks/RecoveryContext";
import { useRecovery } from "./hooks/useRecovery";
import { RecoveryNotice } from "./components/RecoveryUndo";
import { DirectorySyncStatus } from "./components/app/DirectorySyncStatus";

export default function App() {
  const s = useAppState();
  const settingsActions = useSettingsActions(s);
  const artistActions = useArtistActions(s);
  const similarActions = useSimilarActions(s);
  const libraryActions = useLibraryActions(s);
  const recovery = useRecovery(s, libraryActions);
  const { markAutosaveReady } = useSettingsAutosave(s);

  useAppBootstrap(s, settingsActions.applySettingsPayload, markAutosaveReady, libraryActions.refreshIndexIfStale);
  useWindowStatePersistence();
  useUiStatePersistence(s);

  return (
    <RecoveryContext.Provider value={recovery}><div className="app">
      <TopBar language={s.language} activeTab={s.activeTab} setActiveTab={s.setActiveTab} />
      <RecoveryNotice language={s.language} />
      <MainContent
        state={s}
        settingsActions={settingsActions}
        artistActions={artistActions}
        similarActions={similarActions}
        libraryActions={libraryActions}
      />
      <AppFooter
        language={s.language}
        status={s.status}
        artistsCount={s.artists.length}
        selectedCount={s.selected.size}
        lanes={s.lanes}
        showProgressPercent={s.settings.show_progress_percent !== false}
        resumeTask={s.resumeTask}
        pauseTask={s.pauseTask}
        cancelTask={s.cancelTask}
      />
      <DirectorySyncStatus sync={libraryActions.directorySync} language={s.language} />
      <AppModals
        language={s.language}
        prompt={s.prompt}
        setPrompt={s.setPrompt}
        confirm={s.confirm}
        setConfirm={s.setConfirm}
        disclaimer={s.disclaimer}
        setDisclaimer={s.setDisclaimer}
        acceptDisclaimer={settingsActions.acceptDisclaimer}
        scanPreview={s.scanPreview}
        scanPreviewOpen={s.scanPreviewOpen}
        setScanPreviewOpen={s.setScanPreviewOpen}
        applyScanChanges={artistActions.applyScanChanges}
        openArtist={artistActions.openArtist}
        toastMessage={s.toastMessage}
      />
    </div></RecoveryContext.Provider>
  );
}
