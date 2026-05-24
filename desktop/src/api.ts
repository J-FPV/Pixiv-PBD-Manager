import { open, save } from "@tauri-apps/plugin-dialog";
import { Child, Command } from "@tauri-apps/plugin-shell";
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

export class GuiApiCancelledError extends Error {
  constructor(commandName: string) {
    super(`${commandName} cancelled`);
    this.name = "GuiApiCancelledError";
  }
}

export interface TaskControls {
  pause: () => void;
  resume: () => void;
}

export async function runGuiApi<T>(
  commandName: string,
  payload: object = {},
  onEvent?: (event: ApiEvent<T>) => void,
  options: { signal?: AbortSignal; onStart?: (controls: TaskControls) => void } = {}
): Promise<T> {
  if (options.signal?.aborted) {
    throw new GuiApiCancelledError(commandName);
  }
  const projectRoot = getProjectRoot();
  const payloadJson = JSON.stringify({ ...payload, project_root: projectRoot });
  // Windows CreateProcess caps the command line at 32K chars. A large
  // scan.apply payload (hundreds of proposed changes, each carrying paths)
  // blows past that and we get "os error 206" ("filename or extension too
  // long"). For large payloads, pass "-" as the payload-argv and pipe the
  // JSON into the child's stdin; the same stream then carries pause/resume
  // control messages, so the gui_api stdin reader must use readline() rather
  // than read().
  const PAYLOAD_STDIN_THRESHOLD = 8 * 1024;
  const payloadArg = payloadJson.length > PAYLOAD_STDIN_THRESHOLD ? "-" : payloadJson;
  // In development (Vite dev server + tauri:dev) we spawn the source Python
  // backend directly so code edits don't require rebuilding the PyInstaller
  // exe. In production (tauri:build) the backend ships as a PyInstaller
  // `--onedir` bundle; Tauri 2's NSIS bundler places the `bundle.resources`
  // folder at the install ROOT (not under a `resources/` subdir, despite the
  // config name), so the launcher + `_internal/` land at
  // `<install_dir>/pixiv-pbd-api/`. The capability allow-list uses that
  // install-relative path; Tauri spawns it with cwd = install dir.
  const command = import.meta.env.DEV
    ? Command.create(
        getPythonCommand(),
        ["-m", "pixiv_pbd_manager.gui_api", commandName, payloadArg],
        { cwd: projectRoot, env: { PYTHONPATH: projectRoot } }
      )
    : Command.create("pixiv-pbd-api", [commandName, payloadArg]);

  let stdoutBuffer = "";
  let stderrText = "";
  let result: T | undefined;
  let apiError: string | undefined;
  let child: Child | null = null;
  let cancelled = false;
  const abortHandler = () => {
    cancelled = true;
    if (child) {
      void child.kill();
    }
  };
  options.signal?.addEventListener("abort", abortHandler);

  const handleLine = (line: string) => {
    if (!line.trim()) {
      return;
    }
    const event = JSON.parse(line) as ApiEvent<T>;
    onEvent?.(event);
    if (event.type === "result") {
      result = event.payload;
    } else if (event.type === "error") {
      apiError = event.message;
    }
  };

  command.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line);
    }
  });

  try {
    command.stderr.on("data", (chunk) => {
      stderrText += String(chunk);
    });

    const closePromise = new Promise<{ code: number | null; signal: number | null }>((resolve, reject) => {
      command.on("close", resolve);
      command.on("error", reject);
    });
    child = await command.spawn();
    if (cancelled) {
      await child.kill();
    }
    const activeChild = child;
    // Feed the payload via stdin when argv mode would overflow CreateProcess's
    // 32K limit. Newline-terminated so the Python side's readline() returns
    // exactly the payload; subsequent control-message writes use the same
    // stream. Awaited (not fire-and-forget) so a write failure surfaces as
    // an api error instead of Python silently reading an empty stdin.
    if (payloadArg === "-") {
      try {
        await activeChild.write(payloadJson + "\n");
      } catch (writeError) {
        throw new Error(
          `Failed to send payload via stdin: ${writeError instanceof Error ? writeError.message : String(writeError)}`
        );
      }
    }
    options.onStart?.({
      pause: () => {
        void activeChild.write('{"control":"pause"}\n');
      },
      resume: () => {
        void activeChild.write('{"control":"resume"}\n');
      }
    });
    const closeData = await closePromise;

    if (cancelled) {
      throw new GuiApiCancelledError(commandName);
    }

    if (stdoutBuffer.trim()) {
      handleLine(stdoutBuffer);
    }

    if (closeData.code !== 0 || apiError) {
      throw new Error(apiError || stderrText || `${commandName} exited with code ${closeData.code}`);
    }
    if (result === undefined) {
      throw new Error(`${commandName} did not return a result event`);
    }
    return result;
  } finally {
    options.signal?.removeEventListener("abort", abortHandler);
  }
}
