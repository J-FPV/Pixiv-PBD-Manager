import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WINDOW_STATE_KEY } from "../constants";
import { finiteNumber } from "./format";
import { persistJson } from "./storage";

export const DEFAULT_WINDOW_WIDTH = 1180;
export const DEFAULT_WINDOW_HEIGHT = 800;

export interface SavedWindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximized?: boolean;
}

export function savedWindowSize(state: SavedWindowState | null): { width: number; height: number } {
  return {
    width: finiteNumber(state?.width) && state.width >= 980 ? state.width : DEFAULT_WINDOW_WIDTH,
    height: finiteNumber(state?.height) && state.height >= 660 ? state.height : DEFAULT_WINDOW_HEIGHT
  };
}

export function windowIntersectsWorkArea(
  state: SavedWindowState,
  monitor: { workArea: { position: PhysicalPosition; size: PhysicalSize } }
): boolean {
  if (!finiteNumber(state.x) || !finiteNumber(state.y)) {
    return false;
  }
  const { width, height } = savedWindowSize(state);
  const area = monitor.workArea;
  const overlapWidth =
    Math.min(state.x + width, area.position.x + area.size.width) - Math.max(state.x, area.position.x);
  const overlapHeight =
    Math.min(state.y + height, area.position.y + area.size.height) - Math.max(state.y, area.position.y);
  return overlapWidth >= Math.min(180, width) && overlapHeight >= Math.min(120, height);
}

export function centeredPositionForMonitor(
  state: SavedWindowState | null,
  monitor: { workArea: { position: PhysicalPosition; size: PhysicalSize } } | undefined
): PhysicalPosition | null {
  if (!monitor) {
    return null;
  }
  const { width, height } = savedWindowSize(state);
  const area = monitor.workArea;
  const x = area.position.x + Math.max(0, Math.round((area.size.width - width) / 2));
  const y = area.position.y + Math.max(0, Math.round((area.size.height - height) / 2));
  return new PhysicalPosition(x, y);
}

export async function resetCurrentWindowLayout(): Promise<void> {
  const appWindow = getCurrentWindow();
  const defaultState: SavedWindowState = {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    maximized: false
  };

  persistJson(WINDOW_STATE_KEY, null);
  await appWindow.unmaximize();
  await appWindow.setSize(new PhysicalSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));

  const monitors = await availableMonitors();
  const centered = centeredPositionForMonitor(defaultState, monitors[0]);
  if (centered) {
    await appWindow.setPosition(centered);
    defaultState.x = centered.x;
    defaultState.y = centered.y;
  }
  persistJson(WINDOW_STATE_KEY, defaultState);
}
