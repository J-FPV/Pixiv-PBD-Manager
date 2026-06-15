import type { Dispatch, SetStateAction } from "react";
import {
  PROGRESS_CLEANUP_DONE,
  PROGRESS_CLEANUP_ITEM,
  PROGRESS_CLEANUP_START,
  PROGRESS_CHECK_ARTIST,
  PROGRESS_CHECK_FOUND,
  PROGRESS_CHECK_START,
  PROGRESS_DOWNLOAD_ARTIST,
  PROGRESS_DOWNLOAD_ERROR,
  PROGRESS_DOWNLOAD_FILE_DONE,
  PROGRESS_DOWNLOAD_FILE_PROGRESS,
  PROGRESS_DOWNLOAD_FILE_START,
  PROGRESS_DOWNLOAD_START,
  PROGRESS_DOWNLOAD_WORK,
  PROGRESS_DOWNLOAD_WORK_DONE,
  PROGRESS_FETCH_TAGS_DONE,
  PROGRESS_FETCH_TAGS_ITEM,
  PROGRESS_FETCH_TAGS_START,
  PROGRESS_FUZZY_ARTIST,
  PROGRESS_LIBRARY_DONE,
  PROGRESS_LIBRARY_FILES,
  PROGRESS_LIBRARY_START,
  PROGRESS_REFRESH_NAMES_ARTIST,
  PROGRESS_REFRESH_NAMES_DONE,
  PROGRESS_REFRESH_NAMES_START,
  PROGRESS_REBUILD_INDEX_ARTIST,
  PROGRESS_REBUILD_INDEX_DONE,
  PROGRESS_REBUILD_INDEX_START,
  PROGRESS_RESOLVE_ARTIST,
  PROGRESS_SCAN_DONE,
  PROGRESS_SCAN_FILES,
  PROGRESS_SCAN_START,
  PROGRESS_SIMILAR_DONE,
  PROGRESS_SIMILAR_FILE_START,
  PROGRESS_SIMILAR_FILES,
  PROGRESS_SIMILAR_INDEX_SAVED,
  PROGRESS_SIMILAR_MATCH,
  PROGRESS_SIMILAR_MATCH_START,
  PROGRESS_SIMILAR_START
} from "../events";
import { t } from "../i18n";
import type { ApiEvent, Language, ProgressEvent, TaskLane, TaskProgressState } from "../types";
import { numberValue } from "./format";

// What a single API event tells the UI to do.
//
// ``logText`` is the line to append to the log panel and show as status; null
// means silent (e.g. high-frequency per-chunk download progress is handled by
// progressUpdate alone).
//
// ``progressUpdate`` is the React setState reducer for the footer progress
// bar; null means "leave the bar alone" (errors and non-progress events).
// The reducer is the same shape setLaneProgress accepts, so the caller can
// just pass it through.
//
// ``lane`` says which task lane the event belongs to, so concurrent tasks
// drive separate progress bars. The per-pipeline describers below don't set it
// — the dispatcher attaches it from the pipeline that matched (similar events →
// the similar lane, everything else → the library lane).
type PipelineDescriptor = {
  logText: string | null;
  progressUpdate: ((current: TaskProgressState | null) => TaskProgressState | null) | null;
};

export interface ProgressEventDescriptor extends PipelineDescriptor {
  lane: TaskLane;
}

const NOTHING: PipelineDescriptor = { logText: null, progressUpdate: null };

// Each pipeline owns a describe* function below that switches over the event
// keys it knows and returns ``null`` for everything else. describeProgressEvent
// is then just a dispatcher: it tries each pipeline in turn and falls back to a
// raw dump for unrecognised keys. Splitting per pipeline keeps every switch
// short and lets a single event family be edited without scrolling past the
// others.

