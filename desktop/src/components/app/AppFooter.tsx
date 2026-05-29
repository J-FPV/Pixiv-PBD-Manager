import { Pause, Play, XCircle } from "lucide-react";
import { t } from "../../i18n";
import type { Language, TaskProgressState } from "../../types";
import { Button } from "../Button";
import { ProgressLine } from "../ProgressLine";

export function AppFooter({
  language,
  status,
  artistsCount,
  selectedCount,
  runningTask,
  paused,
  taskProgress,
  showProgressPercent,
  resumeCurrentTask,
  pauseCurrentTask,
  cancelCurrentTask
}: {
  language: Language;
  status: string;
  artistsCount: number;
  selectedCount: number;
  runningTask: string | null;
  paused: boolean;
  taskProgress: TaskProgressState | null;
  showProgressPercent: boolean;
  resumeCurrentTask: () => void;
  pauseCurrentTask: () => void;
  cancelCurrentTask: () => void;
}) {
  return (
    <footer>
      <span>{t(language, "status")}: {status}</span>
      <span>{artistsCount} artists</span>
      <span>{selectedCount} selected</span>
      {runningTask && taskProgress ? (
        <div className="footerProgress">
          <ProgressLine line={taskProgress.main} showPercent={showProgressPercent} />
          {taskProgress.file ? <ProgressLine line={taskProgress.file} showPercent={showProgressPercent} /> : null}
        </div>
      ) : null}
      {runningTask ? (
        paused ? (
          <Button icon={<Play size={16} />} onClick={resumeCurrentTask}>
            {t(language, "resumeTask")}
          </Button>
        ) : (
          <Button icon={<Pause size={16} />} onClick={pauseCurrentTask}>
            {t(language, "pauseTask")}
          </Button>
        )
      ) : null}
      {runningTask ? (
        <Button icon={<XCircle size={16} />} variant="danger" onClick={cancelCurrentTask}>
          {t(language, "cancelTask")}
        </Button>
      ) : null}
    </footer>
  );
}
