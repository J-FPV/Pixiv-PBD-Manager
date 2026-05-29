import { browsePath } from "../../api";
import { t } from "../../i18n";
import type { AppSettings, Language } from "../../types";
import { isUnsafeUserDataDir } from "../../utils/paths";
import { BrowseButton } from "./controls";
import type { SettingsUpdate } from "./types";

export function BrowserSection({
  language,
  settings,
  update,
  notify
}: {
  language: Language;
  settings: AppSettings;
  update: SettingsUpdate;
  notify: (message: string) => void;
}) {
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

  return (
    <div className="settingsGroup">
      <h3>{t(language, "secBrowser")}</h3>
      <div className="fieldGrid">
        <label className="full">
          <span>{t(language, "browser")}</span>
          <div className="pathRow">
            <input value={settings.browser || ""} onChange={(event) => update("browser", event.target.value)} />
            <BrowseButton language={language} kind="file" apply={(value) => update("browser", value)} />
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
  );
}
