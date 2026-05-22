import { open, save } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";
import type { ApiEvent } from "./types";

export type PathPickKind = "folder" | "file" | "save";

export async function browsePath(kind: PathPickKind): Promise<string | null> {
  if (kind === "save") {
    const result = await save({});
    return result ?? null;
  }
  const result = await open({ directory: kind === "folder", multiple: false });
  return typeof result === "string" ? result : null;
}

const PROJECT_ROOT_KEY = "pixiv-pbd-manager.projectRoot";
const PYTHON_COMMAND_KEY = "pixiv-pbd-manager.pythonCommand";

export function getProjectRoot(): string {
  return localStorage.getItem(PROJECT_ROOT_KEY) || "..";
}

export function setProjectRoot(value: string): void {
  localStorage.setItem(PROJECT_ROOT_KEY, value || "..");
}

export function getPythonCommand(): string {
  return localStorage.getItem(PYTHON_COMMAND_KEY) === "py" ? "py" : "python";
}

export function setPythonCommand(value: string): void {
  localStorage.setItem(PYTHON_COMMAND_KEY, value === "py" ? "py" : "python");
}

export async function runGuiApi<T>(
  commandName: string,
  payload: object = {},
  onEvent?: (event: ApiEvent<T>) => void
): Promise<T> {
  const projectRoot = getProjectRoot();
  const pythonCommand = getPythonCommand();
  const args = [
    "-m",
    "pixiv_pbd_manager.gui_api",
    commandName,
    JSON.stringify({ ...payload, project_root: projectRoot })
  ];
  const command = Command.create(pythonCommand, args, {
    cwd: projectRoot,
    env: { PYTHONPATH: projectRoot }
  });

  let stdoutBuffer = "";
  let stderrText = "";
  let result: T | undefined;
  let apiError: string | undefined;

  command.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line) as ApiEvent<T>;
      onEvent?.(event);
      if (event.type === "result") {
        result = event.payload;
      } else if (event.type === "error") {
        apiError = event.message;
      }
    }
  });

  command.stderr.on("data", (chunk) => {
    stderrText += String(chunk);
  });

  const closePromise = new Promise<{ code: number | null; signal: number | null }>((resolve, reject) => {
    command.on("close", resolve);
    command.on("error", reject);
  });
  await command.spawn();
  const closeData = await closePromise;

  if (stdoutBuffer.trim()) {
    const event = JSON.parse(stdoutBuffer) as ApiEvent<T>;
    onEvent?.(event);
    if (event.type === "result") {
      result = event.payload;
    } else if (event.type === "error") {
      apiError = event.message;
    }
  }

  if (closeData.code !== 0 || apiError) {
    throw new Error(apiError || stderrText || `${commandName} exited with code ${closeData.code}`);
  }
  if (result === undefined) {
    throw new Error(`${commandName} did not return a result event`);
  }
  return result;
}
