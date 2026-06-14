import { runGuiApi } from "../api";
import { t } from "../i18n";
import type {
  LibraryFetchTagsResult,
  LibraryListPayload,
  LibraryScanSummary,
  LibrarySetTagsPayload
} from "../types";
import type { AppState } from "./useAppState";

export interface LibraryActions {
  loadLibrary: () => Promise<void>;
  scanLibrary: () => void;
  setImageTags: (path: string, tags: string[]) => Promise<void>;
  fetchTags: (paths: string[]) => void;
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

  // Fetch each artwork's Pixiv tags (original + English translation) and apply
  // them to every image sharing the PID. Cancellable + rate-limited backend.
  const fetchTags = (paths: string[]) =>
    s.runTask("library", t(s.language, "fetchPixivTags"), async (signal, registerControls) => {
      const result = await runGuiApi<LibraryFetchTagsResult>(
        "library.fetch_tags",
        { ...s.settings, paths },
        s.handleEvent,
        { signal, onStart: registerControls, gracefulCancel: true }
      );
      const byPath = new Map(result.images.map((image) => [image.path, image]));
      s.setLibraryImages((current) => current.map((image) => byPath.get(image.path) ?? image));
      for (const err of result.errors) {
        s.appendLog("error", err);
      }
      if (result.cancelled) {
        s.appendLog("warn", t(s.language, "taskCancelled"));
      }
    });

  return { loadLibrary, scanLibrary, setImageTags, fetchTags };
}
