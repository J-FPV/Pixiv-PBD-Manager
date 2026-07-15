import { useState } from "react";
import { CheckCircle2, CheckSquare2, Inbox, Sparkles, Square, Star } from "lucide-react";
import { runGuiApi } from "../../api";
import { t } from "../../i18n";
import type { ImageThumbnailPayload, Language, LibraryImage, LibraryMarker } from "../../types";
import { thumbUrl } from "../../utils/thumbUrl";

type LoadStage = "native" | "fallback" | "failed";

// One grid cell. The thumbnail is loaded by the WebView via the native `thumb://`
// scheme (decoded + disk-cached in Rust). A handful of files the Rust decoder
// can't read (e.g. CMYK JPEGs) fall back to the PIL-based IPC thumbnail, which
// handles more formats; only those few pay the per-image process cost.
export function LibraryTile({
  language,
  image,
  selected,
  checked,
  onOpen,
  onToggleSelected
}: {
  language: Language;
  image: LibraryImage;
  selected: boolean;
  checked: boolean;
  onOpen: (path: string) => void;
  onToggleSelected: (path: string) => void;
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

  const markerIcons: Record<LibraryMarker, typeof Sparkles> = {
    high_value: Sparkles,
    used: CheckCircle2,
    to_sort: Inbox
  };
  const markerLabels: Record<LibraryMarker, "markerHighValue" | "markerUsed" | "markerToSort"> = {
    high_value: "markerHighValue",
    used: "markerUsed",
    to_sort: "markerToSort"
  };

  return (
    <div className={`libraryTile${selected ? " selected" : ""}${checked ? " checked" : ""}`}>
      <button type="button" className="libraryTileOpen" title={image.filename} onClick={() => onOpen(image.path)}>
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
      <button
        type="button"
        className="libraryTileSelect"
        aria-pressed={checked}
        title={t(language, checked ? "deselectImage" : "selectImage")}
        onClick={() => onToggleSelected(image.path)}
      >
        {checked ? <CheckSquare2 size={18} /> : <Square size={18} />}
      </button>
      {image.favorite || image.rating || image.markers.length ? (
        <span className="libraryTileBadges">
          {image.favorite ? <span className="favoriteBadge" title={t(language, "favoriteImages")}><Star size={14} fill="currentColor" /></span> : null}
          {image.rating ? <span className="ratingBadge" title={t(language, "rating")}>★ {image.rating}</span> : null}
          {image.markers.map((marker) => {
            const Icon = markerIcons[marker];
            return <span key={marker} title={t(language, markerLabels[marker])}><Icon size={14} /></span>;
          })}
        </span>
      ) : null}
    </div>
  );
}
