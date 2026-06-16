import type { CSSProperties } from "react";
import type { ZoomTransform } from "../../hooks/useZoomPan";

// Presentational image whose CSS transform is fully controlled by the parent.
// Several layers can share one transform so they zoom/pan in sync.
export function ZoomLayer({
  dataUrl,
  alt,
  transform,
  fitSize
}: {
  dataUrl: string;
  alt: string;
  transform: ZoomTransform;
  fitSize?: { width: number; height: number };
}) {
  const style: CSSProperties = {
    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
    ...(fitSize
      ? {
          width: `${fitSize.width}px`,
          height: `${fitSize.height}px`,
          maxWidth: "none",
          maxHeight: "none"
        }
      : {})
  };
  return <img className="zoomLayer" src={dataUrl} alt={alt} style={style} draggable={false} />;
}
