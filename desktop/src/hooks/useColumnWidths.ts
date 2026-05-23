import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { loadJson, persistJson } from "../utils/storage";

export type ColumnDef<K extends string> = {
  key: K;
  width?: number;
  flex?: boolean;
  resizable?: boolean;
};

export type ColumnHandleProps = {
  onMouseDown: (event: ReactMouseEvent) => void;
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

  useEffect(() => {
    persistJson(storageKey, widths);
  }, [storageKey, widths]);

  const dragRef = useRef<{ key: K; startX: number; startWidth: number; sign: number } | null>(null);

  const makeHandle = useCallback(
    (key: K, side: "left" | "right"): ColumnHandleProps => ({
      onMouseDown: (event: ReactMouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = {
          key,
          startX: event.clientX,
          startWidth: widths[key] ?? defaults[key] ?? min,
          sign: side === "right" ? 1 : -1,
        };
        const onMove = (moveEvent: MouseEvent) => {
          if (!dragRef.current) return;
          const delta = (moveEvent.clientX - dragRef.current.startX) * dragRef.current.sign;
          const next = Math.max(min, dragRef.current.startWidth + delta);
          setWidths((current) => ({ ...current, [dragRef.current!.key]: next }));
        };
        const onUp = () => {
          dragRef.current = null;
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.body.classList.remove("col-resizing");
        };
        document.body.classList.add("col-resizing");
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      },
      onDoubleClick: () => {
        setWidths((current) => ({ ...current, [key]: defaults[key] }));
      },
    }),
    [widths, defaults, min],
  );

  const rightHandle = useCallback(
    (key: K): ColumnHandleProps | null => {
      const idx = columns.findIndex((entry) => entry.key === key);
      if (idx === -1 || idx >= columns.length - 1) return null; // last column has no right handle
      if (!isResizable(columns[idx])) return null;
      return makeHandle(key, "right");
    },
    [columns, makeHandle],
  );

  const leftHandle = useCallback(
    (key: K): ColumnHandleProps | null => {
      const idx = columns.findIndex((entry) => entry.key === key);
      if (idx <= 0) return null; // first column has no left handle
      if (!isResizable(columns[idx])) return null;
      // Only show a left handle when the previous column is FLEX — that's the
      // only case where the boundary can actually move (the flex column absorbs
      // the delta). A fixed non-resizable neighbor on the left would just shift
      // this column's far edge, which looks like the wrong edge is moving.
      if (!columns[idx - 1].flex) return null;
      return makeHandle(key, "left");
    },
    [columns, makeHandle],
  );

  const gridTemplate = useMemo(
    () => columns.map((col) => (col.flex ? "minmax(0, 1fr)" : `${widths[col.key]}px`)).join(" "),
    [columns, widths],
  );

  return { gridTemplate, leftHandle, rightHandle };
}