function describeScan(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_SCAN_START:
      return {
        logText: `Scan started: ${p.roots} folder(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "scan"), current: 0, total: 0, indeterminate: true }
        })
      };
    case PROGRESS_SCAN_FILES:
      return {
        logText: `Scan: ${p.files} files, ${p.matched} matched, ${p.name_only} name-only`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "scan")}: ${numberValue(p.files)} files`,
            current: 0,
            total: 0,
            indeterminate: true
          }
        })
      };
    case PROGRESS_SCAN_DONE:
      return {
        logText: `Scan done: ${p.files} files, ${p.matched} matched`,
        progressUpdate: () => ({ main: { label: t(language, "scan"), current: 1, total: 1 } })
      };
    case PROGRESS_RESOLVE_ARTIST:
    case PROGRESS_FUZZY_ARTIST:
      return {
        logText: `Resolve: ${p.current}/${p.total} ${p.name}`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "scan")}: ${String(p.name ?? "")}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        })
      };
    default:
      return null;
  }
}

function describeUpdateCheck(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_CHECK_START:
      return {
        logText: `Checking ${p.total} artist(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "checkUpdates"), current: 0, total: numberValue(p.total) }
        })
      };
    case PROGRESS_CHECK_ARTIST:
      return {
        logText: `Checking: ${p.current}/${p.total} ${p.artist}`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "checkUpdates")}: ${String(p.artist ?? "")}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        })
      };
    case PROGRESS_CHECK_FOUND:
      return { logText: `Updates: ${p.artist} ${p.count}`, progressUpdate: null };
    default:
      return null;
  }
}

function describeRefreshNames(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_REFRESH_NAMES_START:
      return {
        logText: `Refreshing names for ${p.total} artist(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "refreshArtistNames"), current: 0, total: numberValue(p.total) }
        })
      };
    case PROGRESS_REFRESH_NAMES_ARTIST:
      return {
        logText: `Refreshing name: ${p.current}/${p.total} ${p.artist_id}`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "refreshArtistNames")}: ${String(p.artist ?? p.artist_id ?? "")}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        })
      };
    case PROGRESS_REFRESH_NAMES_DONE:
      return {
        logText: `Refreshed names: ${p.changed} changed, ${p.failed} failed`,
        progressUpdate: () => ({ main: { label: t(language, "refreshArtistNames"), current: 1, total: 1 } })
      };
    default:
      return null;
  }
}

function describeRebuildIndex(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_REBUILD_INDEX_START:
      return {
        logText: `Rebuilding work index for ${p.total} artist(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "rebuildWorkIndex"), current: 0, total: numberValue(p.total) }
        })
      };
    case PROGRESS_REBUILD_INDEX_ARTIST:
      return {
        logText: `Work index: ${p.current}/${p.total} ${p.artist}, ${p.files} files, ${p.work_ids} IDs`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "rebuildWorkIndex")}: ${String(p.artist ?? p.artist_id ?? "")}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        })
      };
    case PROGRESS_REBUILD_INDEX_DONE:
      return {
        logText: `Work index: ${p.changed} artist(s) changed, +${p.added}/-${p.removed}, ${p.conflicts} conflict(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "rebuildWorkIndex"), current: numberValue(p.artists), total: numberValue(p.artists) }
        })
      };
    default:
      return null;
  }
}

function describeDownload(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_DOWNLOAD_START:
      return {
        logText: `Downloading ${p.artists} artist(s), ${p.total_works ?? 0} artwork(s)`,
        progressUpdate: () => ({
          main: {
            label: t(language, "totalProgress"),
            current: 0,
            total: numberValue(p.total_works),
            indeterminate: numberValue(p.total_works) === 0
          }
        })
      };
    case PROGRESS_DOWNLOAD_ARTIST:
      return { logText: `Downloading: ${p.current}/${p.total} ${p.artist}`, progressUpdate: null };
    case PROGRESS_DOWNLOAD_WORK:
      // ``main.current`` is preserved (advanced only by WORK_DONE's global_done)
      // so concurrent tasks finishing out of order don't fight over the total
      // bar. The per-slot bar is left to the FILE_* events below.
      return {
        logText: `Artwork: ${p.current}/${p.total} ${p.work_id}`,
        progressUpdate: (current) => ({
          main: {
            label: `${t(language, "totalProgress")}: ${String(p.artist ?? "")}`,
            current: current?.main.current ?? Math.max(0, numberValue(p.global_current) - 1),
            total: numberValue(p.global_total)
          },
          files: current?.files
        })
      };
    case PROGRESS_DOWNLOAD_WORK_DONE:
      return {
        logText: null,
        progressUpdate: (current) => ({
          main: {
            label: t(language, "totalProgress"),
            current: numberValue(p.global_done),
            total: numberValue(p.global_total)
          },
          files: current?.files
        })
      };
    case PROGRESS_DOWNLOAD_FILE_START:
    case PROGRESS_DOWNLOAD_FILE_PROGRESS:
    case PROGRESS_DOWNLOAD_FILE_DONE:
      return {
        logText: null,
        progressUpdate: (current) => ({
          main: current?.main || { label: t(language, "totalProgress"), current: 0, total: 0, indeterminate: true },
          files: {
            ...(current?.files ?? {}),
            [numberValue(p.slot)]: {
              label: String(p.filename ?? p.work_id ?? ""),
              current: numberValue(p.downloaded_bytes),
              total: numberValue(p.total_bytes),
              indeterminate: numberValue(p.total_bytes) === 0 && event.key !== PROGRESS_DOWNLOAD_FILE_DONE,
              speedBps: numberValue(p.speed_bps)
            }
          }
        })
      };
    case PROGRESS_DOWNLOAD_ERROR:
      return { logText: `${t(language, "error")}: ${p.work_id} - ${p.error}`, progressUpdate: null };
    default:
      return null;
  }
}

