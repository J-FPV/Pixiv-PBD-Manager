import { browsePath, runGuiApi } from "../api";
import { t } from "../i18n";
import type {
  AppSettings,
  DoctorReport,
  LibraryFetchTagsResult,
  LibraryExportResult,
  LibraryIndexStatus,
  LibraryListPayload,
  LibraryMetadataPatch,
  LibraryScanSummary
} from "../types";
import type { AppState } from "./useAppState";
import { useLibraryMetadata } from "./useLibraryMetadata";
import { useAnnotationProtection } from "./useAnnotationProtection";
import { useDirectorySync, type DirectorySyncController } from "./useDirectorySync";
export { applyLibraryMetadataPatch } from "./useLibraryMetadata";

export interface LibraryActions {
  directorySync: DirectorySyncController;
  protectAnnotations: () => void;
  loadLibrary: () => Promise<void>;
  scanLibrary: () => void;
  refreshIndexIfStale: (settings: AppSettings) => Promise<void>;
  runDoctor: () => Promise<void>;
  setImageTags: (path: string, tags: string[]) => Promise<void>;
  updateImageMetadata: (paths: string[], patch: LibraryMetadataPatch) => Promise<number>;
  exportLibrary: (paths: string[]) => Promise<void>;
  fetchTags: (paths: string[], options?: { force?: boolean }) => void;
}

// Loads the joined catalog once (the frontend then filters/facets in-memory),
// drives the manual "scan library" build, and edits per-image tags optimistically.
export function useLibraryActions(s: AppState): LibraryActions {
  const loadLibrary = async () => {
    const payload = await runGuiApi<LibraryListPayload>("library.list", {}, s.handleEvent);
    metadata.mergeSnapshot(payload.images);
    if (payload.annotation_status) s.setAnnotationStatus(payload.annotation_status);
    s.setLibraryNeedsScan(payload.needs_scan);
    s.setLibraryIndexStatus(payload.index_status);
    s.setLibraryLoaded(true);
  };
  const metadata = useLibraryMetadata(s, loadLibrary);
  const directorySync = useDirectorySync(s, metadata.mergeDelta);
  const protectAnnotations = useAnnotationProtection(s, loadLibrary);

  const scanCatalog = (settings: AppSettings, label: string, reload: boolean) =>
    s.runTask("index", label, async (signal, registerControls) => {
      const summary = await runGuiApi<LibraryScanSummary>(
        "library.scan",
        settings,
        s.handleEvent,
        { signal, onStart: registerControls, gracefulCancel: true }
      );
      if (summary.cancelled) return;
      if (summary.annotation_status) s.setAnnotationStatus(summary.annotation_status);
      s.appendLog("info", `Library: ${summary.indexed} image(s), ${summary.reused} reused, ${summary.errors} errors`);
      s.setLibraryNeedsScan(summary.needs_scan);
      s.setLibraryIndexStatus(summary.index_status);
      if (reload || s.libraryLoadedRef.current) {
        await loadLibrary();
      }
    });

  const scanLibrary = () => void scanCatalog(s.settings, t(s.language, "scanLibrary"), true);

  const refreshIndexIfStale = async (settings: AppSettings) => {
    if (settings.auto_sync !== false && !(import.meta.env.DEV && import.meta.env.VITE_GUI_API_MODE === "mock")) return;
    try {
      const status = await runGuiApi<LibraryIndexStatus>("library.status", settings, s.handleEvent);
      s.setLibraryIndexStatus(status);
      if (status.annotation_status) s.setAnnotationStatus(status.annotation_status);
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
    // Inline tag editors are fire-and-forget; the updater already reports errors.
    await metadata.update([path], { tags }).catch(() => undefined);
  };

  // Metadata writes each spawn a short-lived backend process. Keep them in
  // order so rapid clicks cannot race while still updating React immediately.
  const updateImageMetadata = metadata.update;

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
  // Incremental by default — the backend skips works it already fetched, so
  // `force` is what re-downloads tags that are already cached.
  const fetchTags = (paths: string[], options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    const label = t(s.language, force ? "refetchPixivTags" : "fetchPixivTags");
    return s.runTask("library", label, async (signal, registerControls) => {
      const result = await runGuiApi<LibraryFetchTagsResult>(
        "library.fetch_tags",
        { ...s.settings, paths, force },
        s.handleEvent,
        { signal, onStart: registerControls, gracefulCancel: true }
      );
      const byPath = new Map(result.images.map((image) => [image.path, image]));
      s.setLibraryImages((current) => current.map((image) => {
        const fetched = byPath.get(image.path);
        return fetched?.image_id === image.image_id ? { ...image, pixiv_tags: fetched.pixiv_tags } : image;
      }));
      for (const err of result.errors) {
        s.appendLog("error", err);
      }
      s.appendLog(
        "info",
        t(s.language, "fetchPixivTagsSummary")
          .replace("{fetched}", String(result.fetched))
          .replace("{skipped}", String(result.skipped))
          .replace("{failed}", String(result.failed))
      );
      if (result.cancelled) {
        s.appendLog("warn", t(s.language, "taskCancelled"));
      } else if (!force && result.attempted === 0) {
        // A fully-cached run finishes instantly; without this it looks like the
        // button did nothing at all.
        s.showToast(t(s.language, "fetchPixivTagsUpToDate"));
      }
    });
  };

  return {
    directorySync,
    protectAnnotations,
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
