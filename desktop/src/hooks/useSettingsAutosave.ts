import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { runGuiApi, setProjectRoot, setPythonCommand } from "../api";
import type { ApiEvent, AppSettings, LogEntry, SettingsPayload } from "../types";

// Stable string fingerprint of everything the auto-save persists. App also uses
// it to seed the baseline after the initial load (see markAutosaveReady).
export function settingsAutosaveSignature(
  settings: AppSettings,
  cookieConsent: boolean,
  pixivCookie: string,
  projectRoot: string,
  pythonCommand: string
): string {
  return JSON.stringify({ settings, cookieConsent, pixivCookie, projectRoot, pythonCommand });
}

export interface SettingsAutosaveParams {
  settings: AppSettings;
  cookieConsent: boolean;
  pixivCookie: string;
  projectRootValue: string;
  pythonCommandValue: string;
  handleEventRef: MutableRefObject<(event: ApiEvent) => void>;
  appendLogRef: MutableRefObject<(level: LogEntry["level"], message: string) => void>;
}

// Debounced auto-save of settings. The effect fingerprints the persisted fields
// and, once App marks itself ready (after the initial load), saves 800ms after
// the last change. handleEvent/appendLog come in as refs so the deferred save
// always uses the latest closures. markAutosaveReady lets App seed the baseline
// signature without provoking an immediate save on first paint.
export function useSettingsAutosave({
  settings,
  cookieConsent,
  pixivCookie,
  projectRootValue,
  pythonCommandValue,
  handleEventRef,
  appendLogRef
}: SettingsAutosaveParams): { markAutosaveReady: (signature: string) => void } {
  const readyRef = useRef(false);
  const lastSignatureRef = useRef("");
  const saveSeqRef = useRef(0);

  useEffect(() => {
    const signature = settingsAutosaveSignature(
      settings,
      cookieConsent,
      pixivCookie,
      projectRootValue,
      pythonCommandValue
    );
    if (!readyRef.current) {
      lastSignatureRef.current = signature;
      return undefined;
    }
    if (signature === lastSignatureRef.current) {
      return undefined;
    }

    const saveSeq = saveSeqRef.current + 1;
    saveSeqRef.current = saveSeq;
    const timer = window.setTimeout(() => {
      setProjectRoot(projectRootValue);
      setPythonCommand(pythonCommandValue);
      void runGuiApi<SettingsPayload>(
        "settings.save",
        { settings, cookie_consent: cookieConsent, pixiv_cookie: pixivCookie },
        (event) => handleEventRef.current(event)
      )
        .then(() => {
          if (saveSeqRef.current === saveSeq) {
            lastSignatureRef.current = signature;
          }
        })
        .catch((error) => {
          if (saveSeqRef.current === saveSeq) {
            appendLogRef.current(
              "error",
              `Auto-save settings failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        });
    }, 800);

    return () => window.clearTimeout(timer);
    // handleEventRef/appendLogRef are stable useRef containers (never change
    // identity), included only to satisfy exhaustive-deps.
  }, [settings, cookieConsent, pixivCookie, projectRootValue, pythonCommandValue, handleEventRef, appendLogRef]);

  return {
    markAutosaveReady: (signature: string) => {
      lastSignatureRef.current = signature;
      readyRef.current = true;
    }
  };
}
