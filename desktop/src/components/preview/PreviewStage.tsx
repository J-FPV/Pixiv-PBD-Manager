import type { PointerEventHandler, RefObject } from "react";
import { t } from "../../i18n";
import type { Language, SimilarEntry } from "../../types";
import type { ImagePreviewState, PreviewMode } from "../../hooks/useImagePreview";
import type { ZoomTransform } from "../../hooks/useZoomPan";
import { SideBySideView } from "./SideBySideView";
import { SliderCompareView } from "./SliderCompareView";
import { ZoomLayer } from "./ZoomLayer";

export interface PreviewStageProps {
  language: Language;
  mode: PreviewMode;
  transform: ZoomTransform;
  containerRef: RefObject<HTMLDivElement | null>;
  panHandlers: {
    onPointerDown: PointerEventHandler<HTMLElement>;
    onPointerMove: PointerEventHandler<HTMLElement>;
    onPointerUp: PointerEventHandler<HTMLElement>;
    onPointerCancel: PointerEventHandler<HTMLElement>;
  };
  preview: ImagePreviewState;
  path: string;
  baseEntry?: SimilarEntry;
  compareEntry?: SimilarEntry;
  recommendedKeepPath: string | null;
}

// The zoom/pan surface. Owns the single interactive container (wheel + drag),
// then renders the layer(s) for the active mode inside it.
export function PreviewStage(props: PreviewStageProps) {
  const { language, mode, transform, containerRef, panHandlers, preview, path } = props;
  const baseUrl = preview.image?.data_url;
  const compareUrl = preview.compareImage?.data_url;
  const diffUrl = preview.difference?.data_url;
  const isZoomed = transform.scale > 1;
  const loadingText = mode === "difference" ? t(language, "loadingDifference") : t(language, "loadingPreview");
  const singleUrl = mode === "difference" ? diffUrl : baseUrl;

  return (
    <div
      className={`previewStage${isZoomed ? " zoomed" : ""}`}
      ref={containerRef}
      onPointerDown={panHandlers.onPointerDown}
      onPointerMove={panHandlers.onPointerMove}
      onPointerUp={panHandlers.onPointerUp}
      onPointerCancel={panHandlers.onPointerCancel}
    >
      {mode === "side" ? (
        <SideBySideView
          language={language}
          transform={transform}
          baseUrl={baseUrl}
          compareUrl={compareUrl}
          baseEntry={props.baseEntry}
          compareEntry={props.compareEntry}
          recommendedKeepPath={props.recommendedKeepPath}
        />
      ) : mode === "slider" ? (
        <SliderCompareView language={language} transform={transform} baseUrl={baseUrl} compareUrl={compareUrl} />
      ) : singleUrl ? (
        <ZoomLayer dataUrl={singleUrl} alt={path} transform={transform} />
      ) : (
        <span className="previewPlaceholder">{loadingText}</span>
      )}
      {preview.error ? <span className="previewError">{preview.error}</span> : null}
    </div>
  );
}
