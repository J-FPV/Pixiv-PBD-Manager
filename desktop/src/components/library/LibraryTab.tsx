import type { AppState } from "../../hooks/useAppState";
import type { LibraryActions } from "../../hooks/useLibraryActions";
import { LibraryView } from "./LibraryView";

// Thin adapter that maps the app state bag + library actions onto LibraryView,
// keeping MainContent's tab switch compact.
export function LibraryTab({ state: s, actions }: { state: AppState; actions: LibraryActions }) {
  return (
    <LibraryView
      language={s.language}
      images={s.libraryImages}
      loaded={s.libraryLoaded}
      needsScan={s.libraryNeedsScan}
      indexStatus={s.libraryIndexStatus}
      busy={s.libraryBusy || s.indexBusy}
      doctor={s.libraryDoctor}
      doctorBusy={s.libraryDoctorBusy}
      selectedPath={s.librarySelectedPath}
      setSelectedPath={s.setLibrarySelectedPath}
      loadLibrary={actions.loadLibrary}
      scanLibrary={actions.scanLibrary}
      runDoctor={() => void actions.runDoctor()}
      setImageTags={actions.setImageTags}
      updateImageMetadata={actions.updateImageMetadata}
      exportLibrary={actions.exportLibrary}
      fetchTags={actions.fetchTags}
      revealFile={s.revealFile}
    />
  );
}
