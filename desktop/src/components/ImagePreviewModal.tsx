import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ImageThumbnailPayload, Language } from "../types";
import { Button } from "./Button";
import { thumbnailCache } from "./thumbnailCache";

export function ImagePreviewModal({
  language,
  path,
  onClose,
  revealFile
}: {
  language: Language;
  path: string;
  onClose: () => void;
  revealFile: (path: string) => void;
}) {
  const [image, setImage] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(path) || null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path, max_size: 1200 })
      .then((payload) => {
        if (!cancelled) {
          setImage(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal imagePreviewModal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, "preview")}</h3>
        <div className="imagePreviewBody">
          {image ? <img src={image.data_url} alt={path} /> : <span>{t(language, "loadingPreview")}</span>}
          {error ? <span className="previewError">{error}</span> : null}
        </div>
        <div className="imagePreviewPath" title={path}>{path}</div>
        <div className="modalActions">
          <Button onClick={() => revealFile(path)}>{t(language, "openFolder")}</Button>
          <Button variant="primary" onClick={onClose}>{t(language, "close")}</Button>
        </div>
      </div>
    </div>
  );
}