function describeSimilar(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_SIMILAR_START:
      return {
        logText: `Similar scan started: ${p.roots} folder(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "findSimilar"), current: 0, total: 0, indeterminate: true }
        })
      };
    case PROGRESS_SIMILAR_FILE_START:
    case PROGRESS_SIMILAR_FILES:
    case PROGRESS_SIMILAR_INDEX_SAVED: {
      const hasTotal = p.total_files !== undefined && p.total_files !== null;
      const totalFiles = numberValue(p.total_files);
      const files = numberValue(p.files);
      // Log text differs per key but the progress shape is identical.
      const logText =
        event.key === PROGRESS_SIMILAR_FILE_START
          ? `Similar processing: ${p.files}/${p.total_files ?? "?"} ${p.name ?? ""}`
          : event.key === PROGRESS_SIMILAR_FILES
            ? `Similar: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused, ${p.errors} errors`
            : `Similar index saved: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused`;
      return {
        logText,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "findSimilar")}: ${files}/${hasTotal ? totalFiles : "?"} files / ${numberValue(p.indexed)} indexed`,
            current: files,
            total: totalFiles,
            indeterminate: !hasTotal
          }
        })
      };
    }
    case PROGRESS_SIMILAR_MATCH_START:
      return {
        logText: `Similar matching started: ${p.total} indexed image(s)`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "findSimilar")}: matching`,
            current: 0,
            total: numberValue(p.total),
            indeterminate: numberValue(p.total) === 0
          }
        })
      };
    case PROGRESS_SIMILAR_MATCH:
      return {
        logText: `Similar matching: ${p.current}/${p.total}, ${p.pairs} candidate pair(s)`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "findSimilar")}: matching ${numberValue(p.pairs)} pairs`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        })
      };
    case PROGRESS_SIMILAR_DONE:
      return {
        logText: `Similar done: ${p.files} files, ${p.indexed} indexed, ${p.groups} groups`,
        progressUpdate: () => ({ main: { label: t(language, "findSimilar"), current: 1, total: 1 } })
      };
    default:
      return null;
  }
}

function describeLibrary(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_LIBRARY_START:
      return {
        logText: `Library scan started: ${p.total_files ?? "?"} file(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "scanLibrary"), current: 0, total: numberValue(p.total_files), indeterminate: true }
        })
      };
    case PROGRESS_LIBRARY_FILES: {
      const total = numberValue(p.total_files);
      return {
        logText: `Library: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.reused} reused`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "scanLibrary")}: ${numberValue(p.files)}/${total} `,
            current: numberValue(p.files),
            total,
            indeterminate: total === 0
          }
        })
      };
    }
    case PROGRESS_LIBRARY_DONE:
      return {
        logText: `Library scan done: ${p.indexed} image(s)`,
        progressUpdate: () => ({ main: { label: t(language, "scanLibrary"), current: 1, total: 1 } })
      };
    default:
      return null;
  }
}

