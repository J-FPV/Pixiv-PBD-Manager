import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { t } from "../../i18n";
import type { Language } from "../../types";
import type { ZoomTransform } from "../../hooks/useZoomPan";
import { ZoomLayer } from "./ZoomLayer";

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// Before/after wipe: the compare image overlays the base, clipped to the left
// of a draggable divider. Both layers share the stage zoom/pan transform; the
// clip is in screen space so the wipe stays vertical at any zoom. The handle
// stops pointer propagation so dragging it never pans the underlying stage.
export function SliderCompareView({
  language,
  transform,
  baseUrl,
  compareUrl
}: {
  language: Language;
  transform: ZoomTransform;
  baseUrl?: string;
  compareUrl?: string;
}) {
  const [percent, setPercent] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = (clientX: number) => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    setPercent(clampPercent(((clientX - rect.left) / rect.width) * 100));
  };

  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      return;
    }
    event.stopPropagation();
    moveTo(event.clientX);
  };
  const onHandleUp = () => {
    dragging.current = false;
  };

  return (
    <div className="previewSlider" ref={ref}>
      {baseUrl ? <ZoomLayer dataUrl={baseUrl} alt="" transform={transform} /> : null}
      {compareUrl ? (
        <div className="previewSliderTop" style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}>
          <ZoomLayer dataUrl={compareUrl} alt="" transform={transform} />
        </div>
      ) : null}
      <span className="previewSliderTag left">{t(language, "compareWith")}</span>
      <span className="previewSliderTag right">{t(language, "normalPreview")}</span>
      <div
        className="previewSliderHandle"
        style={{ left: `${percent}%` }}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      >
        <span className="previewSliderGrip" aria-hidden="true" />
      </div>
    </div>
  );
}
