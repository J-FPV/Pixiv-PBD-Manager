import { useRef } from "react";
import type { ReactNode } from "react";

export function ModalOverlay({
  children,
  onClose
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const pointerStartedOnOverlay = useRef(false);

  return (
    <div
      className="modalOverlay"
      onPointerDown={(event) => {
        pointerStartedOnOverlay.current = event.target === event.currentTarget;
      }}
      onPointerCancel={() => {
        pointerStartedOnOverlay.current = false;
      }}
      onPointerUp={(event) => {
        if (pointerStartedOnOverlay.current && event.target === event.currentTarget) {
          onClose();
        }
        pointerStartedOnOverlay.current = false;
      }}
    >
      {children}
    </div>
  );
}
