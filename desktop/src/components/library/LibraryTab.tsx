import { lazy, Suspense } from "react";
import { t } from "../../i18n";
import type { AppState } from "../../hooks/useAppState";
import type { LibraryActions } from "../../hooks/useLibraryActions";

const LibraryView = lazy(() => import("./LibraryView").then((module) => ({ default: module.LibraryView })));

// Thin adapter that maps the app state bag + library actions onto LibraryView,
// keeping MainContent's tab switch compact.
export function LibraryTab({ state: s, actions }: { state: AppState; actions: LibraryActions }) {
  return (
    <Suspense fallback={<div className="emptyState">{t(s.language, "loadingLibrary")}</div>}>
      <LibraryView
        language={s.language}
        images={s.libraryImages}
        sort={s.librarySort}
        setSort={s.setLibrarySort}
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
    </Suspense>
  );
}
