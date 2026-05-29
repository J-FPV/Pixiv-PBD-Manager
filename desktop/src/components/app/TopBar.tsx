import { FolderSearch, Image as ImageIcon, List, Settings as SettingsIcon, Terminal } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { t } from "../../i18n";
import type { Language, TabKey } from "../../types";

export function TopBar({
  language,
  activeTab,
  setActiveTab
}: {
  language: Language;
  activeTab: TabKey;
  setActiveTab: Dispatch<SetStateAction<TabKey>>;
}) {
  const tabs: { key: TabKey; label: string; icon: ReactNode }[] = [
    { key: "artists", label: t(language, "artists"), icon: <List size={18} /> },
    { key: "unmatched", label: t(language, "unmatched"), icon: <FolderSearch size={18} /> },
    { key: "similar", label: t(language, "similar"), icon: <ImageIcon size={18} /> },
    { key: "settings", label: t(language, "settings"), icon: <SettingsIcon size={18} /> },
    { key: "logs", label: t(language, "logs"), icon: <Terminal size={18} /> }
  ];

  return (
    <header className="topbar">
      <div className="brand">Pixiv PBD Manager</div>
      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.key ? "active" : ""}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
