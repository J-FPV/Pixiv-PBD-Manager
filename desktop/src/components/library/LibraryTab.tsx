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
      busy={s.libraryBusy}
      selectedPath={s.librarySelectedPath}
      setSelectedPath={s.setLibrarySelectedPath}
      loadLibrary={actions.loadLibrary}
      scanLibrary={actions.scanLibrary}
      setImageTags={actions.setImageTags}
      revealFile={s.revealFile}
    />
  );
}
