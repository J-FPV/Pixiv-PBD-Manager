import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolve } from "@tauri-apps/api/path";
import { runGuiApi } from "../api";
import { isRecoveryLocked } from "../utils/recoveryGate";
import { useDebouncedValue } from "./useDebouncedValue";
import type { NativeSyncStatus, SyncDelta } from "../types.sync";
import type { AppState } from "./useAppState";

// Polling runs every second; keep the previous array when nothing changed so
// App does not re-render on every tick.
const sameList = (next: string[]) => (current: string[]) =>
  current.length === next.length && current.every((value, index) => value === next[index]) ? current : next;

export function useDirectorySync(s: AppState, mergeDelta: (delta: SyncDelta) => void) {
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [pending, setPending] = useState(0);
  const latest = useRef({ s, paused, mergeDelta });
  useEffect(() => { latest.current = { s, paused, mergeDelta }; });
  const liveRoots = JSON.stringify(s.settings.download_roots || []);
  const liveExcludes = JSON.stringify([...new Set([...(s.settings.exclude_roots || []), s.settings.quarantine_dir,
    ...s.cleanupSummary.operations.map((operation) => operation.quarantine_root),
    /^[A-Za-z]:[\\/]|^\//.test(s.projectRootValue) ? `${s.projectRootValue}/.pixiv-pbd-manager` : ""].filter(Boolean))]);
  const liveEnabled = s.settings.auto_sync !== false && liveRoots !== "[]";
  // Settings autosave 800 ms after the last edit. Reconfigure only once editing
  // has settled, so a half-typed root never restarts the watcher and a full audit.
  const settled = useDebouncedValue(JSON.stringify([liveRoots, liveExcludes, liveEnabled, s.projectRootValue]), 1500);
  const [roots, excludes, enabled, base] = JSON.parse(settled) as [string, string, boolean, string];
  useEffect(() => {
    if (import.meta.env.DEV && import.meta.env.VITE_GUI_API_MODE === "mock") return;
    let disposed = false, polling = false, retryAfter = 0;
    const abort = new AbortController();
    const ready = (async () => {
      const resolvePaths = (json: string) => Promise.all((JSON.parse(json) as string[]).map((path) => resolve(base, path)));
      return invoke("configure_directory_sync", { roots: await resolvePaths(roots), excludes: await resolvePaths(excludes), enabled });
    })();
    const poll = async () => {
      if (disposed || polling || Date.now() < retryAfter) return;
      polling = true;
      try {
        await ready;
        const state = latest.current;
        const status = await invoke<NativeSyncStatus>("poll_directory_sync", { paused: state.paused || state.s.anyBusy || isRecoveryLocked() });
        if (disposed) return;
        setError(status.error);
        setUnavailable(sameList(status.unavailable));
        const batch = status.batch;
        if (!batch) return;
        setRunning(true);
        let success = false, retryPaths: string[] = [], unavailablePaths: string[] = [];
        try {
          // No settings in the payload: Python syncs the saved roots and excludes,
          // never in-progress edits, and rejects the batch if they change mid-run.
          const result = await runGuiApi<SyncDelta>("library.sync", { changed_paths: batch.paths, full: batch.full }, (event) => {
            if (event.type === "progress" && !disposed) {
              const payload = event.payload as { files?: number; total_files?: number };
              if (payload?.files !== undefined) setProgress(`${payload.files} / ${payload.total_files ?? ""}`);
            }
          }, { signal: abort.signal, gracefulCancel: true });
          success = !result.cancelled;
          if (!success) return;
          retryPaths = result.pending;
          unavailablePaths = result.unavailable.map((item) => item.path);
          if (!disposed) {
            setPending(retryPaths.length);
            setUnavailable(sameList([...new Set([...status.unavailable, ...unavailablePaths])]));
          }
          // The batch is committed even when a reconfigure disposed this run
          // meanwhile; the next audit will not report these changes again.
          const current = latest.current.s;
          const selectedId = current.libraryImages.find((image) => image.path === current.librarySelectedPath)?.image_id;
          const moved = selectedId && result.upserts.find((image) => image.image_id === selectedId);
          if (moved) current.setLibrarySelectedPath(moved.path);
          if (current.libraryLoadedRef.current) latest.current.mergeDelta(result);
          current.setAnnotationStatus(result.annotation_status);
          current.setLibraryNeedsScan(result.indexed === 0);
          window.dispatchEvent(new CustomEvent("pbd-library-sync", { detail: result }));
        } finally {
          await invoke("acknowledge_directory_sync", { generation: batch.generation, token: batch.token, success, retryPaths, unavailablePaths });
          if (!disposed) { setRunning(false); setProgress(""); }
        }
      } catch (reason) { if (!disposed) { setError(String(reason)); retryAfter = Date.now() + 5000; } }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { disposed = true; abort.abort(); window.clearInterval(timer); };
  }, [roots, excludes, enabled, base]);
  return { enabled, paused, running, error, unavailable, pending, progress, togglePaused: () => setPaused((value) => !value) };
}
export type DirectorySyncController = ReturnType<typeof useDirectorySync>;
