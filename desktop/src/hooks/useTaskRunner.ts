import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { GuiApiCancelledError, type TaskControls } from "../api";
import { t } from "../i18n";
import type { Language, LogEntry, TaskProgressState } from "../types";

export interface TaskRunner {
  runningTask: string | null;
  paused: boolean;
  taskProgress: TaskProgressState | null;
  setTaskProgress: Dispatch<SetStateAction<TaskProgressState | null>>;
  status: string;
  setStatus: Dispatch<SetStateAction<string>>;
  runTask: (
    label: string,
    task: (signal: AbortSignal, registerControls: (controls: TaskControls) => void) => Promise<void>
  ) => Promise<void>;
  cancelCurrentTask: () => void;
  pauseCurrentTask: () => void;
  resumeCurrentTask: () => void;
}

// Encapsulates the task lifecycle: one task at a time, with abort-via-signal,
// pause/resume gates wired through to the Python subprocess, and a footer
// progress bar driven by callers via setTaskProgress. The three control
// callbacks are stored in refs because runTask re-bills them on every run.
export function useTaskRunner(language: Language, appendLog: (level: LogEntry["level"], message: string) => void): TaskRunner {
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const [status, setStatus] = useState("Ready");
  const cancelRef = useRef<(() => void) | null>(null);
  const pauseRef = useRef<(() => void) | null>(null);
  const resumeRef = useRef<(() => void) | null>(null);

  const runTask = async (
    label: string,
    task: (signal: AbortSignal, registerControls: (controls: TaskControls) => void) => Promise<void>
  ) => {
    if (runningTask) {
      appendLog("warn", `${t(language, "running")}: ${runningTask}`);
      return;
    }
    const controller = new AbortController();
    cancelRef.current = () => controller.abort();
    setRunningTask(label);
    setPaused(false);
    setTaskProgress({ main: { label, current: 0, total: 0, indeterminate: true } });
    setStatus(`${t(language, "running")}: ${label}`);
    const registerControls = (controls: TaskControls) => {
      pauseRef.current = () => {
        controls.pause();
        setPaused(true);
        setStatus(t(language, "taskPaused"));
      };
      resumeRef.current = () => {
        controls.resume();
        setPaused(false);
        setStatus(`${t(language, "running")}: ${label}`);
      };
    };
    try {
      await task(controller.signal, registerControls);
      setStatus(t(language, "ready"));
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
      cancelRef.current = null;
      pauseRef.current = null;
      resumeRef.current = null;
      setPaused(false);
      setRunningTask(null);
      setTaskProgress(null);
    }
  };

  return {
    runningTask,
    paused,
    taskProgress,
    setTaskProgress,
    status,
    setStatus,
    runTask,
    cancelCurrentTask: () => cancelRef.current?.(),
    pauseCurrentTask: () => pauseRef.current?.(),
    resumeCurrentTask: () => resumeRef.current?.()
  };
}
