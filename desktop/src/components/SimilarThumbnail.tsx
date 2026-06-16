import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ImageThumbnailPayload, Language } from "../types";
import { thumbnailCache, thumbnailCacheKey } from "./thumbnailCache";

export function SimilarThumbnail({
  language,
  path,
  onPreview
}: {
  language: Language;
  path: string;
  onPreview: (path: string) => void;
}) {
  const cacheKey = thumbnailCacheKey(path, "similar-144");
  const [thumbnail, setThumbnail] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(cacheKey) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = thumbnailCache.get(cacheKey);
    if (cached) {
      setThumbnail(cached);
      setFailed(false);
      return () => {
        cancelled = true;
      };
    }
    setThumbnail(null);
    setFailed(false);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path, max_size: 144 })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        thumbnailCache.set(cacheKey, payload);
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
  }, [cacheKey, path]);

  return (
    <button
      type="button"
      className="thumbnailButton"
      title={t(language, "openPreview")}
      onClick={(event) => {
        event.stopPropagation();
        onPreview(path);
      }}
    >
      {thumbnail ? (
        <img src={thumbnail.data_url} alt={t(language, "preview")} loading="lazy" />
      ) : (
        <span className="thumbnailPlaceholder">{failed ? "!" : "..."}</span>
      )}
    </button>
  );
}
