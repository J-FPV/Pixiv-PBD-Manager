import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  Tags,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { runGuiApi } from "../../api";
import { t } from "../../i18n";
import type { Language, LibraryImage, PixivTag } from "../../types";
import { formatBytes } from "../../utils/format";
import { prefetchImagePreview, useImagePreview } from "../../hooks/useImagePreview";
import type { ImagePreviewOptions } from "../../hooks/useImagePreview";
import { useZoomPan } from "../../hooks/useZoomPan";
import { Button } from "../Button";
import { ModalOverlay } from "../ModalOverlay";
import { ZoomLayer } from "../preview/ZoomLayer";
import { containSize } from "../../utils/imageFit";

export interface LibraryDetailModalProps {
  language: Language;
  image: LibraryImage;
  images: LibraryImage[];
  onPathChange: (path: string) => void;
  onClose: () => void;
  revealFile: (path: string) => void;
  setImageTags: (path: string, tags: string[]) => void | Promise<void>;
  onFetchTags: () => void;
  busy: boolean;
}

// Auto-fetched Pixiv tags, shown Pixiv-style: "#原文" with the English
// translation as muted inline text on the same chip.
function PixivTagChips({ tags }: { tags: PixivTag[] }) {
  if (!tags.length) {
    return null;
  }
  return (
    <div className="pixivTagChips">
      {tags.map((entry) => (
        <span key={entry.tag} className="pixivTagChip">
          #{entry.tag}
          {entry.translation ? <span className="pixivTagTranslation">{entry.translation}</span> : null}
        </span>
      ))}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  if (!value) {
    return null;
  }
  return (
    <div className="libraryMetaRow">
      <span className="libraryMetaKey">{label}</span>
      <span className="libraryMetaValue" title={value}>{value}</span>
    </div>
  );
}

function orientationLabel(language: Language, value: LibraryImage["orientation"]): string {
  if (value === "portrait" || value === "landscape" || value === "square") {
    return t(language, value);
  }
  return t(language, "unknownOrientation");
}

function previewOptions(image: LibraryImage): ImagePreviewOptions {
  const isTallImage = image.width > 0 && image.height / image.width >= 2.2;
  return isTallImage
    ? {
        maxSize: 10000,
        targetWidth: 1000,
        maxPixels: 8_000_000,
        cacheVariant: `library-long-${image.mtime_ns}`
      }
    : { cacheVariant: `library-detail-${image.mtime_ns}` };
}

function LibraryStageNav({
  language,
  onPrevious,
  onNext
}: {
  language: Language;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="libraryStageNavButton previous"
        title={t(language, "previousImage")}
        aria-label={t(language, "previousImage")}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onPrevious();
        }}
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        className="libraryStageNavButton next"
        title={t(language, "nextImage")}
        aria-label={t(language, "nextImage")}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onNext();
        }}
      >
        <ChevronRight size={22} />
      </button>
    </>
  );
}