function describeFetchTags(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_FETCH_TAGS_START:
      return {
        logText: `Fetching Pixiv tags: ${p.total ?? 0} artwork(s)`,
        progressUpdate: () => ({
          main: { label: t(language, "fetchPixivTags"), current: 0, total: numberValue(p.total), indeterminate: numberValue(p.total) === 0 }
        })
      };
    case PROGRESS_FETCH_TAGS_ITEM:
      return {
        logText: `Pixiv tags: ${p.current}/${p.total} (pid ${p.pid})`,
        progressUpdate: () => ({
          main: {
            label: `${t(language, "fetchPixivTags")}: ${numberValue(p.current)}/${numberValue(p.total)}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        })
      };
    case PROGRESS_FETCH_TAGS_DONE:
      return {
        logText: `Pixiv tags done: ${p.updated} updated, ${p.errors} errors`,
        progressUpdate: () => ({ main: { label: t(language, "fetchPixivTags"), current: 1, total: 1 } })
      };
    default:
      return null;
  }
}

function describeCleanup(language: Language, event: ProgressEvent): PipelineDescriptor | null {
  const p = event.payload;
  const actionLabel =
    p.action === "restore"
      ? t(language, "restore")
      : p.action === "delete"
        ? t(language, "deletePermanently")
        : t(language, "moveToQuarantine");
  switch (event.key) {
    case PROGRESS_CLEANUP_START:
      return {
        logText: `${actionLabel}: ${p.total} file(s)`,
        progressUpdate: () => ({
          main: { label: actionLabel, current: 0, total: numberValue(p.total) }
        })
      };
    case PROGRESS_CLEANUP_ITEM:
      return {
        logText: `${actionLabel}: ${p.current}/${p.total} ${p.path}`,
        progressUpdate: () => ({
          main: {
            label: `${actionLabel}: ${String(p.path ?? "")}`,
            current: numberValue(p.current),
            total: numberValue(p.total)
          }
        })
      };
    case PROGRESS_CLEANUP_DONE:
      return {
        logText: `${actionLabel}: ${p.succeeded}/${p.total}`,
        progressUpdate: () => ({
          main: { label: actionLabel, current: numberValue(p.total), total: numberValue(p.total) }
        })
      };
    default:
      return null;
  }
}

// Maps each pipeline to its task lane. Order matters only for matching; the
// describers return null for keys they don't own, so the first non-null wins.
const PIPELINES: { lane: TaskLane; describe: (language: Language, event: ProgressEvent) => PipelineDescriptor | null }[] = [
  { lane: "library", describe: describeScan },
  { lane: "library", describe: describeUpdateCheck },
  { lane: "library", describe: describeRefreshNames },
  { lane: "library", describe: describeRebuildIndex },
  { lane: "library", describe: describeDownload },
  { lane: "library", describe: describeLibrary },
  { lane: "library", describe: describeFetchTags },
  { lane: "similar", describe: describeSimilar },
  { lane: "similar", describe: describeCleanup }
];

// Dispatcher: error/non-progress events resolve here, everything else is routed
// to the pipeline describers above, with a raw JSON dump as the last resort.
// The matched pipeline's lane is stamped onto the descriptor so concurrent
// tasks drive their own progress bar.
export function describeProgressEvent(language: Language, event: ApiEvent): ProgressEventDescriptor {
  if (event.type === "error") {
    return { lane: "library", logText: `${t(language, "error")}: ${event.message}`, progressUpdate: null };
  }
  if (event.type !== "progress") {
    return { lane: "library", ...NOTHING };
  }
  for (const pipeline of PIPELINES) {
    const descriptor = pipeline.describe(language, event);
    if (descriptor) {
      return { lane: pipeline.lane, ...descriptor };
    }
  }
  return { lane: "library", logText: `${event.key}: ${JSON.stringify(event.payload)}`, progressUpdate: null };
}

// Thin convenience for callers that only want the progress side. Used by the
// App's handleEvent which also wants logText — but kept here so unit tests or
// future surface (e.g. a notification handler) can ignore one half cleanly.
export function applyDescriptor(
  setTaskProgress: Dispatch<SetStateAction<TaskProgressState | null>>,
  descriptor: ProgressEventDescriptor
): void {
  if (descriptor.progressUpdate) {
    setTaskProgress(descriptor.progressUpdate);
  }
}
