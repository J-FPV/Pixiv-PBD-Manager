import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { loadJson, persistJson } from "../utils/storage";

export type ColumnDef<K extends string> = {
  key: K;
  width?: number;
  flex?: boolean;
  resizable?: boolean;
};

export type ColumnHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
};

const MIN_WIDTH_DEFAULT = 60;

function isResizable<K extends string>(col: ColumnDef<K>) {
  return !col.flex && col.resizable !== false;
}

export function useColumnWidths<K extends string>(
  storageKey: string,
  columns: ColumnDef<K>[],
  options?: { min?: number },
) {
  const min = options?.min ?? MIN_WIDTH_DEFAULT;

  const defaults = useMemo(() => {
    const map: Partial<Record<K, number>> = {};
    for (const col of columns) {
      if (!col.flex && col.width !== undefined) {
        map[col.key] = col.width;
      }
    }
    return map as Record<K, number>;
  }, [columns]);

  const [widths, setWidths] = useState<Record<K, number>>(() => {
    const saved = loadJson<Partial<Record<K, number>>>(storageKey, {});
    return { ...defaults, ...saved } as Record<K, number>;
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    persistJson(storageKey, widths);
  }, [storageKey, widths]);

  // widthsRef lets makeHandle read the latest widths without depending on them,
  // so the handle props don't churn on every mousemove during a drag.
  const widthsRef = useRef(widths);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const makeHandle = useCallback(
    (key: K, side: "left" | "right"): ColumnHandleProps => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return; // primary button only
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startWidth = widthsRef.current[key] ?? defaults[key] ?? min;
        const sign = side === "right" ? 1 : -1;

        let rafId: number | null = null;
        let latestX = startX;
        const flush = () => {
          rafId = null;
          const delta = (latestX - startX) * sign;
          const next = Math.max(min, startWidth + delta);
          setWidths((current) => (current[key] === next ? current : { ...current, [key]: next }));
        };
        const onMove = (moveEvent: PointerEvent) => {
          latestX = moveEvent.clientX;
          if (rafId === null) rafId = requestAnimationFrame(flush);
        };
        const cleanup = (releaseEvent: PointerEvent) => {
          if (rafId !== null) cancelAnimationFrame(rafId);
          target.removeEventListener("pointermove", onMove);
          target.removeEventListener("pointerup", cleanup);
          target.removeEventListener("pointercancel", cleanup);
          if (target.hasPointerCapture(releaseEvent.pointerId)) {
            target.releasePointerCapture(releaseEvent.pointerId);
          }
          setResizing(false);
        };

        setResizing(true);
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", cleanup);
        target.addEventListener("pointercancel", cleanup);
      },
      onDoubleClick: () => {
        setWidths((current) => ({ ...current, [key]: defaults[key] }));
      },
    }),
    [defaults, min],
  );

  // CSS grid anchors columns differently depending on which side of the flex
  // column they're on. Columns to the LEFT of flex have a fixed left edge; the
  // flex absorbs growth on the right, so their right handle visually tracks
  // the mouse. Columns to the RIGHT of flex have a fixed right edge (anchored
  // to the container); growing them only moves their LEFT edge, so the right
  // handle on those columns wouldn't move at all. We therefore put handles on
  // the side that faces the flex column.
  const flexIndex = useMemo(() => columns.findIndex((c) => c.flex), [columns]);

  const rightHandle = useCallback(
    (key: K): ColumnHandleProps | null => {
      const idx = columns.findIndex((entry) => entry.key === key);
      if (idx === -1) return null;
      if (!isResizable(columns[idx])) return null;
      if (flexIndex === -1) {
        if (idx >= columns.length - 1) return null;
      } else if (idx >= flexIndex) {
        return null; // columns at or after flex use left handles
      }
      return makeHandle(key, "right");
    },
    [columns, flexIndex, makeHandle],
  );

  const leftHandle = useCallback(
    (key: K): ColumnHandleProps | null => {
      const idx = columns.findIndex((entry) => entry.key === key);
      if (idx === -1) return null;
      if (!isResizable(columns[idx])) return null;
      if (flexIndex === -1) return null; // no flex, no elasticity for left-side resize
      if (idx <= flexIndex) return null; // columns at or before flex use right handles
      return makeHandle(key, "left");
    },
    [columns, flexIndex, makeHandle],
  );

  const gridTemplate = useMemo(
    () => columns.map((col) => (col.flex ? "minmax(0, 1fr)" : `${widths[col.key]}px`)).join(" "),
    [columns, widths],
  );

  // Rendered while the user is dragging a handle. Sits above the entire app
  // and shows a global col-resize cursor without forcing style recalc on every
  // descendant (which WebView2 chokes on under sustained pointer churn).
  const overlay: ReactNode = resizing ? createElement("div", { className: "colResizeOverlay" }) : null;

  return { gridTemplate, leftHandle, rightHandle, overlay };
}
