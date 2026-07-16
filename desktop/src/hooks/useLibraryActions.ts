import { useRef } from "react";
import { browsePath, runGuiApi } from "../api";
import { t } from "../i18n";
import type {
  AppSettings,
  DoctorReport,
  LibraryFetchTagsResult,
  LibraryExportResult,
  LibraryIndexStatus,
  LibraryImage,
  LibraryMarker,
  LibraryListPayload,
  LibraryMetadataPatch,
  LibraryMetadataResult,
  LibraryScanSummary,
  LibrarySetTagsPayload
} from "../types";
import type { AppState } from "./useAppState";

function cleanMarkers(markers: Iterable<LibraryMarker>): LibraryMarker[] {
  return Array.from(new Set(markers)).sort();
}

function cleanTags(tags: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(tags, (tag) => tag.trim()).filter(Boolean))).sort();
}

export function applyLibraryMetadataPatch(image: LibraryImage, patch: LibraryMetadataPatch): LibraryImage {
  const markerSet = new Set<LibraryMarker>(patch.markers ?? image.markers);
  if (patch.markers === undefined) {
    for (const marker of patch.add_markers ?? []) markerSet.add(marker);
    for (const marker of patch.remove_markers ?? []) markerSet.delete(marker);
  }

  const tagSet = new Set(image.tags);
  for (const tag of patch.add_tags ?? []) tagSet.add(tag);
  for (const tag of patch.remove_tags ?? []) tagSet.delete(tag);
  if (patch.copy_pixiv_tags) {
    for (const pixivTag of image.pixiv_tags) tagSet.add(pixivTag.tag);
  }

  return {
    ...image,
    favorite: patch.favorite ?? image.favorite,
    rating: patch.rating === undefined ? image.rating : Math.max(0, Math.min(5, Math.trunc(patch.rating))),
    markers: cleanMarkers(markerSet),
    tags: cleanTags(tagSet)
  };
}

function useMetadataUpdater(s: AppState, loadLibrary: () => Promise<void>) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  return async (paths: string[], patch: LibraryMetadataPatch) => {
    const targetPaths = new Set(paths);
    s.setLibraryImages((current) =>
      current.map((image) => (targetPaths.has(image.path) ? applyLibraryMetadataPatch(image, patch) : image))
    );
    const request = queueRef.current.then(() =>
      runGuiApi<LibraryMetadataResult>("library.update_metadata", { paths, ...patch }, s.handleEvent)
    );
    queueRef.current = request.then(() => undefined, () => undefined);
    try {
      const result = await request;
      s.showToast(t(s.language, "libraryUpdated").replace("{count}", String(result.updated)));
      return result.updated;
    } catch (reason) {
      s.appendLog("error", reason instanceof Error ? reason.message : String(reason));
      const reload = queueRef.current.then(loadLibrary);
      queueRef.current = reload.then(() => undefined, () => undefined);
      await reload;
      throw reason;
    }
  };
}

export interface LibraryActions {
  loadLibrary: () => Promise<void>;
  scanLibrary: () => void;
  refreshIndexIfStale: (settings: AppSettings) => Promise<void>;
  runDoctor: () => Promise<void>;
  setImageTags: (path: string, tags: string[]) => Promise<void>;
  updateImageMetadata: (paths: string[], patch: LibraryMetadataPatch) => Promise<number>;
  exportLibrary: (paths: string[]) => Promise<void>;
  fetchTags: (paths: string[]) => void;
}

// Loads the joined catalog once (the frontend then filters/facets in-memory),
// drives the manual "scan library" build, and edits per-image tags optimistically.
export function useLibraryActions(s: AppState): LibraryActions {
  const loadLibrary = async () => {
    const payload = await runGuiApi<LibraryListPayload>("library.list", {}, s.handleEvent);
    s.setLibraryImages(payload.images);
    s.setLibraryNeedsScan(payload.needs_scan);
    s.setLibraryIndexStatus(payload.index_status);
    s.setLibraryLoaded(true);
  };

  const scanCatalog = (settings: AppSettings, label: string, reload: boolean) =>
    s.runTask("index", label, async (signal, registerControls) => {
      const summary = await runGuiApi<LibraryScanSummary>(
        "library.scan",
        settings,
        s.handleEvent,
        { signal, onStart: registerControls }
      );
      s.appendLog("info", `Library: ${summary.indexed} image(s), ${summary.reused} reused, ${summary.errors} errors`);
      s.setLibraryNeedsScan(summary.needs_scan);
      s.setLibraryIndexStatus(summary.index_status);
      if (reload || s.libraryLoadedRef.current) {
        await loadLibrary();
      }
    });

  const scanLibrary = () => void scanCatalog(s.settings, t(s.language, "scanLibrary"), true);

  const refreshIndexIfStale = async (settings: AppSettings) => {
    try {
      const status = await runGuiApi<LibraryIndexStatus>("library.status", settings, s.handleEvent);
      s.setLibraryIndexStatus(status);
      if (!status.stale || !settings.download_roots?.length) {
        return;
      }
      await scanCatalog(settings, t(s.language, "updateLibraryIndex"), false);
    } catch (reason) {
      s.appendLog("error", reason instanceof Error ? reason.message : String(reason));
    }
  };

  const runDoctor = async () => {
    s.setLibraryDoctorBusy(true);
    try {
      const report = await runGuiApi<DoctorReport>("doctor.run", s.settings, s.handleEvent);
      s.setLibraryDoctor(report);
    } catch (reason) {
      s.appendLog("error", reason instanceof Error ? reason.message : String(reason));
    } finally {
      s.setLibraryDoctorBusy(false);
    }
  };

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

  // Metadata writes each spawn a short-lived backend process. Keep them in
  // order so rapid clicks cannot race while still updating React immediately.
  const updateImageMetadata = useMetadataUpdater(s, loadLibrary);

  const exportLibrary = async (paths: string[]) => {
    const output = await browsePath("save");
    if (!output) return;
    const result = await runGuiApi<LibraryExportResult>(
      "library.export",
      { paths, output },
      s.handleEvent
    );
    s.showToast(t(s.language, "libraryExported").replace("{count}", String(result.exported)));
    s.appendLog("info", `Library export: ${result.exported} image(s) -> ${result.output}`);
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

  return {
    loadLibrary,
    scanLibrary,
    refreshIndexIfStale,
    runDoctor,
    setImageTags,
    updateImageMetadata,
    exportLibrary,
    fetchTags
  };
}
