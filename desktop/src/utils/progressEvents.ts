import type { Dispatch, SetStateAction } from "react";
import {
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
  PROGRESS_FUZZY_ARTIST,
  PROGRESS_REFRESH_NAMES_ARTIST,
  PROGRESS_REFRESH_NAMES_DONE,
  PROGRESS_REFRESH_NAMES_START,
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
import type { ApiEvent, Language, ProgressEvent, TaskProgressState } from "../types";
import { numberValue } from "./format";

// What a single API event tells the UI to do.
//
// ``logText`` is the line to append to the log panel and show as status; null
// means silent (e.g. high-frequency per-chunk download progress is handled by
// progressUpdate alone).
//
// ``progressUpdate`` is the React setState reducer for the footer progress
// bar; null means "leave the bar alone" (errors and non-progress events).
// The reducer is the same shape setTaskProgress accepts, so the caller can
// just pass it through.
export interface ProgressEventDescriptor {
  logText: string | null;
  progressUpdate: ((current: TaskProgressState | null) => TaskProgressState | null) | null;
}

const NOTHING: ProgressEventDescriptor = { logText: null, progressUpdate: null };

// Each pipeline owns a describe* function below that switches over the event
// keys it knows and returns ``null`` for everything else. describeProgressEvent
// is then just a dispatcher: it tries each pipeline in turn and falls back to a
// raw dump for unrecognised keys. Splitting per pipeline keeps every switch
// short and lets a single event family be edited without scrolling past the
// others.

function describeScan(language: Language, event: ProgressEvent): ProgressEventDescriptor | null {
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

function describeUpdateCheck(language: Language, event: ProgressEvent): ProgressEventDescriptor | null {
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

function describeRefreshNames(language: Language, event: ProgressEvent): ProgressEventDescriptor | null {
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

function describeDownload(language: Language, event: ProgressEvent): ProgressEventDescriptor | null {
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
      return {
        logText: `Artwork: ${p.current}/${p.total} ${p.work_id}`,
        progressUpdate: (current) => ({
          main: {
            label: `${t(language, "totalProgress")}: ${String(p.artist ?? "")}`,
            current: Math.max(0, numberValue(p.global_current) - 1),
            total: numberValue(p.global_total)
          },
          file: current?.file
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
          file: current?.file
        })
      };
    case PROGRESS_DOWNLOAD_FILE_START:
    case PROGRESS_DOWNLOAD_FILE_PROGRESS:
    case PROGRESS_DOWNLOAD_FILE_DONE:
      return {
        logText: null,
        progressUpdate: (current) => ({
          main: current?.main || { label: t(language, "totalProgress"), current: 0, total: 0, indeterminate: true },
          file: {
            label: `${t(language, "currentFile")}: ${String(p.filename ?? p.work_id ?? "")}`,
            current: numberValue(p.downloaded_bytes),
            total: numberValue(p.total_bytes),
            indeterminate: numberValue(p.total_bytes) === 0 && event.key !== PROGRESS_DOWNLOAD_FILE_DONE,
            speedBps: numberValue(p.speed_bps)
          }
        })
      };
    case PROGRESS_DOWNLOAD_ERROR:
      return { logText: `${t(language, "error")}: ${p.work_id} - ${p.error}`, progressUpdate: null };
    default:
      return null;
  }
}

function describeSimilar(language: Language, event: ProgressEvent): ProgressEventDescriptor | null {
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

// Dispatcher: error/non-progress events resolve here, everything else is routed
// to the pipeline describers above, with a raw JSON dump as the last resort.
export function describeProgressEvent(language: Language, event: ApiEvent): ProgressEventDescriptor {
  if (event.type === "error") {
    return { logText: `${t(language, "error")}: ${event.message}`, progressUpdate: null };
  }
  if (event.type !== "progress") {
    return NOTHING;
  }
  return (
    describeScan(language, event) ||
    describeUpdateCheck(language, event) ||
    describeRefreshNames(language, event) ||
    describeDownload(language, event) ||
    describeSimilar(language, event) || { logText: `${event.key}: ${JSON.stringify(event.payload)}`, progressUpdate: null }
  );
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
