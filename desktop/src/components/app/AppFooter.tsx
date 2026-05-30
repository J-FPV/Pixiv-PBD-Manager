import { Pause, Play, XCircle } from "lucide-react";
import { t } from "../../i18n";
import { TASK_LANES, type Language, type TaskLane } from "../../types";
import type { LaneState } from "../../hooks/useTaskRunner";
import { Button } from "../Button";
import { ProgressLine } from "../ProgressLine";

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
  // One row per running lane, stacked so a library task and a similar task can
  // show their own progress + controls at the same time.
  const activeLanes = TASK_LANES.filter((lane) => lanes[lane].runningTask);
  return (
    <footer>
      <span>{t(language, "status")}: {status}</span>
      <span>{artistsCount} artists</span>
      <span>{selectedCount} selected</span>
      <div className="footerTasks">
        {activeLanes.map((lane) => {
          const { paused, taskProgress } = lanes[lane];
          return (
            <div className="footerTask" key={lane}>
              {taskProgress ? (
                <div className="footerProgress">
                  <ProgressLine line={taskProgress.main} showPercent={showProgressPercent} />
                  {taskProgress.file ? <ProgressLine line={taskProgress.file} showPercent={showProgressPercent} /> : null}
                </div>
              ) : null}
              {paused ? (
                <Button icon={<Play size={16} />} onClick={() => resumeTask(lane)}>
                  {t(language, "resumeTask")}
                </Button>
              ) : (
                <Button icon={<Pause size={16} />} onClick={() => pauseTask(lane)}>
                  {t(language, "pauseTask")}
                </Button>
              )}
              <Button icon={<XCircle size={16} />} variant="danger" onClick={() => cancelTask(lane)}>
                {t(language, "cancelTask")}
              </Button>
            </div>
          );
        })}
      </div>
    </footer>
  );
}
