import type { Dispatch, SetStateAction } from "react";
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
    case "progress_scan_start":
      return `Scan started: ${p.roots} folder(s)`;
    case "progress_scan_files":
      return `Scan: ${p.files} files, ${p.matched} matched, ${p.name_only} name-only`;
    case "progress_scan_done":
      return `Scan done: ${p.files} files, ${p.matched} matched`;
    case "progress_resolve_artist":
    case "progress_fuzzy_artist":
      return `Resolve: ${p.current}/${p.total} ${p.name}`;
    case "progress_check_start":
      return `Checking ${p.total} artist(s)`;
    case "progress_check_artist":
      return `Checking: ${p.current}/${p.total} ${p.artist}`;
    case "progress_check_found":
      return `Updates: ${p.artist} ${p.count}`;
    case "progress_download_start":
      return `Downloading ${p.artists} artist(s), ${p.total_works ?? 0} artwork(s)`;
    case "progress_download_artist":
      return `Downloading: ${p.current}/${p.total} ${p.artist}`;
    case "progress_download_work":
      return `Artwork: ${p.current}/${p.total} ${p.work_id}`;
    case "progress_download_file_start":
    case "progress_download_file_progress":
    case "progress_download_file_done":
    case "progress_download_work_done":
      return null;
    case "progress_download_error":
      return `${t(language, "error")}: ${p.work_id} - ${p.error}`;
    case "progress_similar_start":
      return `Similar scan started: ${p.roots} folder(s)`;
    case "progress_similar_file_start":
      return `Similar processing: ${p.files}/${p.total_files ?? "?"} ${p.name ?? ""}`;
    case "progress_similar_files":
      return `Similar: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused, ${p.errors} errors`;
    case "progress_similar_index_saved":
      return `Similar index saved: ${p.files}/${p.total_files ?? "?"} files, ${p.indexed} indexed, ${p.changed ?? 0} changed, ${p.reused} reused`;
    case "progress_similar_match_start":
      return `Similar matching started: ${p.total} indexed image(s)`;
    case "progress_similar_match":
      return `Similar matching: ${p.current}/${p.total}, ${p.pairs} candidate pair(s)`;
    case "progress_similar_done":
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
    case "progress_scan_start":
      setTaskProgress({ main: { label: t(language, "scan"), current: 0, total: 0, indeterminate: true } });
      break;
    case "progress_scan_files":
      setTaskProgress({
        main: {
          label: `${t(language, "scan")}: ${numberValue(p.files)} files`,
          current: 0,
          total: 0,
          indeterminate: true
        }
      });
      break;
    case "progress_scan_done":
      setTaskProgress({ main: { label: t(language, "scan"), current: 1, total: 1 } });
      break;
    case "progress_resolve_artist":
    case "progress_fuzzy_artist":
      setTaskProgress({
        main: {
          label: `${t(language, "scan")}: ${String(p.name ?? "")}`,
          current: numberValue(p.current),
          total: numberValue(p.total)
        }
      });
      break;
    case "progress_check_start":
      setTaskProgress({
        main: { label: t(language, "checkUpdates"), current: 0, total: numberValue(p.total) }
      });
      break;
    case "progress_check_artist":
      setTaskProgress({
        main: {
          label: `${t(language, "checkUpdates")}: ${String(p.artist ?? "")}`,
          current: numberValue(p.current),
          total: numberValue(p.total)
        }
      });
      break;
    case "progress_download_start":
      setTaskProgress({
        main: {
          label: t(language, "totalProgress"),
          current: 0,
          total: numberValue(p.total_works),
          indeterminate: numberValue(p.total_works) === 0
        }
      });
      break;
    case "progress_download_work":
      setTaskProgress((current) => ({
        main: {
          label: `${t(language, "totalProgress")}: ${String(p.artist ?? "")}`,
          current: Math.max(0, numberValue(p.global_current) - 1),
          total: numberValue(p.global_total)
        },
        file: current?.file
      }));
      break;
    case "progress_download_work_done":
      setTaskProgress((current) => ({
        main: {
          label: t(language, "totalProgress"),
          current: numberValue(p.global_done),
          total: numberValue(p.global_total)
        },
        file: current?.file
      }));
      break;
    case "progress_download_file_start":
    case "progress_download_file_progress":
    case "progress_download_file_done":
      setTaskProgress((current) => ({
        main: current?.main || { label: t(language, "totalProgress"), current: 0, total: 0, indeterminate: true },
        file: {
          label: `${t(language, "currentFile")}: ${String(p.filename ?? p.work_id ?? "")}`,
          current: numberValue(p.downloaded_bytes),
          total: numberValue(p.total_bytes),
          indeterminate: numberValue(p.total_bytes) === 0 && event.key !== "progress_download_file_done",
          speedBps: numberValue(p.speed_bps)
        }
      }));
      break;
    case "progress_similar_start":
      setTaskProgress({ main: { label: t(language, "findSimilar"), current: 0, total: 0, indeterminate: true } });
      break;
    case "progress_similar_file_start":
    case "progress_similar_files":
    case "progress_similar_index_saved": {
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
    case "progress_similar_match_start":
      setTaskProgress({
        main: {
          label: `${t(language, "findSimilar")}: matching`,
          current: 0,
          total: numberValue(p.total),
          indeterminate: numberValue(p.total) === 0
        }
      });
      break;
    case "progress_similar_match":
      setTaskProgress({
        main: {
          label: `${t(language, "findSimilar")}: matching ${numberValue(p.pairs)} pairs`,
          current: numberValue(p.current),
          total: numberValue(p.total)
        }
      });
      break;
    case "progress_similar_done":
      setTaskProgress({ main: { label: t(language, "findSimilar"), current: 1, total: 1 } });
      break;
    default:
      break;
  }
}
