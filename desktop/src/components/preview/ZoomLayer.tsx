import type { CSSProperties } from "react";
import type { ZoomTransform } from "../../hooks/useZoomPan";

// Presentational image whose CSS transform is fully controlled by the parent.
// Several layers can share one transform so they zoom/pan in sync.
export function ZoomLayer({
  dataUrl,
  alt,
  transform
}: {
  dataUrl: string;
  alt: string;
  transform: ZoomTransform;
}) {
  const style: CSSProperties = {
    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
  };
  return <img className="zoomLayer" src={dataUrl} alt={alt} style={style} draggable={false} />;
}
