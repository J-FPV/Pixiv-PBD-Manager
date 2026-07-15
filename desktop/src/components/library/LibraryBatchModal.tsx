import { CheckCircle2, Inbox, Sparkles } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import type { Language, LibraryMarker, LibraryMetadataPatch } from "../../types";
import { Button } from "../Button";
import { ModalOverlay } from "../ModalOverlay";

type ChangeMode = "keep" | "add" | "remove";

const MARKERS: { id: LibraryMarker; icon: typeof Sparkles; label: "markerHighValue" | "markerUsed" | "markerToSort" }[] = [
  { id: "high_value", icon: Sparkles, label: "markerHighValue" },
  { id: "used", icon: CheckCircle2, label: "markerUsed" },
  { id: "to_sort", icon: Inbox, label: "markerToSort" }
];

function splitTags(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)));
}

function ModeButtons({
  language,
  value,
  onChange
}: {
  language: Language;
  value: ChangeMode;
  onChange: (value: ChangeMode) => void;
}) {
  return (
    <div className="segmented compactSegmented">
      {(["keep", "add", "remove"] as const).map((mode) => (
        <button type="button" className={value === mode ? "active" : ""} key={mode} onClick={() => onChange(mode)}>
          {t(language, mode === "keep" ? "leaveUnchanged" : mode === "add" ? "applyMarker" : "clearMarker")}
        </button>
      ))}
    </div>
  );
}

export function LibraryBatchModal({
  language,
  count,
  onClose,
  onApply
}: {
  language: Language;
  count: number;
  onClose: () => void;
  onApply: (patch: LibraryMetadataPatch) => Promise<void>;
}) {
  const [favorite, setFavorite] = useState<"keep" | "yes" | "no">("keep");
  const [rating, setRating] = useState(-1);
  const [markers, setMarkers] = useState<Record<LibraryMarker, ChangeMode>>({
    high_value: "keep",
    used: "keep",
    to_sort: "keep"
  });
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");
  const [tagText, setTagText] = useState("");
  const [copyPixivTags, setCopyPixivTags] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const tagValues = splitTags(tagText);
  const hasChanges =
    favorite !== "keep" ||
    rating >= 0 ||
    Object.values(markers).some((value) => value !== "keep") ||
    tagValues.length > 0 ||
    copyPixivTags;

  const apply = async () => {
    if (!hasChanges || submitting) return;
    const patch: LibraryMetadataPatch = {};
    if (favorite !== "keep") patch.favorite = favorite === "yes";
    if (rating >= 0) patch.rating = rating;
    patch.add_markers = MARKERS.filter(({ id }) => markers[id] === "add").map(({ id }) => id);
    patch.remove_markers = MARKERS.filter(({ id }) => markers[id] === "remove").map(({ id }) => id);
    if (tagValues.length) patch[tagMode === "add" ? "add_tags" : "remove_tags"] = tagValues;
    if (copyPixivTags) patch.copy_pixiv_tags = true;
    setSubmitting(true);
    try {
      await onApply(patch);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal libraryBatchModal" onClick={(event) => event.stopPropagation()}>
        <div className="batchModalHeader">
          <div>
            <h3>{t(language, "batchEdit")}</h3>
            <p>{t(language, "batchEditCount").replace("{count}", String(count))}</p>
          </div>
        </div>
        <div className="batchEditGrid">
          <label>{t(language, "favoriteImages")}</label>
          <div className="segmented">
            {(["keep", "yes", "no"] as const).map((value) => (
              <button type="button" className={favorite === value ? "active" : ""} key={value} onClick={() => setFavorite(value)}>
                {t(language, value === "keep" ? "leaveUnchanged" : value === "yes" ? "markFavorite" : "clearFavorite")}
              </button>
            ))}
          </div>
          <label>{t(language, "rating")}</label>
          <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
            <option value={-1}>{t(language, "leaveUnchanged")}</option>
            <option value={0}>{t(language, "unrated")}</option>
            {[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value} ★</option>)}
          </select>
        </div>
        <div className="batchMarkerRows">
          <span className="batchSectionLabel">{t(language, "workflowMarkers")}</span>
          {MARKERS.map(({ id, icon: Icon, label }) => (
            <div className="batchMarkerRow" key={id}>
              <span><Icon size={16} /> {t(language, label)}</span>
              <ModeButtons
                language={language}
                value={markers[id]}
                onChange={(value) => setMarkers((current) => ({ ...current, [id]: value }))}
              />
            </div>
          ))}
        </div>
        <div className="batchTagEditor">
          <div className="batchTagHeader">
            <span className="batchSectionLabel">{t(language, "imageTags")}</span>
            <div className="segmented compactSegmented">
              <button type="button" className={tagMode === "add" ? "active" : ""} onClick={() => setTagMode("add")}>{t(language, "add")}</button>
              <button type="button" className={tagMode === "remove" ? "active" : ""} onClick={() => setTagMode("remove")}>{t(language, "remove")}</button>
            </div>
          </div>
          <textarea
            rows={2}
            value={tagText}
            placeholder={t(language, "batchTagsPlaceholder")}
            onChange={(event) => setTagText(event.target.value)}
          />
          <label className="checkLine">
            <input type="checkbox" checked={copyPixivTags} onChange={(event) => setCopyPixivTags(event.target.checked)} />
            <span>{t(language, "copyPixivTagsToLocal")}</span>
          </label>
        </div>
        <div className="modalActions">
          <Button onClick={onClose}>{t(language, "cancel")}</Button>
          <Button variant="primary" disabled={!hasChanges || submitting} onClick={() => void apply()}>
            {t(language, submitting ? "running" : "apply")}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
