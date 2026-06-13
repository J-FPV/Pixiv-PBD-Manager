import { browsePath } from "../../api";
import { t } from "../../i18n";
import type { AppSettings, Language } from "../../types";
import { joinLines, splitLines } from "../../utils/paths";
import { clampTextareaHeight } from "../../utils/textarea";
import { BrowseButton, LocationButton } from "./controls";
import type { SettingsUpdate } from "./types";

type DirectoryBoxHeightKey = "download_roots_textarea_height" | "exclude_roots_textarea_height";

export function FoldersSection({
  language,
  settings,
  update,
  openPath
}: {
  language: Language;
  settings: AppSettings;
  update: SettingsUpdate;
  openPath: (path: string) => void;
}) {
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

  return (
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
        <label className="full">
          <span>{t(language, "quarantineFolder")}</span>
          <div className="pathRow">
            <input
              value={settings.quarantine_dir || ""}
              onChange={(event) => update("quarantine_dir", event.target.value)}
            />
            <BrowseButton language={language} kind="folder" apply={(value) => update("quarantine_dir", value)} />
            <LocationButton
              language={language}
              path={settings.quarantine_dir || ""}
              openPath={openPath}
            />
          </div>
          <small className="fieldHelp">{t(language, "quarantineFolderHint")}</small>
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
  );
}
