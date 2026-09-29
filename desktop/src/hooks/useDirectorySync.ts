import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolve } from "@tauri-apps/api/path";
import { runGuiApi } from "../api";
import { isRecoveryLocked } from "../utils/recoveryGate";
import type { NativeSyncStatus, SyncDelta } from "../types.sync";
import type { AppState } from "./useAppState";

export function useDirectorySync(s: AppState, mergeDelta: (delta: SyncDelta) => void) {
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [pending, setPending] = useState(0);
  const latest = useRef({ s, paused, mergeDelta });
  useEffect(() => { latest.current = { s, paused, mergeDelta }; });
  const roots = JSON.stringify(s.settings.download_roots || []);
  const excludes = JSON.stringify([...new Set([...(s.settings.exclude_roots || []), s.settings.quarantine_dir,
    ...s.cleanupSummary.operations.map((operation) => operation.quarantine_root),
    /^[A-Za-z]:[\\/]|^\//.test(s.projectRootValue) ? `${s.projectRootValue}/.pixiv-pbd-manager` : ""].filter(Boolean))]);
  const enabled = s.settings.auto_sync !== false && roots !== "[]";
  const base = s.projectRootValue;
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
        setUnavailable(status.unavailable);
        const batch = status.batch;
        if (!batch) return;
        setRunning(true);
        let success = false, retryPaths: string[] = [], unavailablePaths: string[] = [];
        try {
          const result = await runGuiApi<SyncDelta>("library.sync", { ...state.s.settings, changed_paths: batch.paths, full: batch.full }, (event) => {
            if (event.type === "progress" && !disposed) {
              const payload = event.payload as { files?: number; total_files?: number };
              if (payload?.files !== undefined) setProgress(`${payload.files} / ${payload.total_files ?? ""}`);
            }
          }, { signal: abort.signal, gracefulCancel: true });
          success = !result.cancelled;
          if (!success || disposed) return;
          retryPaths = result.pending;
          setPending(retryPaths.length);
          unavailablePaths = result.unavailable.map((item) => item.path);
          setUnavailable([...new Set([...status.unavailable, ...result.unavailable.map((item) => item.path)])]);
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
