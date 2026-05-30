import { t } from "../../i18n";
import type { Language, TaskLane } from "../../types";
import type { LaneState } from "../../hooks/useTaskRunner";
import { TaskCenter } from "./TaskCenter";

export function AppFooter({
  language,
  status,
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
      <span>{t(language, "status")}: {status}</span>
      <span>{artistsCount} artists</span>
      <span>{selectedCount} selected</span>
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
