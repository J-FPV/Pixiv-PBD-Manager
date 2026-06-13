import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const STEP = 1.2;
const IDENTITY: ZoomTransform = { scale: 1, x: 0, y: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Shared zoom/pan transform for the preview stage. The wheel listener is
// attached natively (passive: false) so it can preventDefault, and dragging
// pans. A single instance can drive several images at once — side-by-side and
// before/after slider modes apply the same transform to each layer to keep
// them in lockstep. `resetKey` snaps back to 1x whenever the shown image
// identity changes (path/mode/compare switch).
export function useZoomPan(resetKey: string) {
  const [transform, setTransform] = useState<ZoomTransform>(IDENTITY);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ZoomTransform>(IDENTITY);
  const drag = useRef<{ x: number; y: number } | null>(null);
  transformRef.current = transform;

  const reset = useCallback(() => setTransform(IDENTITY), []);

  useEffect(() => {
    setTransform(IDENTITY);
  }, [resetKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      setTransform((prev) => {
        const scale = clamp(prev.scale * (event.deltaY < 0 ? STEP : 1 / STEP), MIN_SCALE, MAX_SCALE);
        if (scale === MIN_SCALE) {
          return IDENTITY;
        }
        const ratio = scale / prev.scale;
        return { scale, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || transformRef.current.scale <= MIN_SCALE) {
      return;
    }
    drag.current = { x: event.clientX - transformRef.current.x, y: event.clientY - transformRef.current.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start) {
      return;
    }
    setTransform((prev) => ({ ...prev, x: event.clientX - start.x, y: event.clientY - start.y }));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  return {
    transform,
    containerRef,
    reset,
    isZoomed: transform.scale > MIN_SCALE,
    panHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag
    }
  };
}
