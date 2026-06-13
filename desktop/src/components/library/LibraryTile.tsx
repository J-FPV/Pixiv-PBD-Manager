import { useEffect, useState } from "react";
import { runGuiApi } from "../../api";
import type { ImageThumbnailPayload, LibraryImage } from "../../types";
import { thumbnailCache } from "../thumbnailCache";

// One grid cell: a lazily-loaded thumbnail (cached across the session) plus the
// filename. Mirrors SimilarThumbnail's load/cancel pattern.
export function LibraryTile({
  image,
  selected,
  onOpen
}: {
  image: LibraryImage;
  selected: boolean;
  onOpen: (path: string) => void;
}) {
  const [thumbnail, setThumbnail] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(image.path) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = thumbnailCache.get(image.path);
    if (cached) {
      setThumbnail(cached);
      setFailed(false);
      return () => {
        cancelled = true;
      };
    }
    setThumbnail(null);
    setFailed(false);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path: image.path, max_size: 220 })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        thumbnailCache.set(image.path, payload);
        setThumbnail(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [image.path]);

  return (
    <button
      type="button"
      className={`libraryTile${selected ? " selected" : ""}`}
      title={image.filename}
      onClick={() => onOpen(image.path)}
    >
      <span className="libraryTileImage">
        {thumbnail ? (
          <img src={thumbnail.data_url} alt={image.filename} loading="lazy" />
        ) : (
          <span className="thumbnailPlaceholder">{failed ? "!" : "..."}</span>
        )}
      </span>
      <span className="libraryTileLabel">{image.filename}</span>
    </button>
  );
}
