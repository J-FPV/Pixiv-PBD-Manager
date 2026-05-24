import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, Folder, Globe, Key, Search, SlidersHorizontal } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { browsePath } from "../api";
import type { PathPickKind } from "../api";
import { t } from "../i18n";
import type { AppSettings, Language } from "../types";
import { isUnsafeUserDataDir, joinLines, splitLines } from "../utils/paths";
import { clampTextareaHeight } from "../utils/textarea";

type SettingsSection = "general" | "folders" | "scan" | "browser" | "cookie";
type DirectoryBoxHeightKey = "download_roots_textarea_height" | "exclude_roots_textarea_height";

const RELEASES_URL = "https://github.com/J-FPV/Pixiv-PBD-Manager/releases";

export function SettingsView({
  language,
  settings,
  cookieConsent,
  pixivCookie,
  projectRoot,
  pythonCommand,
  setLanguage,
  setSettings,
  onToggleConsent,
  viewDisclaimer,
  setPixivCookie,
  setProjectRootValue,
  setPythonCommandValue,
  openReleasePage,
  notify
}: {
  language: Language;
  settings: AppSettings;
  cookieConsent: boolean;
  pixivCookie: string;
  projectRoot: string;
  pythonCommand: string;
  setLanguage: (value: Language) => void;
  setSettings: (value: AppSettings) => void;
  onToggleConsent: (next: boolean) => void;
  viewDisclaimer: () => void;
  setPixivCookie: (value: string) => void;
  setProjectRootValue: (value: string) => void;
  setPythonCommandValue: (value: string) => void;
  openReleasePage: () => void;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [showCookie, setShowCookie] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings({ ...settings, [key]: value });
  };

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

  const pick = async (kind: PathPickKind, apply: (value: string) => void) => {
    const picked = await browsePath(kind);
    if (picked) {
      apply(picked);
    }
  };

  const appendFolder = async (key: "download_roots" | "exclude_roots") => {
    const picked = await browsePath("folder");
    if (!picked) {
      return;
    }
    const current = settings[key] || [];
    if (!current.includes(picked)) {
      update(key, [...current, picked]);
    }
  };

  const rememberDirectoryBoxHeight = (key: DirectoryBoxHeightKey, element: HTMLTextAreaElement) => {
    const height = clampTextareaHeight(element.offsetHeight);
    if (height && Math.abs((settings[key] || 0) - height) > 1) {
      update(key, height);
    }
  };

  const browseButton = (kind: PathPickKind, apply: (value: string) => void) => (
    <button type="button" className="button browseButton" onClick={() => void pick(kind, apply)}>
      {t(language, "browse")}
    </button>
  );

  const pickUserDataDir = async () => {
    const picked = await browsePath("folder");
    if (!picked) {
      return;
    }
    if (isUnsafeUserDataDir(picked, settings.download_roots || [])) {
      notify(t(language, "unsafeUserDataDir"));
      return;
    }
    update("user_data_dir", picked);
  };

  const sections: { key: SettingsSection; label: string; icon: ReactNode }[] = [
    { key: "general", label: t(language, "secGeneral"), icon: <SlidersHorizontal size={16} /> },
    { key: "folders", label: t(language, "secFolders"), icon: <Folder size={16} /> },
    { key: "scan", label: t(language, "secScan"), icon: <Search size={16} /> },
    { key: "browser", label: t(language, "secBrowser"), icon: <Globe size={16} /> },
    { key: "cookie", label: t(language, "secCookie"), icon: <Key size={16} /> }
  ];

  return (
    <section className="panel settingsPanel">
      <div className="settingsLayout">
        <nav className="settingsNav">
          {sections.map((item) => (
            <button
              className={section === item.key ? "active" : ""}
              key={item.key}
              onClick={() => setSection(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settingsContent">
          {section === "general" ? (
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
                  <span>{t(language, "pythonCommand")}</span>
                  <select value={pythonCommand === "py" ? "py" : "python"} onChange={(event) => setPythonCommandValue(event.target.value)}>
                    <option value="python">python</option>
                    <option value="py">py</option>
                  </select>
                </label>
                <label className="full">
                  <span>{t(language, "projectRoot")}</span>
                  <div className="pathRow">
                    <input value={projectRoot} onChange={(event) => setProjectRootValue(event.target.value)} />
                    {browseButton("folder", setProjectRootValue)}
                  </div>
                </label>
                <label className="full">
                  <span>{t(language, "database")}</span>
                  <div className="pathRow">
                    <input value={settings.database || ""} onChange={(event) => update("database", event.target.value)} />
                    {browseButton("save", (value) => update("database", value))}
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
            </div>
          ) : null}

          {section === "folders" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secFolders")}</h3>
              <div className="fieldGrid">
                <label className="full">
                  <span>{t(language, "downloadRoots")}</span>
                  <textarea
                    value={joinLines(settings.download_roots)}
                    style={
                      settings.download_roots_textarea_height
                        ? { height: `${settings.download_roots_textarea_height}px` }
                        : undefined
                    }
                    onChange={(event) => update("download_roots", splitLines(event.target.value))}
                    onMouseUp={(event) =>
                      rememberDirectoryBoxHeight("download_roots_textarea_height", event.currentTarget)
                    }
                    onBlur={(event) =>
                      rememberDirectoryBoxHeight("download_roots_textarea_height", event.currentTarget)
                    }
                  />
                  <button type="button" className="button browseButton" onClick={() => void appendFolder("download_roots")}>
                    {t(language, "addFolder")}
                  </button>
                </label>
                <label className="full">
                  <span>{t(language, "excludeRoots")}</span>
                  <textarea
                    value={joinLines(settings.exclude_roots)}
                    style={
                      settings.exclude_roots_textarea_height
                        ? { height: `${settings.exclude_roots_textarea_height}px` }
                        : undefined
                    }
                    onChange={(event) => update("exclude_roots", splitLines(event.target.value))}
                    onMouseUp={(event) =>
                      rememberDirectoryBoxHeight("exclude_roots_textarea_height", event.currentTarget)
                    }
                    onBlur={(event) =>
                      rememberDirectoryBoxHeight("exclude_roots_textarea_height", event.currentTarget)
                    }
                  />
                  <button type="button" className="button browseButton" onClick={() => void appendFolder("exclude_roots")}>
                    {t(language, "addFolder")}
                  </button>
                </label>
              </div>
              <div className="checkColumn">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.separate_r18)}
                    onChange={(event) => update("separate_r18", event.target.checked)}
                  />
                  <span>{t(language, "separateR18")}</span>
                </label>
              </div>
              <p className="fieldHint">{t(language, "separateR18Hint")}</p>
            </div>
          ) : null}

          {section === "scan" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secScan")}</h3>
              <div className="checkColumn">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.resolve_online)}
                    onChange={(event) => update("resolve_online", event.target.checked)}
                  />
                  <span>{t(language, "resolveOnline")}</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.fuzzy_search)}
                    onChange={(event) => update("fuzzy_search", event.target.checked)}
                  />
                  <span>{t(language, "fuzzySearch")}</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.ssl_fallback)}
                    onChange={(event) => update("ssl_fallback", event.target.checked)}
                  />
                  <span>{t(language, "sslFallback")}</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.scan_recognize_low_pids)}
                    onChange={(event) => update("scan_recognize_low_pids", event.target.checked)}
                  />
                  <span>{t(language, "scanRecognizeLowPids")}</span>
                </label>
              </div>
              <p className="fieldHint">{t(language, "scanRecognizeLowPidsHint")}</p>
              <div className="fieldGrid">
                <label>
                  <span>{t(language, "scanMaxDepth")}</span>
                  <input
                    type="number"
                    min="-1"
                    value={settings.scan_max_depth ?? -1}
                    onChange={(event) => update("scan_max_depth", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>{t(language, "updateCheckDepth")}</span>
                  <input
                    type="number"
                    min="-1"
                    value={settings.update_check_depth ?? 0}
                    onChange={(event) => update("update_check_depth", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>{t(language, "resolveLimit")}</span>
                  <input
                    type="number"
                    value={settings.resolve_limit ?? 3}
                    onChange={(event) => update("resolve_limit", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>{t(language, "fuzzyScore")}</span>
                  <input
                    type="number"
                    step="0.05"
                    value={settings.fuzzy_min_score ?? 0.35}
                    onChange={(event) => update("fuzzy_min_score", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>{t(language, "updateCheckPages")}</span>
                  <input
                    type="number"
                    min="0"
                    value={settings.update_check_pages ?? 0}
                    onChange={(event) => update("update_check_pages", Math.max(0, Number(event.target.value) || 0))}
                  />
                </label>
              </div>
              <p className="fieldHint">{t(language, "scanDepthHint")}</p>
              <p className="fieldHint">{t(language, "updateCheckPagesHint")}</p>
            </div>
          ) : null}

          {section === "browser" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secBrowser")}</h3>
              <div className="fieldGrid">
                <label className="full">
                  <span>{t(language, "browser")}</span>
                  <div className="pathRow">
                    <input value={settings.browser || ""} onChange={(event) => update("browser", event.target.value)} />
                    {browseButton("file", (value) => update("browser", value))}
                  </div>
                </label>
                <label className="full">
                  <span>{t(language, "userDataDir")}</span>
                  <div className="pathRow">
                    <input value={settings.user_data_dir || ""} onChange={(event) => update("user_data_dir", event.target.value)} />
                    <button type="button" className="button browseButton" onClick={() => void pickUserDataDir()}>
                      {t(language, "browse")}
                    </button>
                  </div>
                </label>
                <label>
                  <span>{t(language, "delay")}</span>
                  <input type="number" value={settings.delay ?? 1} onChange={(event) => update("delay", Number(event.target.value))} />
                </label>
                <label>
                  <span>{t(language, "limit")}</span>
                  <input type="number" value={settings.limit ?? 10} onChange={(event) => update("limit", Number(event.target.value))} />
                </label>
              </div>
            </div>
          ) : null}

          {section === "cookie" ? (
            <div className="settingsGroup">
              <h3>{t(language, "secCookie")}</h3>
              <div className="consentRow">
                <label className="checkLine">
                  <input type="checkbox" checked={cookieConsent} onChange={(event) => onToggleConsent(event.target.checked)} />
                  <span>{t(language, "cookieConsent")}</span>
                </label>
                <button type="button" className="button browseButton" onClick={viewDisclaimer}>
                  {t(language, "viewDisclaimer")}
                </button>
              </div>
              <p className="fieldHint">{t(language, "cookieHint")}</p>
              <div className="fieldGrid">
                <label className="full">
                  <span>{t(language, "pixivCookie")}</span>
                  <div className="pathRow">
                    <input
                      value={pixivCookie}
                      type={showCookie ? "text" : "password"}
                      onChange={(event) => setPixivCookie(event.target.value)}
                      disabled={!cookieConsent}
                    />
                    <button
                      type="button"
                      className="button browseButton"
                      disabled={!cookieConsent}
                      onClick={() => setShowCookie((value) => !value)}
                    >
                      {t(language, showCookie ? "hideCookie" : "showCookie")}
                    </button>
                  </div>
                </label>
              </div>
            </div>
          ) : null}

        </div>
      </div>
    </section>
  );
}
