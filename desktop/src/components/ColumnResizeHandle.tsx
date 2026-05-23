import type { MouseEvent as ReactMouseEvent } from "react";
import type { ColumnHandleProps } from "../hooks/useColumnWidths";

export function ColumnResizeHandle({ handle }: { handle: ColumnHandleProps | null }) {
  if (!handle) return null;
  const stopClick = (event: ReactMouseEvent) => event.stopPropagation();
  return (
    <span
      className="colHandle"
      onMouseDown={handle.onMouseDown}
      onDoubleClick={handle.onDoubleClick}
      onClick={stopClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
    />
  );
}
