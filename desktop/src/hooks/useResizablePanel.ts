import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from "react";
import { loadJson, persistJson } from "../utils/storage";

interface ResizablePanelOptions {
  storageKey: string;
  containerRef: RefObject<HTMLElement | null>;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  reservedWidth: number;
}

export function useResizablePanel({
  storageKey,
  containerRef,
  defaultWidth,
  minWidth,
  maxWidth,
  reservedWidth
}: ResizablePanelOptions) {
  const [width, setWidth] = useState(() => {
    const saved = loadJson<number>(storageKey, defaultWidth);
    return Number.isFinite(saved) ? Math.min(maxWidth, Math.max(minWidth, saved)) : defaultWidth;
  });
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
    persistJson(storageKey, width);
  }, [storageKey, width]);

  const clampWidth = (value: number) => {
    const available = containerRef.current?.clientWidth;
    const responsiveMax = available ? Math.max(minWidth, available - reservedWidth) : maxWidth;
    return Math.round(Math.min(maxWidth, responsiveMax, Math.max(minWidth, value)));
  };

  const reset = () => setWidth(clampWidth(defaultWidth));

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = widthRef.current;
    let latestX = startX;
    let rafId: number | null = null;

    target.setPointerCapture(pointerId);
    setResizing(true);

    const flush = () => {
      rafId = null;
      setWidth(clampWidth(startWidth + latestX - startX));
    };
    const onMove = (moveEvent: PointerEvent) => {
      latestX = moveEvent.clientX;
      if (rafId === null) {
        rafId = requestAnimationFrame(flush);
      }
    };
    const cleanup = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        flush();
      }
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", cleanup);
      target.removeEventListener("pointercancel", cleanup);
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      setResizing(false);
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", cleanup);
    target.addEventListener("pointercancel", cleanup);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const step = event.shiftKey ? 40 : 12;
    setWidth((current) => clampWidth(current + direction * step));
  };

  return {
    width,
    resizing,
    handleProps: {
      onPointerDown,
      onDoubleClick: reset,
      onKeyDown
    }
  };
}
