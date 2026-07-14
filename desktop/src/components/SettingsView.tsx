import { useState } from "react";
import type { ReactNode } from "react";
import { Folder, Globe, Key, Search, SlidersHorizontal } from "lucide-react";
import { t } from "../i18n";
import type { AppSettings, Language, ReleaseInfo } from "../types";
import { BrowserSection } from "./settings/BrowserSection";
import { CookieSection } from "./settings/CookieSection";
import { FoldersSection } from "./settings/FoldersSection";
import { GeneralSection } from "./settings/GeneralSection";
import { ScanSection } from "./settings/ScanSection";

type SettingsSection = "general" | "folders" | "scan" | "browser" | "cookie";

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
  openExternalPage,
  checkLatestRelease,
  openPath,
  resetWindowLayout,
  resetSettings,
  busy,
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
  openExternalPage: (url: string) => void;
  checkLatestRelease: (currentVersion: string) => Promise<ReleaseInfo | null>;
  openPath: (path: string) => void;
  resetWindowLayout: () => void;
  resetSettings: () => void;
  busy: boolean;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState<SettingsSection>("general");
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings({ ...settings, [key]: value });
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
            <GeneralSection
              language={language}
              settings={settings}
              update={update}
              pythonCommand={pythonCommand}
              projectRoot={projectRoot}
              setLanguage={setLanguage}
              setProjectRootValue={setProjectRootValue}
              setPythonCommandValue={setPythonCommandValue}
              openReleasePage={openReleasePage}
              openExternalPage={openExternalPage}
              checkLatestRelease={checkLatestRelease}
              openPath={openPath}
              resetWindowLayout={resetWindowLayout}
              resetSettings={resetSettings}
              busy={busy}
            />
          ) : null}
          {section === "folders" ? (
            <FoldersSection language={language} settings={settings} update={update} openPath={openPath} />
          ) : null}
          {section === "scan" ? <ScanSection language={language} settings={settings} update={update} /> : null}
          {section === "browser" ? (
            <BrowserSection language={language} settings={settings} update={update} notify={notify} />
          ) : null}
          {section === "cookie" ? (
            <CookieSection
              language={language}
              cookieConsent={cookieConsent}
              onToggleConsent={onToggleConsent}
              viewDisclaimer={viewDisclaimer}
              pixivCookie={pixivCookie}
              setPixivCookie={setPixivCookie}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
