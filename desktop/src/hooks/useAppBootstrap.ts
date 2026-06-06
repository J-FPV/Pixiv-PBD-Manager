import { useEffect } from "react";
import { runGuiApi, setProjectRoot } from "../api";
import { t } from "../i18n";
import type { AppSettings, ArtistsPayload, SettingsPayload } from "../types";
import type { AppState } from "./useAppState";
import { settingsAutosaveSignature } from "./useSettingsAutosave";

// Runs once on mount: loads settings + artists, seeds the autosave baseline so
// the first paint doesn't trigger a redundant save, and reports readiness.
export function useAppBootstrap(
  s: AppState,
  applySettingsPayload: (payload: SettingsPayload) => AppSettings,
  markAutosaveReady: (signature: string) => void
): void {
  const {
    handleEvent,
    setArtists,
    setArtistTags,
    setProjectRootState,
    appendLog,
    setStatus,
    projectRootValue,
    pythonCommandValue,
    language: languageValue
  } = s;

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const payload = await runGuiApi<SettingsPayload>("settings.get", {}, handleEvent);
        const mergedSettings = applySettingsPayload(payload);
        const artistPayload = await runGuiApi<ArtistsPayload>("artists.list", {}, handleEvent);
        setArtists(artistPayload.artists);
        setArtistTags(artistPayload.tags ?? []);
        if (artistPayload.project_root) {
          setProjectRootState(artistPayload.project_root);
          setProjectRoot(artistPayload.project_root);
        }
        markAutosaveReady(
          settingsAutosaveSignature(
            mergedSettings,
            payload.cookie_consent,
            payload.pixiv_cookie || "",
            artistPayload.project_root || payload.project_root || projectRootValue,
            pythonCommandValue
          )
        );
        appendLog("info", "Desktop GUI ready");
        setStatus(t(payload.settings.language || "zh", "ready"));
      } catch (error) {
        appendLog("error", error instanceof Error ? error.message : String(error));
        setStatus(t(languageValue, "error"));
      }
    };
    void loadInitial();
    // Mount-only: deliberately runs a single time with the initial closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
