import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { GuiApiCancelledError, type TaskControls } from "../api";
import { t } from "../i18n";
import type { Language, LogEntry, TaskLane, TaskProgressState } from "../types";

// One lane's live task: its label (null when idle), pause state, and the
// footer progress it drives.
export interface LaneState {
  runningTask: string | null;
  paused: boolean;
  taskProgress: TaskProgressState | null;
}

type LaneProgressUpdate =
  | TaskProgressState
  | null
  | ((current: TaskProgressState | null) => TaskProgressState | null);

interface LaneControls {
  cancel: () => void;
  pause: (() => void) | null;
  resume: (() => void) | null;
}

export interface TaskRunner {
  lanes: Record<TaskLane, LaneState>;
  status: string;
  setStatus: Dispatch<SetStateAction<string>>;
  setLaneProgress: (lane: TaskLane, update: LaneProgressUpdate) => void;
  runTask: (
    lane: TaskLane,
    label: string,
    task: (signal: AbortSignal, registerControls: (controls: TaskControls) => void) => Promise<void>
  ) => Promise<void>;
  cancelTask: (lane: TaskLane) => void;
  pauseTask: (lane: TaskLane) => void;
  resumeTask: (lane: TaskLane) => void;
}

const IDLE_LANE: LaneState = { runningTask: null, paused: false, taskProgress: null };

// Encapsulates the task lifecycle across independent lanes: one task at a time
// *per lane*, with abort-via-signal, pause/resume gates wired through to the
// Python subprocess, and a per-lane footer progress bar driven by callers via
// setLaneProgress. The control callbacks are stored per-lane in a ref because
// runTask re-bills them on every run. ``status`` is a single shared "last
// message" line; the per-lane progress bars are the real per-task indicators.
export function useTaskRunner(
  language: Language,
  appendLog: (level: LogEntry["level"], message: string) => void
): TaskRunner {
  const [lanes, setLanes] = useState<Record<TaskLane, LaneState>>({ library: IDLE_LANE, similar: IDLE_LANE });
  const [status, setStatus] = useState("Ready");
  const controlsRef = useRef<Record<TaskLane, LaneControls | null>>({ library: null, similar: null });
  const runningCountRef = useRef(0);

  const patchLane = (lane: TaskLane, patch: Partial<LaneState>) =>
    setLanes((current) => ({ ...current, [lane]: { ...current[lane], ...patch } }));

  const setLaneProgress = (lane: TaskLane, update: LaneProgressUpdate) =>
    setLanes((current) => ({
      ...current,
      [lane]: {
        ...current[lane],
        taskProgress: typeof update === "function" ? update(current[lane].taskProgress) : update
      }
    }));

  const runTask: TaskRunner["runTask"] = async (lane, label, task) => {
    if (lanes[lane].runningTask) {
      appendLog("warn", `${t(language, "running")}: ${lanes[lane].runningTask}`);
      return;
    }
    const controller = new AbortController();
    controlsRef.current[lane] = { cancel: () => controller.abort(), pause: null, resume: null };
    runningCountRef.current += 1;
    patchLane(lane, {
      runningTask: label,
      paused: false,
      taskProgress: { main: { label, current: 0, total: 0, indeterminate: true } }
    });
    setStatus(`${t(language, "running")}: ${label}`);
    const registerControls = (controls: TaskControls) => {
      controlsRef.current[lane] = {
        cancel: () => controller.abort(),
        pause: () => {
          controls.pause();
          patchLane(lane, { paused: true });
          setStatus(t(language, "taskPaused"));
        },
        resume: () => {
          controls.resume();
          patchLane(lane, { paused: false });
          setStatus(`${t(language, "running")}: ${label}`);
        }
      };
    };
    try {
      await task(controller.signal, registerControls);
      // Only reset to "ready" when this was the last running task, so finishing
      // a quick task doesn't blank the status while another lane still works.
      if (runningCountRef.current <= 1) {
        setStatus(t(language, "ready"));
      }
    } catch (error) {
      if (error instanceof GuiApiCancelledError || controller.signal.aborted) {
        appendLog("warn", t(language, "taskCancelled"));
        setStatus(t(language, "taskCancelled"));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      appendLog("error", message);
      setStatus(message);
    } finally {
      controlsRef.current[lane] = null;
      runningCountRef.current -= 1;
      patchLane(lane, { runningTask: null, paused: false, taskProgress: null });
    }
  };

  return {
    lanes,
    status,
    setStatus,
    setLaneProgress,
    runTask,
    cancelTask: (lane) => controlsRef.current[lane]?.cancel(),
    pauseTask: (lane) => controlsRef.current[lane]?.pause?.(),
    resumeTask: (lane) => controlsRef.current[lane]?.resume?.()
  };
}
