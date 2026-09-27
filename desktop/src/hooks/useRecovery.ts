import { useCallback, useEffect, useRef, useState } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ArtistsPayload, SettingsPayload } from "../types";
import type { BackupList, HistoryList } from "../types.recovery";
import type { AppState } from "./useAppState";
import type { LibraryActions } from "./useLibraryActions";
import { beginRecovery, endRecovery } from "../utils/recoveryGate";
import { applyPreferences } from "../utils/recoveryPreferences";
import { SIMILAR_RESULT_CACHE_KEY, UNMATCHED_CACHE_KEY } from "../constants";

export function useRecovery(s: AppState, library: LibraryActions) {
  const [backups, setBackups] = useState<BackupList>({ backups: [], directory: "", warning: "" });
  const [history, setHistory] = useState<HistoryList>({ entries: [], latest_id: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quickUndo, setQuickUndo] = useState<string | null>(null);
  const latest = useRef({ s, library });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { latest.current = { s, library }; });
  const refresh = useCallback(async () => {
    const entries = await runGuiApi<HistoryList>("history.list");
    setHistory(entries);
    setBackups(await runGuiApi<BackupList>("backup.list"));
  }, []);
  useEffect(() => {
    void refresh().catch((reason) => setError(String(reason)));
    const saved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.result?.undo_operation) {
        setQuickUndo(detail.result.undo_operation.id);
        void refresh().catch((reason) => setError(String(reason)));
      } else if (detail.command === "settings.save") {
        void refresh().catch((reason) => setError(String(reason)));
      }
    };
    window.addEventListener("pbd-api-result", saved);
    return () => window.removeEventListener("pbd-api-result", saved);
  }, [refresh]);
  useEffect(() => {
    if (!quickUndo) return;
    const timer = window.setTimeout(() => setQuickUndo(null), 7000);
    return () => window.clearTimeout(timer);
  }, [quickUndo]);

  const run = async <T,>(command: string, payload: object = {}, exclusive = false): Promise<T | null> => {
    if (controller.current) return null;
    if (exclusive && latest.current.s.anyBusy) { setError(t(s.language, "recoveryWait")); return null; }
    let locked = false;
    try {
      if (exclusive) { beginRecovery(); locked = true; }
      setBusy(true); setError("");
      controller.current = new AbortController();
      if (command === "backup.create" || command === "backup.preview") {
        await runGuiApi("settings.save", { settings: latest.current.s.settings });
      }
      const result = await runGuiApi<T>(command, payload, undefined, { signal: controller.current.signal, gracefulCancel: true });
      if (command === "backup.restore") {
        try {
          const settings = await runGuiApi<SettingsPayload>("settings.get");
          if ((payload as { categories: string[] }).categories.includes("settings")) applyPreferences(settings.settings.ui_preferences || {});
          localStorage.removeItem(SIMILAR_RESULT_CACHE_KEY);
          localStorage.removeItem(UNMATCHED_CACHE_KEY);
          sessionStorage.setItem("pbd-after-restore", "1");
        } finally {
          // Once committed, keep writes blocked until the fresh page mounts.
          locked = false;
          window.location.reload();
        }
        return result;
      }
      if (locked) { endRecovery(); locked = false; }
      if (command === "history.undo") {
        const artists = await runGuiApi<ArtistsPayload>("artists.list");
        latest.current.s.setArtists(artists.artists);
        latest.current.s.setArtistTags(artists.tags || []);
        await latest.current.library.loadLibrary();
        setQuickUndo(null);
        latest.current.s.showToast(t(s.language, "recoveryDone"));
      }
      await refresh();
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message); latest.current.s.appendLog("error", message);
      return null;
    } finally {
      if (locked) endRecovery();
      controller.current = null;
      setBusy(false);
    }
  };
  return { backups, history, busy, error, quickUndo, setError, setQuickUndo, refresh, run,
    taskBusy: s.anyBusy, cancel: () => controller.current?.abort(),
    undo: (id = history.latest_id) => id ? run("history.undo", { id }, true) : Promise.resolve(null) };
}
