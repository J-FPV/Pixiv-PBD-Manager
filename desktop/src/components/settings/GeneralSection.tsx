import { useEffect, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { t } from "../../i18n";
import type { AppSettings, Language, ThemeMode } from "../../types";
import { BrowseButton, LocationButton } from "./controls";
import type { SettingsUpdate } from "./types";

const RELEASES_URL = "https://github.com/J-FPV/Pixiv-PBD-Manager/releases";

// Version card plus the two reset actions that sit at the bottom of the General
// tab. Owns its own version fetch since nothing above it needs the value.
function GeneralAbout({
  language,
  openReleasePage,
  resetWindowLayout,
  resetSettings,
  busy
}: {
  language: Language;
  openReleasePage: () => void;
  resetWindowLayout: () => void;
  resetSettings: () => void;
  busy: boolean;
}) {
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    let mounted = true;
    void getVersion()
      .then((version) => {
        if (mounted) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (mounted) {
          setAppVersion("");
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <div className="versionCard">
        <div className="versionCardText">
          <span className="versionLabel">{t(language, "softwareVersion")}</span>
          <strong>{appVersion ? `v${appVersion}` : "..."}</strong>
          <p>{t(language, "releasePageHint")}</p>
        </div>
        <button type="button" className="button" onClick={openReleasePage} title={RELEASES_URL}>
          <ExternalLink size={16} />
          {t(language, "releasePage")}
        </button>
      </div>
      <div className="settingsActions resetSettingsAction">
        <div>
          <strong>{t(language, "resetWindowLayout")}</strong>
          <p>{t(language, "resetWindowLayoutHint")}</p>
        </div>
        <button type="button" className="button" onClick={resetWindowLayout}>
          <RotateCcw size={16} />
          {t(language, "resetWindowLayout")}
        </button>
      </div>
      <div className="settingsActions resetSettingsAction">
        <div>
          <strong>{t(language, "resetSettings")}</strong>
          <p>{t(language, "resetSettingsHint")}</p>
        </div>
        <button type="button" className="button danger" disabled={busy} onClick={resetSettings}>
          <RotateCcw size={16} />
          {t(language, "resetSettings")}
        </button>
      </div>
    </>
  );
}

export function GeneralSection({
  language,
  settings,
  update,
  pythonCommand,
  projectRoot,
  setLanguage,
  setProjectRootValue,
  setPythonCommandValue,
  openReleasePage,
  openPath,
  resetWindowLayout,
  resetSettings,
  busy
}: {
  language: Language;
  settings: AppSettings;
  update: SettingsUpdate;
  pythonCommand: string;
  projectRoot: string;
  setLanguage: (value: Language) => void;
  setProjectRootValue: (value: string) => void;
  setPythonCommandValue: (value: string) => void;
  openReleasePage: () => void;
  openPath: (path: string) => void;
  resetWindowLayout: () => void;
  resetSettings: () => void;
  busy: boolean;
}) {
  return (
    <div className="settingsGroup">
      <h3>{t(language, "secGeneral")}</h3>
      <div className="fieldGrid">
        <label>
          <span>{t(language, "language")}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          <span>{t(language, "theme")}</span>
          <select
            value={settings.theme || "system"}
            onChange={(event) => update("theme", event.target.value as ThemeMode)}
          >
            <option value="system">{t(language, "themeSystem")}</option>
            <option value="light">{t(language, "themeLight")}</option>
            <option value="dark">{t(language, "themeDark")}</option>
          </select>
        </label>
        <label>
          <span>{t(language, "pythonCommand")}</span>
          <select value={pythonCommand === "py" ? "py" : "python"} onChange={(event) => setPythonCommandValue(event.target.value)}>
            <option value="python">python</option>
            <option value="py">py</option>
          </select>
        </label>
        <label>
          <span>{t(language, "downloadConcurrency")}</span>
          <input
            type="number"
            min="1"
            max="5"
            value={settings.download_concurrency ?? 1}
            onChange={(event) =>
              update("download_concurrency", Math.min(5, Math.max(1, Math.round(Number(event.target.value) || 1))))
            }
          />
          <small className="fieldHelp">{t(language, "downloadConcurrencyHint")}</small>
        </label>
        <label className="full">
          <span>{t(language, "projectRoot")}</span>
          <div className="pathRow">
            <input value={projectRoot} onChange={(event) => setProjectRootValue(event.target.value)} />
            <BrowseButton language={language} kind="folder" apply={setProjectRootValue} />
            <LocationButton language={language} path={projectRoot} openPath={openPath} />
          </div>
        </label>
        <label className="full">
          <span>{t(language, "database")}</span>
          <div className="pathRow">
            <input value={settings.database || ""} onChange={(event) => update("database", event.target.value)} />
            <BrowseButton language={language} kind="save" apply={(value) => update("database", value)} />
            <LocationButton language={language} path={settings.database || ""} openPath={openPath} />
          </div>
        </label>
      </div>
      <div className="checkColumn">
        <label>
          <input
            type="checkbox"
            checked={settings.show_progress_percent !== false}
            onChange={(event) => update("show_progress_percent", event.target.checked)}
          />
          <span>{t(language, "showProgressPercent")}</span>
        </label>
      </div>
      <GeneralAbout
        language={language}
        openReleasePage={openReleasePage}
        resetWindowLayout={resetWindowLayout}
        resetSettings={resetSettings}
        busy={busy}
      />
    </div>
  );
}
