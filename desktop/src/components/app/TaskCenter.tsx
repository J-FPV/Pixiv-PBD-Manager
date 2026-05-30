import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ListChecks, Loader2, Pause, Play, XCircle } from "lucide-react";
import { t } from "../../i18n";
import { TASK_LANES, type Language, type TaskLane } from "../../types";
import type { LaneState } from "../../hooks/useTaskRunner";
import { Button } from "../Button";
import { ProgressLine } from "../ProgressLine";

// Bottom-right task window, always present. Collapsed it's a single chip:
// "无任务" when idle, the task label / "N 个任务" when running. Clicking expands
// a popover that lists every running lane with its progress bar(s) and
// pause/resume + cancel controls (or an empty-state line when idle). It
// auto-expands the moment a second concurrent task appears and auto-collapses
// once everything is idle; in between it honours whatever the user toggled.
export function TaskCenter({
  language,
  lanes,
  showProgressPercent,
  resumeTask,
  pauseTask,
  cancelTask
}: {
  language: Language;
  lanes: Record<TaskLane, LaneState>;
  showProgressPercent: boolean;
  resumeTask: (lane: TaskLane) => void;
  pauseTask: (lane: TaskLane) => void;
  cancelTask: (lane: TaskLane) => void;
}) {
  const activeLanes = TASK_LANES.filter((lane) => lanes[lane].runningTask);
  const count = activeLanes.length;
  const idle = count === 0;
  const [expanded, setExpanded] = useState(false);
  const previousCount = useRef(0);

  useEffect(() => {
    if (previousCount.current < 2 && count >= 2) {
      setExpanded(true);
    } else if (count === 0) {
      setExpanded(false);
    }
    previousCount.current = count;
  }, [count]);

  const summary = idle
    ? t(language, "noTasks")
    : count > 1
      ? t(language, "tasksRunning").replace("{count}", String(count))
      : lanes[activeLanes[0]].runningTask ?? "";

  return (
    <div className="taskCenter">
      {expanded ? (
        <div className="taskPanel">
          {idle ? <div className="taskPanelEmpty">{t(language, "noTasks")}</div> : null}
          {activeLanes.map((lane) => {
            const { paused, taskProgress } = lanes[lane];
            return (
              <div className="taskPanelRow" key={lane}>
                {taskProgress ? (
                  <div className="footerProgress">
                    <ProgressLine line={taskProgress.main} showPercent={showProgressPercent} />
                    {taskProgress.file ? <ProgressLine line={taskProgress.file} showPercent={showProgressPercent} /> : null}
                  </div>
                ) : null}
                <div className="taskPanelControls">
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
              </div>
            );
          })}
        </div>
      ) : null}
      <button className="taskCenterToggle" onClick={() => setExpanded((value) => !value)}>
        {idle ? <ListChecks size={15} /> : <Loader2 size={15} className="spin" />}
        <span className="taskCenterSummary">{summary}</span>
        {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
    </div>
  );
}
