import { useEffect } from "react";
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WINDOW_STATE_KEY } from "../constants";
import { loadJson, persistJson } from "../utils/storage";
import {
  centeredPositionForMonitor,
  savedWindowSize,
  windowIntersectsWorkArea,
  type SavedWindowState
} from "../utils/window";
import { finiteNumber } from "../utils/format";

// Restore the saved window position/size on mount, then debounce-persist any
// move/resize so a clean shutdown isn't required to remember the geometry. If
// the saved monitor is no longer present we re-center on the primary monitor
// rather than restoring an off-screen position.
export function useWindowStatePersistence(): void {
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const saved = loadJson<SavedWindowState | null>(WINDOW_STATE_KEY, null);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlistenFns: Array<() => void> = [];

    const save = async (force = false) => {
      if (disposed && !force) {
        return;
      }
      try {
        const [position, size, maximized] = await Promise.all([
          appWindow.outerPosition(),
          appWindow.outerSize(),
          appWindow.isMaximized()
        ]);
        persistJson(WINDOW_STATE_KEY, {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          maximized
        });
      } catch (error) {
        console.warn("Failed to save window state", error);
      }
    };

    const restore = async () => {
      if (!saved) {
        return;
      }
      try {
        const size = savedWindowSize(saved);
        const monitors = await availableMonitors();
        const positionIsVisible = monitors.some((monitor) => windowIntersectsWorkArea(saved, monitor));
        await appWindow.setSize(new PhysicalSize(size.width, size.height));
        if (positionIsVisible && finiteNumber(saved.x) && finiteNumber(saved.y)) {
          await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
        } else {
          const centered = centeredPositionForMonitor(saved, monitors[0]);
          if (centered) {
            await appWindow.setPosition(centered);
          }
        }
        if (saved.maximized && positionIsVisible) {
          await appWindow.maximize();
        }
        void save(true);
      } catch (error) {
        console.warn("Failed to restore window state", error);
      }
    };

    const scheduleSave = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void save();
      }, 250);
    };

    void restore();
    void Promise.all([appWindow.onResized(scheduleSave), appWindow.onMoved(scheduleSave)])
      .then((items) => {
        unlistenFns = items;
      })
      .catch((error) => console.warn("Failed to watch window state", error));

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      unlistenFns.forEach((unlisten) => unlisten());
      void save(true);
    };
  }, []);
}
