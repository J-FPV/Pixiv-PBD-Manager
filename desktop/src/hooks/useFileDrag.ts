import { useRef } from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";

export function useFileDrag(onDrag: () => void, onOpen: () => void) {
  const origin = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const clear = () => { origin.current = null; };

  return {
    draggable: false,
    onDragStart: (event: DragEvent<HTMLButtonElement>) => event.preventDefault(),
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      suppressClick.current = false;
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      origin.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const start = origin.current;
      if (!start || start.id !== event.pointerId) return;
      if (!(event.buttons & 1)) { clear(); return; }
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      clear();
      suppressClick.current = true;
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onDrag();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onLostPointerCapture: clear,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        return;
      }
      onOpen();
    }
  };
}
