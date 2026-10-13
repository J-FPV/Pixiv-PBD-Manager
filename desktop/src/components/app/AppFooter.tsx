import { t } from "../../i18n";
import type { Language, TaskLane } from "../../types";
import type { LaneState } from "../../hooks/useTaskRunner";
import type { DirectorySyncController } from "../../hooks/useDirectorySync";
import { DirectorySyncStatus } from "./DirectorySyncStatus";
import { TaskCenter } from "./TaskCenter";

export function AppFooter({
  language,
  status,
  showCounts,
  sync,
  artistsCount,
  selectedCount,
  lanes,
  showProgressPercent,
  resumeTask,
  pauseTask,
  cancelTask
}: {
  language: Language;
  status: string;
  showCounts: boolean;
  sync: DirectorySyncController;
  artistsCount: number;
  selectedCount: number;
  lanes: Record<TaskLane, LaneState>;
  showProgressPercent: boolean;
  resumeTask: (lane: TaskLane) => void;
  pauseTask: (lane: TaskLane) => void;
  cancelTask: (lane: TaskLane) => void;
}) {
  return (
    <footer>
      <span className="footerStatus">{t(language, "status")}: {status}</span>
      {showCounts ? <span className="footerCounts">
        <span>{t(language, "footerArtists").replace("{count}", String(artistsCount))}</span>
        {selectedCount > 0 ? <span>{t(language, "footerSelected").replace("{count}", String(selectedCount))}</span> : null}
      </span> : null}
      <DirectorySyncStatus sync={sync} language={language} />
      <TaskCenter
        language={language}
        lanes={lanes}
        showProgressPercent={showProgressPercent}
        resumeTask={resumeTask}
        pauseTask={pauseTask}
        cancelTask={cancelTask}
      />
    </footer>
  );
}
