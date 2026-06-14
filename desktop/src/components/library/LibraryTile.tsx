import { useState } from "react";
import { runGuiApi } from "../../api";
import type { ImageThumbnailPayload, LibraryImage } from "../../types";
import { thumbUrl } from "../../utils/thumbUrl";

type LoadStage = "native" | "fallback" | "failed";

// One grid cell. The thumbnail is loaded by the WebView via the native `thumb://`
// scheme (decoded + disk-cached in Rust). A handful of files the Rust decoder
// can't read (e.g. CMYK JPEGs) fall back to the PIL-based IPC thumbnail, which
// handles more formats; only those few pay the per-image process cost.
export function LibraryTile({
  image,
  selected,
  onOpen
}: {
  image: LibraryImage;
  selected: boolean;
  onOpen: (path: string) => void;
}) {
  const [stage, setStage] = useState<LoadStage>("native");
  const [retry, setRetry] = useState(0);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const onNativeError = () => {
    // The native handler drops the oldest pending request when the decode
    // backlog is full (fast scroll), so a miss is often transient. Retry the
    // native scheme once before paying for the per-image PIL/IPC fallback.
    if (retry === 0) {
      setRetry(1);
      return;
    }
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path: image.path, max_size: 256 })
      .then((payload) => {
        setFallbackUrl(payload.data_url);
        setStage("fallback");
      })
      .catch(() => setStage("failed"));
  };

  const src =
    stage === "fallback" && fallbackUrl
      ? fallbackUrl
      : `${thumbUrl(image.path, image.mtime_ns, 256)}&r=${retry}`;

  return (
    <button
      type="button"
      className={`libraryTile${selected ? " selected" : ""}`}
      title={image.filename}
      onClick={() => onOpen(image.path)}
    >
      <span className="libraryTileImage">
        {stage === "failed" ? (
          <span className="thumbnailPlaceholder">!</span>
        ) : (
          <img
            src={src}
            alt={image.filename}
            loading="lazy"
            decoding="async"
            onError={stage === "native" ? onNativeError : () => setStage("failed")}
          />
        )}
      </span>
      <span className="libraryTileLabel">{image.filename}</span>
    </button>
  );
}
