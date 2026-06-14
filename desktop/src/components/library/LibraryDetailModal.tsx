import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, Tags, X } from "lucide-react";
import { useState } from "react";
import { runGuiApi } from "../../api";
import { t } from "../../i18n";
import type { Language, LibraryImage, PixivTag } from "../../types";
import { formatBytes } from "../../utils/format";
import { useImagePreview } from "../../hooks/useImagePreview";
import { Button } from "../Button";
import { ModalOverlay } from "../ModalOverlay";

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
  const [draft, setDraft] = useState("");
  const { image: preview, error } = useImagePreview(image.path, "", "single");
  const index = Math.max(0, images.findIndex((item) => item.path === image.path));
  const step = (offset: number) => {
    if (images.length > 1) {
      onPathChange(images[(index + offset + images.length) % images.length].path);
    }
  };
  const addTag = () => {
    const value = draft.trim();
    if (value) {
      void setImageTags(image.path, [...image.tags, value]);
    }
    setDraft("");
  };
  const modified = image.mtime_ns ? new Date(image.mtime_ns / 1_000_000).toLocaleString() : "";

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal libraryDetailModal" onClick={(event) => event.stopPropagation()}>
        <div className="previewTitleRow">
          <h3 title={image.filename}>{image.filename}</h3>
          <div className="previewStepper">
            <Button icon={<ChevronLeft size={16} />} onClick={() => step(-1)}>{t(language, "previousImage")}</Button>
            <span>{index + 1} / {images.length}</span>
            <Button icon={<ChevronRight size={16} />} onClick={() => step(1)}>{t(language, "nextImage")}</Button>
          </div>
        </div>
        <div className="libraryDetailBody">
          <div className="libraryDetailStage">
            {preview?.data_url ? (
              <img src={preview.data_url} alt={image.filename} />
            ) : (
              <span className="previewPlaceholder">{t(language, "loadingPreview")}</span>
            )}
            {error ? <span className="previewError">{error}</span> : null}
          </div>
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
        </div>
      </div>
    </ModalOverlay>
  );
}
