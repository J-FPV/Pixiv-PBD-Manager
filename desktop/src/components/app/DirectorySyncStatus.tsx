import { Pause, Play, RefreshCw } from "lucide-react";
import type { DirectorySyncController } from "../../hooks/useDirectorySync";
import { t } from "../../i18n";
import type { Language } from "../../types";

export function DirectorySyncStatus({ sync, language }: { sync: DirectorySyncController; language: Language }) {
  if (!sync.enabled) return null;
  return <div className="directorySyncStatus" role="status">
    <RefreshCw size={14} className={sync.running ? "spin" : undefined} />
    <span title={sync.error || sync.unavailable.join("\n")}>{t(language, sync.paused ? "syncPaused" : sync.error ? "syncDegraded" : sync.running ? "syncRunning" : "syncIdle")} {sync.progress}{sync.unavailable.length ? ` · ${t(language, "syncUnavailable")}: ${sync.unavailable.length}` : ""}</span>
    {sync.pending > 0 && <span>{t(language, "syncPending")}: {sync.pending}</span>}
    <button className="button iconOnly quiet" title={t(language, sync.paused ? "syncResume" : "syncPause")} onClick={sync.togglePaused}>{sync.paused ? <Play size={14} /> : <Pause size={14} />}</button>
  </div>;
}
