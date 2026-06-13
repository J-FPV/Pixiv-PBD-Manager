import { Star } from "lucide-react";
import { t } from "../../i18n";
import type { Language, SimilarEntry } from "../../types";
import { formatBytes } from "../../utils/format";

function modifiedLabel(mtimeNs: number): string {
  if (!mtimeNs) {
    return "";
  }
  const date = new Date(mtimeNs / 1_000_000);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

// One-line metadata caption for a previewed image: resolution, size, modified
// date, plus a badge when the cleanup recommender picked it as the keeper.
export function ImageMeta({
  language,
  entry,
  isKeep
}: {
  language: Language;
  entry?: SimilarEntry;
  isKeep: boolean;
}) {
  if (!entry) {
    return null;
  }
  const modified = modifiedLabel(entry.mtime_ns);
  return (
    <div className="previewMeta">
      {isKeep ? (
        <span className="previewKeepBadge" title={t(language, "recommendedKeep")}>
          <Star size={13} aria-hidden="true" /> {t(language, "recommendedKeep")}
        </span>
      ) : null}
      <span className="previewMetaItem">{entry.resolution}</span>
      <span className="previewMetaItem">{formatBytes(entry.size_bytes)}</span>
      {modified ? <span className="previewMetaItem">{t(language, "modified")}: {modified}</span> : null}
    </div>
  );
}
