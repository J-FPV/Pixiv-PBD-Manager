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

  const dragRef = useRef<{ key: K; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback(
    (key: K) => (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        key,
        startX: event.clientX,
        startWidth: widths[key] ?? defaults[key] ?? min,
      };
      const onMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = moveEvent.clientX - dragRef.current.startX;
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
    [widths, defaults, min],
  );

  const reset = useCallback(
    (key: K) => () => {
      setWidths((current) => ({ ...current, [key]: defaults[key] }));
    },
    [defaults],
  );

  const gridTemplate = useMemo(
    () => columns.map((col) => (col.flex ? "minmax(0, 1fr)" : `${widths[col.key]}px`)).join(" "),
    [columns, widths],
  );

  const handleProps = useCallback(
    (key: K): ColumnHandleProps | null => {
      const col = columns.find((entry) => entry.key === key);
      if (!col || col.flex || col.resizable === false) return null;
      return { onMouseDown: startResize(key), onDoubleClick: reset(key) };
    },
    [columns, startResize, reset],
  );

  return { gridTemplate, handleProps };
}
