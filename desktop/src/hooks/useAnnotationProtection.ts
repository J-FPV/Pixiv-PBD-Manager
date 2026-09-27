import { useEffect, useRef } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { AnnotationStatus } from "../types";
import type { AppState } from "./useAppState";
import { isRecoveryLocked } from "../utils/recoveryGate";

export function useAnnotationProtection(s: AppState, reload: () => Promise<void>) {
  const stopped = useRef(false);
  const running = useRef(false);
  const latest = useRef({ s, reload });
  useEffect(() => { latest.current = { s, reload }; });
  const run = async (retry = false) => {
    const { s: state, reload: refresh } = latest.current;
    if (running.current || state.indexBusy || isRecoveryLocked()) return;
    running.current = true;
    stopped.current = false;
    try {
      await state.runTask("index", t(state.language, "protectAnnotations"), async (signal, registerControls) => {
        try {
          const status = await runGuiApi<AnnotationStatus & { cancelled?: boolean }>(
            "library.annotations.protect", { ...state.settings, retry }, state.handleEvent,
            { signal, onStart: registerControls, gracefulCancel: true });
          stopped.current = Boolean(status.cancelled || signal.aborted);
          state.setAnnotationStatus(status);
          if (state.libraryLoadedRef.current && status.unlinked) await refresh();
        } catch (error) {
          stopped.current = true;
          throw error;
        }
      });
    } finally { running.current = false; }
  };
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; });
  useEffect(() => {
    if (!s.annotationStatus?.pending || s.indexBusy || s.similarBusy || stopped.current) return;
    const timer = window.setTimeout(() => void runRef.current(), 800);
    return () => window.clearTimeout(timer);
  }, [s.annotationStatus?.pending, s.indexBusy, s.similarBusy]);
  return () => void run(true);
}
