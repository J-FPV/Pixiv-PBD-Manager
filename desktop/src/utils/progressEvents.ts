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
import type { ApiEvent, Language, TaskProgressState } from "../types";
import { numberValue } from "./format";

// Human-readable log line for a single API event. Returned strings are appended
// to the log panel and shown as the status footer text. Returns null when the
// event should be silent (e.g. high-frequency per-chunk download progress —
// progressUpdate covers the visual bar for those).
export function progressText(language: Language, event: ApiEvent): string | null {
  if (event.type === "error") {
    return `${t(language, "error")}: ${event.message}`;
  }
  if (event.type !== "progress") {
    return null;
  }
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_SCAN_START:
      return `Scan started: ${p.roots} folder(s)`;
    case PROGRESS_SCAN_FILES:
      return `Scan: ${p.files} files, ${p.matched} matched, ${p.name_only} name-only`;
    case PROGRESS_SCAN_DONE:
      return `Scan done: ${p.files} files, ${p.matched} matched`;
    case PROGRESS_RESOLVE_ARTIST:
    case PROGRESS_FUZZY_ARTIST:
      return `Resolve: ${p.current}/${p.total} ${p.name}`;
    case PROGRESS_CHECK_START:
      return `Checking ${p.total} artist(s)`;
    case PROGRESS_CHECK_ARTIST:
      return `Checking: ${p.current}/${p.total} ${p.artist}`;
    case PROGRESS_CHECK_FOUND:
      return `Updates: ${p.artist} ${p.count}`;
    case PROGRESS_DOWNLOAD_START:
      return `Downloading ${p.artists} artist(s), ${p.total_works ?? 0} artwork(s)`;
    case PROGRESS_DOWNLOAD_ARTIST:
      return `Downloading: ${p.current}/${p.total} ${p.artist}`;
    case PROGRESS_DOWNLOAD_WORK:
      return `Artwork: ${p.current}/${p.total} ${p.work_id}`;
    case PROGRESS_DOWNLOAD_FILE_START:
    case PROGRESS_DOWNLOAD_FILE_PROGRESS:
    case PROGRESS_DOWNLOAD_FILE_DONE:
    case PROGRESS_DOWNLOAD_WORK_DONE:
      return null;
    case PROGRESS_DOWNLOAD_ERROR:
      return `${t(language, "error")}: ${p.work_id} - ${p.error}`;
    case PROGRESS_SIMILAR_START:
      return `Similar scan started: ${p.roots} folder(s)`;
    case PROGRESS_SIMILAR_FILE_START:
      return `Similar processing: ${p.files}/${p.total_files ?? "?"} ${p.name ?? ""}`;
    case PROGRESS_SIMILAR_FILES:
      return `Similar: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused, ${p.errors} errors`;
    case PROGRESS_SIMILAR_INDEX_SAVED:
      return `Similar index saved: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused`;
    case PROGRESS_SIMILAR_MATCH_START:
      return `Similar matching started: ${p.total} indexed image(s)`;
    case PROGRESS_SIMILAR_MATCH:
      return `Similar matching: ${p.current}/${p.total}, ${p.pairs} candidate pair(s)`;
    case PROGRESS_SIMILAR_DONE:
      return `Similar done: ${p.files} files, ${p.indexed} indexed, ${p.groups} groups`;
    default:
      return `${event.key}: ${JSON.stringify(p)}`;
  }
}

