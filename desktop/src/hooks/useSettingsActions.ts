import type { Dispatch, SetStateAction } from "react";
import { runGuiApi, setProjectRoot, setPythonCommand } from "../api";
import { t } from "../i18n";
import type { ApiEvent, AppSettings, ConfirmState, Language, LogEntry, SettingsPayload } from "../types";
import { DEFAULT_SETTINGS } from "../constants";
import { joinLines } from "../utils/paths";
import { resetCurrentWindowLayout } from "../utils/window";

// Settings tab actions plus the cookie-consent flow. As with the other action
// hooks, the state lives in App and only the logic moves here.
export interface SettingsActionsDeps {
  language: Language;
  settings: AppSettings;
  cookieConsent: boolean;
  initialSimilarSkipPixivPages: boolean | undefined;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setLanguageState: Dispatch<SetStateAction<Language>>;
  setCookieConsent: Dispatch<SetStateAction<boolean>>;
  setPixivCookie: Dispatch<SetStateAction<string>>;
  setSimilarRoots: Dispatch<SetStateAction<string>>;
  setSimilarExcludes: Dispatch<SetStateAction<string>>;
  setSimilarRootBoxHeight: Dispatch<SetStateAction<number | undefined>>;
  setSimilarExcludeBoxHeight: Dispatch<SetStateAction<number | undefined>>;
  setExpandedGroups: Dispatch<SetStateAction<Set<number>>>;
  setProjectRootState: Dispatch<SetStateAction<string>>;
  setPythonCommandState: Dispatch<SetStateAction<string>>;
  setDisclaimer: Dispatch<SetStateAction<"accept" | "view" | null>>;
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
  appendLog: (level: LogEntry["level"], message: string) => void;
  showToast: (message: string) => void;
  handleEvent: (event: ApiEvent) => void;
}

export interface SettingsActions {
  applySettingsPayload: (payload: SettingsPayload) => AppSettings;
  setLanguage: (value: Language) => void;
  onToggleConsent: (next: boolean) => void;
  acceptDisclaimer: () => void;
  resetSettings: () => void;
  resetWindowLayout: () => Promise<void>;
  openReleasePage: () => Promise<void>;
}

export function useSettingsActions(deps: SettingsActionsDeps): SettingsActions {
  const {
    language: languageValue,
    settings,
    cookieConsent,
    initialSimilarSkipPixivPages,
    setSettings,
    setLanguageState,
    setCookieConsent,
    setPixivCookie,
    setSimilarRoots,
    setSimilarExcludes,
    setSimilarRootBoxHeight,
    setSimilarExcludeBoxHeight,
    setExpandedGroups,
    setProjectRootState,
    setPythonCommandState,
    setDisclaimer,
    setConfirm,
    appendLog,
    showToast,
    handleEvent
  } = deps;

  const applySettingsPayload = (payload: SettingsPayload): AppSettings => {
    const merged = { ...DEFAULT_SETTINGS, ...payload.settings };
    if (
      !Object.prototype.hasOwnProperty.call(payload.settings, "similar_skip_pixiv_pages") &&
      typeof initialSimilarSkipPixivPages === "boolean"
    ) {
      merged.similar_skip_pixiv_pages = initialSimilarSkipPixivPages;
    }
    setSettings(merged);
    setLanguageState((merged.language || "zh") as Language);
    setCookieConsent(payload.cookie_consent);
    setPixivCookie(payload.pixiv_cookie || "");
    setSimilarRoots((current) => current || joinLines(merged.download_roots));
    if (payload.project_root) {
      setProjectRootState(payload.project_root);
      setProjectRoot(payload.project_root);
    }
    return merged;
  };

  const setLanguage = (value: Language) => {
    setLanguageState(value);
    setSettings({ ...settings, language: value });
  };

  const onToggleConsent = (next: boolean) => {
    if (next && !cookieConsent) {
      setDisclaimer("accept");
      return;
    }
    if (!next) {
      void runGuiApi<SettingsPayload>("cookie.revoke", {}, handleEvent)
        .then((payload) => {
          applySettingsPayload(payload);
          appendLog("info", t(languageValue, "cookieRevoked"));
        })
        .catch((error) => {
          appendLog("error", error instanceof Error ? error.message : String(error));
        });
      return;
    }
    setCookieConsent(next);
  };

  const acceptDisclaimer = () => {
    setCookieConsent(true);
    setDisclaimer(null);
  };

  const resetSettings = () => {
    setConfirm({
      title: t(languageValue, "resetSettings"),
      body: t(languageValue, "confirmResetSettings"),
      confirmLabel: t(languageValue, "resetSettings"),
      onConfirm: async () => {
        const resetValues: AppSettings = {
          ...DEFAULT_SETTINGS,
          database: settings.database || DEFAULT_SETTINGS.database
        };
        try {
          const payload = await runGuiApi<SettingsPayload>(
            "settings.save",
            {
              settings: resetValues,
              cookie_consent: false,
              pixiv_cookie: ""
            },
            handleEvent
          );
          applySettingsPayload(payload);
          setPythonCommandState("python");
          setPythonCommand("python");
          setSimilarRoots("");
          setSimilarExcludes("");
          setSimilarRootBoxHeight(undefined);
          setSimilarExcludeBoxHeight(undefined);
          setExpandedGroups(new Set());
          const message = t(languageValue, "settingsReset");
          appendLog("info", message);
          showToast(message);
        } catch (error) {
          appendLog("error", error instanceof Error ? error.message : String(error));
        }
      }
    });
  };

  const resetWindowLayout = async () => {
    try {
      await resetCurrentWindowLayout();
      const message = t(languageValue, "windowLayoutReset");
      appendLog("info", message);
      showToast(message);
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  };

  const openReleasePage = async () => {
    try {
      const releaseUrl = "https://github.com/J-FPV/Pixiv-PBD-Manager/releases";
      const result = await runGuiApi<{ opened: number }>(
        "browser.open",
        { ...settings, urls: [releaseUrl] },
        handleEvent
      );
      appendLog("info", `Opened ${result.opened} page(s)`);
    } catch (error) {
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  };

  return {
    applySettingsPayload,
    setLanguage,
    onToggleConsent,
    acceptDisclaimer,
    resetSettings,
    resetWindowLayout,
    openReleasePage
  };
}
