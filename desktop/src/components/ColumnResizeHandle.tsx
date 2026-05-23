import type { MouseEvent as ReactMouseEvent } from "react";
import type { ColumnHandleProps } from "../hooks/useColumnWidths";

export function ColumnResizeHandle({
  handle,
  side = "right",
}: {
  handle: ColumnHandleProps | null;
  side?: "left" | "right";
}) {
  if (!handle) return null;
  const stopClick = (event: ReactMouseEvent) => event.stopPropagation();
  return (
    <span
      className={`colHandle colHandle-${side}`}
      onPointerDown={handle.onPointerDown}
      onDoubleClick={handle.onDoubleClick}
      onClick={stopClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
    />
  );
}