function LibraryDetailMetaPanel({
  language,
  image,
  busy,
  revealFile,
  setImageTags,
  onFetchTags,
  onClose
}: {
  language: Language;
  image: LibraryImage;
  busy: boolean;
  revealFile: (path: string) => void;
  setImageTags: (path: string, tags: string[]) => void | Promise<void>;
  onFetchTags: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const modified = image.mtime_ns ? new Date(image.mtime_ns / 1_000_000).toLocaleString() : "";
  const addTag = () => {
    const value = draft.trim();
    if (value) {
      void setImageTags(image.path, [...image.tags, value]);
    }
    setDraft("");
  };

  return (
    <div className="libraryDetailMeta">
      <MetaRow label={t(language, "pixivId")} value={image.pid} />
      <MetaRow label={t(language, "artist")} value={image.artist_name || image.artist_id} />
      <MetaRow label={t(language, "dimensions")} value={image.resolution} />
      <MetaRow label={t(language, "orientation")} value={orientationLabel(language, image.orientation)} />
      <MetaRow label={t(language, "format")} value={image.format.toUpperCase()} />
      <MetaRow label={t(language, "fileSize")} value={formatBytes(image.size_bytes)} />
      <MetaRow label={t(language, "modified")} value={modified} />
      <MetaRow label={t(language, "pageLabel")} value={image.page !== null ? String(image.page) : ""} />
      <MetaRow label={t(language, "artistTags")} value={image.artist_tags.join(", ")} />
      <div className="libraryPixivSection">
        <div className="libraryPixivHeader">
          <span className="libraryMetaKey">{t(language, "pixivTags")}</span>
          <Button icon={<Tags size={14} />} iconOnly onClick={onFetchTags} disabled={busy} title={t(language, "fetchPixivTags")}>
            {t(language, "fetchPixivTags")}
          </Button>
        </div>
        <PixivTagChips tags={image.pixiv_tags} />
      </div>
      <MetaRow label={t(language, "folder")} value={image.folder} />
      <MetaRow label={t(language, "path")} value={image.path} />
      <div className="libraryTagEditor">
        <span className="libraryMetaKey">{t(language, "imageTags")}</span>
        <div className="libraryTagChips">
          {image.tags.map((tag) => (
            <span key={tag} className="libraryTagChip">
              {tag}
              <button type="button" onClick={() => void setImageTags(image.path, image.tags.filter((item) => item !== tag))}>
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            value={draft}
            placeholder="+"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTag();
              }
            }}
          />
        </div>
      </div>
      <div className="libraryDetailActions">
        <Button icon={<FolderOpen size={15} />} onClick={() => revealFile(image.path)}>{t(language, "openFolder")}</Button>
        {image.artwork_url ? (
          <Button icon={<ExternalLink size={15} />} onClick={() => void runGuiApi("browser.open", { urls: [image.artwork_url] })}>
            {t(language, "openSource")}
          </Button>
        ) : null}
        <Button variant="primary" onClick={onClose}>{t(language, "close")}</Button>
      </div>
    </div>
  );
}

export function LibraryDetailModal({
  language,
  image,
  images,
  onPathChange,
  onClose,
  revealFile,
  setImageTags,
  onFetchTags,
  busy
}: LibraryDetailModalProps) {
  const options = previewOptions(image);
  const { image: preview, error } = useImagePreview(image.path, "", "single", options);
  const zoom = useZoomPan(`${image.path}:${options.targetWidth ? "long" : "fit"}`);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [detailsOpen, setDetailsOpen] = useState(true);
  const fitSize = useMemo(
    () => containSize(stageSize, { width: preview?.width || image.width || 0, height: preview?.height || image.height || 0 }),
    [image.height, image.width, preview?.height, preview?.width, stageSize]
  );
  const index = Math.max(0, images.findIndex((item) => item.path === image.path));
  const hasMultipleImages = images.length > 1;

  useEffect(() => {
    const node = zoom.containerRef.current;
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
  }, [zoom.containerRef]);

  const step = useCallback((offset: number) => {
    if (images.length > 1) {
      onPathChange(images[(index + offset + images.length) % images.length].path);
    }
  }, [images, index, onPathChange]);

  useEffect(() => {
    if (!hasMultipleImages) {
      return;
    }
    const adjacent = [images[(index - 1 + images.length) % images.length], images[(index + 1) % images.length]];
    for (const item of adjacent) {
      prefetchImagePreview(item.path, previewOptions(item));
    }
  }, [hasMultipleImages, images, index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal libraryDetailModal" onClick={(event) => event.stopPropagation()}>
        <div className="previewTitleRow">
          <h3 title={image.filename}>{image.filename}</h3>
          <div className="libraryDetailHeaderActions">
            <span className="libraryDetailCounter">{index + 1} / {images.length}</span>
            <Button
              icon={detailsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              iconOnly
              title={t(language, detailsOpen ? "hideDetails" : "showDetails")}
              onClick={() => setDetailsOpen((value) => !value)}
            >
              {t(language, detailsOpen ? "hideDetails" : "showDetails")}
            </Button>
          </div>
        </div>
        <div className={`libraryDetailBody${detailsOpen ? "" : " detailsCollapsed"}`}>
          <div
            className={`libraryDetailStage${zoom.isZoomed ? " zoomed" : ""}`}
            ref={zoom.containerRef}
            title={t(language, "zoomHint")}
            onPointerDown={zoom.panHandlers.onPointerDown}
            onPointerMove={zoom.panHandlers.onPointerMove}
            onPointerUp={zoom.panHandlers.onPointerUp}
            onPointerCancel={zoom.panHandlers.onPointerCancel}
            onDoubleClick={zoom.reset}
          >
            {preview?.data_url ? (
              <ZoomLayer dataUrl={preview.data_url} alt={image.filename} transform={zoom.transform} fitSize={fitSize} />
            ) : (
              <span className="previewPlaceholder">{t(language, "loadingPreview")}</span>
            )}
            {error ? <span className="previewError">{error}</span> : null}
            {hasMultipleImages ? (
              <LibraryStageNav language={language} onPrevious={() => step(-1)} onNext={() => step(1)} />
            ) : null}
          </div>
          {detailsOpen ? (
            <LibraryDetailMetaPanel
              language={language}
              image={image}
              busy={busy}
              revealFile={revealFile}
              setImageTags={setImageTags}
              onFetchTags={onFetchTags}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </ModalOverlay>
  );
}
