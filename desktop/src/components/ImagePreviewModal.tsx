import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ImageDifferencePayload, ImageThumbnailPayload, Language } from "../types";
import { Button } from "./Button";
import { thumbnailCache } from "./thumbnailCache";

type PreviewMode = "image" | "difference";

export function ImagePreviewModal({
  language,
  path,
  paths = [path],
  onPathChange,
  onClose,
  revealFile
}: {
  language: Language;
  path: string;
  paths?: string[];
  onPathChange?: (path: string) => void;
  onClose: () => void;
  revealFile: (path: string) => void;
}) {
  const [image, setImage] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(path) || null);
  const [difference, setDifference] = useState<ImageDifferencePayload | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<PreviewMode>("image");
  const [comparePath, setComparePath] = useState("");
  const uniquePaths = useMemo(() => Array.from(new Set(paths)), [paths]);
  const currentIndex = Math.max(0, uniquePaths.indexOf(path));
  const compareChoices = useMemo(() => uniquePaths.filter((item) => item !== path), [path, uniquePaths]);
  const canSwitch = uniquePaths.length > 1;

  useEffect(() => {
    if (!compareChoices.length) {
      setComparePath("");
      setMode("image");
      return;
    }
    if (!comparePath || comparePath === path || !compareChoices.includes(comparePath)) {
      setComparePath(compareChoices[0]);
    }
  }, [compareChoices, comparePath, path]);

  useEffect(() => {
    let cancelled = false;
    setError("");
    setImage(thumbnailCache.get(path) || null);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path, max_size: 1200 })
      .then((payload) => {
        if (!cancelled) {
          thumbnailCache.set(path, payload);
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

  useEffect(() => {
    let cancelled = false;
    setDifference(null);
    if (mode !== "difference" || !comparePath || comparePath === path) {
      return () => {
        cancelled = true;
      };
    }
    setError("");
    void runGuiApi<ImageDifferencePayload>("image.difference", {
      base_path: path,
      compare_path: comparePath,
      max_size: 1200
    })
      .then((payload) => {
        if (!cancelled) {
          setDifference(payload);
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
  }, [comparePath, mode, path]);

  const switchBy = (offset: number) => {
    if (!canSwitch || !onPathChange) {
      return;
    }
    const next = (currentIndex + offset + uniquePaths.length) % uniquePaths.length;
    onPathChange(uniquePaths[next]);
  };

  const shownDataUrl = mode === "difference" ? difference?.data_url : image?.data_url;
  const loadingText = mode === "difference" ? t(language, "loadingDifference") : t(language, "loadingPreview");

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal imagePreviewModal" onClick={(event) => event.stopPropagation()}>
        <div className="previewTitleRow">
          <h3>{t(language, "preview")}</h3>
          {canSwitch ? (
            <div className="previewStepper">
              <Button icon={<ChevronLeft size={16} />} onClick={() => switchBy(-1)}>{t(language, "previousImage")}</Button>
              <span>{currentIndex + 1} / {uniquePaths.length}</span>
              <Button icon={<ChevronRight size={16} />} onClick={() => switchBy(1)}>{t(language, "nextImage")}</Button>
            </div>
          ) : null}
        </div>
        {canSwitch ? (
          <div className="previewControls">
            <div className="segmented">
              <button className={mode === "image" ? "active" : ""} onClick={() => setMode("image")}>
                {t(language, "normalPreview")}
              </button>
              <button className={mode === "difference" ? "active" : ""} onClick={() => setMode("difference")}>
                {t(language, "differencePreview")}
              </button>
            </div>
            <label className="previewCompare">
              <span>{t(language, "compareWith")}</span>
              <select value={comparePath} onChange={(event) => setComparePath(event.target.value)}>
                {compareChoices.map((item, index) => (
                  <option key={item} value={item}>
                    {index + 1}. {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="imagePreviewBody">
          {shownDataUrl ? <img src={shownDataUrl} alt={path} /> : <span>{loadingText}</span>}
          {error ? <span className="previewError">{error}</span> : null}
        </div>
        <div className="previewFooter">
          <div className="previewPathList">
            <div className="imagePreviewPath" title={path}>{path}</div>
            {mode === "difference" && comparePath ? (
              <div className="imagePreviewPath" title={comparePath}>
                {t(language, "differenceHint")}: {comparePath}
              </div>
            ) : null}
          </div>
          <div className="modalActions previewActions">
            <Button onClick={() => revealFile(path)}>{t(language, "openFolder")}</Button>
            <Button variant="primary" onClick={onClose}>{t(language, "close")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
