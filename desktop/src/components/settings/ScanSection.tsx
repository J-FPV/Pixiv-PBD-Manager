import { t } from "../../i18n";
import type { AppSettings, Language } from "../../types";
import type { SettingsUpdate } from "./types";

export function ScanSection({
  language,
  settings,
  update
}: {
  language: Language;
  settings: AppSettings;
  update: SettingsUpdate;
}) {
  return (
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
  );
}