// Translate a single progress event into a TaskProgressState mutation that
// drives the footer progress bar. Kept next to progressText so the two switches
// on the same event keys live side by side and stay in sync.
export function applyProgressEvent(
  language: Language,
  setTaskProgress: Dispatch<SetStateAction<TaskProgressState | null>>,
  event: ApiEvent
): void {
  if (event.type !== "progress") {
    return;
  }
  const p = event.payload;
  switch (event.key) {
    case PROGRESS_SCAN_START:
      setTaskProgress({ main: { label: t(language, "scan"), current: 0, total: 0, indeterminate: true } });
      break;
    case PROGRESS_SCAN_FILES:
      setTaskProgress({
        main: {
          label: `${t(language, "scan")}: ${numberValue(p.files)} files`,
          current: 0,
          total: 0,
          indeterminate: true
        }
      });
      break;
    case PROGRESS_SCAN_DONE:
      setTaskProgress({ main: { label: t(language, "scan"), current: 1, total: 1 } });
      break;
    case PROGRESS_RESOLVE_ARTIST:
    case PROGRESS_FUZZY_ARTIST:
      setTaskProgress({
        main: {
          label: `${t(language, "scan")}: ${String(p.name ?? "")}`,
          current: numberValue(p.current),
          total: numberValue(p.total)
        }
      });
      break;
    case PROGRESS_CHECK_START:
      setTaskProgress({
        main: { label: t(language, "checkUpdates"), current: 0, total: numberValue(p.total) }
      });
      break;
    case PROGRESS_CHECK_ARTIST:
      setTaskProgress({
        main: {
          label: `${t(language, "checkUpdates")}: ${String(p.artist ?? "")}`,
          current: numberValue(p.current),
          total: numberValue(p.total)
        }
      });
      break;
    case PROGRESS_DOWNLOAD_START:
      setTaskProgress({
        main: {
          label: t(language, "totalProgress"),
          current: 0,
          total: numberValue(p.total_works),
          indeterminate: numberValue(p.total_works) === 0
        }
      });
      break;
    case PROGRESS_DOWNLOAD_WORK:
      setTaskProgress((current) => ({
        main: {
          label: `${t(language, "totalProgress")}: ${String(p.artist ?? "")}`,
          current: Math.max(0, numberValue(p.global_current) - 1),
          total: numberValue(p.global_total)
        },
        file: current?.file
      }));
      break;
    case PROGRESS_DOWNLOAD_WORK_DONE:
      setTaskProgress((current) => ({
        main: {
          label: t(language, "totalProgress"),
          current: numberValue(p.global_done),
          total: numberValue(p.global_total)
        },
        file: current?.file
      }));
      break;
    case PROGRESS_DOWNLOAD_FILE_START:
    case PROGRESS_DOWNLOAD_FILE_PROGRESS:
    case PROGRESS_DOWNLOAD_FILE_DONE:
      setTaskProgress((current) => ({
        main: current?.main || { label: t(language, "totalProgress"), current: 0, total: 0, indeterminate: true },
        file: {
          label: `${t(language, "currentFile")}: ${String(p.filename ?? p.work_id ?? "")}`,
          current: numberValue(p.downloaded_bytes),
          total: numberValue(p.total_bytes),
          indeterminate: numberValue(p.total_bytes) === 0 && event.key !== PROGRESS_DOWNLOAD_FILE_DONE,
          speedBps: numberValue(p.speed_bps)
        }
      }));
      break;
    case PROGRESS_SIMILAR_START:
      setTaskProgress({ main: { label: t(language, "findSimilar"), current: 0, total: 0, indeterminate: true } });
      break;
    case PROGRESS_SIMILAR_FILE_START:
    case PROGRESS_SIMILAR_FILES:
    case PROGRESS_SIMILAR_INDEX_SAVED: {
      const hasTotal = p.total_files !== undefined && p.total_files !== null;
      const totalFiles = numberValue(p.total_files);
      const files = numberValue(p.files);
      setTaskProgress({
        main: {
          label: `${t(language, "findSimilar")}: ${files}/${hasTotal ? totalFiles : "?"} files / ${numberValue(p.indexed)} indexed`,
          current: files,
          total: totalFiles,
          indeterminate: !hasTotal
        }
      });
      break;
    }
    case PROGRESS_SIMILAR_MATCH_START:
      setTaskProgress({
        main: {
          label: `${t(language, "findSimilar")}: matching`,
          current: 0,
          total: numberValue(p.total),
          indeterminate: numberValue(p.total) === 0
        }
      });
      break;
    case PROGRESS_SIMILAR_MATCH:
      setTaskProgress({
        main: {
          label: `${t(language, "findSimilar")}: matching ${numberValue(p.pairs)} pairs`,
          current: numberValue(p.current),
          total: numberValue(p.total)
        }
      });
      break;
    case PROGRESS_SIMILAR_DONE:
      setTaskProgress({ main: { label: t(language, "findSimilar"), current: 1, total: 1 } });
      break;
    default:
      break;
  }
}
