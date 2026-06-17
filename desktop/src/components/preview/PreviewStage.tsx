import { useEffect, useMemo, useState } from "react";
import type { PointerEventHandler, RefObject } from "react";
import { t } from "../../i18n";
import type { Language, SimilarEntry } from "../../types";
import type { ImagePreviewState, PreviewMode } from "../../hooks/useImagePreview";
import type { ZoomTransform } from "../../hooks/useZoomPan";
import { containSize } from "../../utils/imageFit";
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
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const baseUrl = preview.image?.data_url;
  const compareUrl = preview.compareImage?.data_url;
  const diffUrl = preview.difference?.data_url;
  const isZoomed = transform.scale > 1;
  const loadingText = mode === "difference" ? t(language, "loadingDifference") : t(language, "loadingPreview");
  const singleUrl = mode === "difference" ? diffUrl : baseUrl;
  const singleImageSize = mode === "difference" ? preview.difference : preview.image;
  const singleFitSize = useMemo(
    () => containSize(stageSize, { width: singleImageSize?.width || 0, height: singleImageSize?.height || 0 }),
    [singleImageSize?.height, singleImageSize?.width, stageSize]
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const update = () => {
      const rect = node.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

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
        <ZoomLayer dataUrl={singleUrl} alt={path} transform={transform} fitSize={singleFitSize} />
      ) : (
        <span className="previewPlaceholder">{loadingText}</span>
      )}
      {preview.error ? <span className="previewError">{preview.error}</span> : null}
    </div>
  );
}
