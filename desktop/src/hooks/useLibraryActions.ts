import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { LibraryListPayload, LibraryScanSummary, LibrarySetTagsPayload } from "../types";
import type { AppState } from "./useAppState";

export interface LibraryActions {
  loadLibrary: () => Promise<void>;
  scanLibrary: () => void;
  setImageTags: (path: string, tags: string[]) => Promise<void>;
}

// Loads the joined catalog once (the frontend then filters/facets in-memory),
// drives the manual "scan library" build, and edits per-image tags optimistically.
export function useLibraryActions(s: AppState): LibraryActions {
  const loadLibrary = async () => {
    const payload = await runGuiApi<LibraryListPayload>("library.list", {}, s.handleEvent);
    s.setLibraryImages(payload.images);
    s.setLibraryNeedsScan(payload.needs_scan);
    s.setLibraryLoaded(true);
  };

  const scanLibrary = () =>
    s.runTask("library", t(s.language, "scanLibrary"), async (signal, registerControls) => {
      const summary = await runGuiApi<LibraryScanSummary>(
        "library.scan",
        {},
        s.handleEvent,
        { signal, onStart: registerControls }
      );
      s.appendLog("info", `Library: ${summary.indexed} image(s), ${summary.reused} reused, ${summary.errors} errors`);
      await loadLibrary();
    });

  const setImageTags = async (path: string, tags: string[]) => {
    const cleaned = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort();
    const previous = s.libraryImages;
    s.setLibraryImages((current) =>
      current.map((image) => (image.path === path ? { ...image, tags: cleaned } : image))
    );
    try {
      const payload = await runGuiApi<LibrarySetTagsPayload>("library.set_tags", { path, tags: cleaned });
      s.setLibraryImages((current) =>
        current.map((image) => (image.path === path ? payload.image : image))
      );
    } catch (reason) {
      s.setLibraryImages(previous);
      s.appendLog("error", reason instanceof Error ? reason.message : String(reason));
    }
  };

  return { loadLibrary, scanLibrary, setImageTags };
}
