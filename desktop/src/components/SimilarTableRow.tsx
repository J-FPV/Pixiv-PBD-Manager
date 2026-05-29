import { ChevronRight } from "lucide-react";
import { t } from "../i18n";
import type { Language, SimilarEntry, SimilarGroup } from "../types";
import { formatBytes } from "../utils/format";
import { SimilarThumbnail } from "./SimilarThumbnail";

export type SimilarRowItem =
  | { type: "group"; group: SimilarGroup }
  | { type: "entry"; group: SimilarGroup; entry: SimilarEntry };

// A single virtualized row: either a collapsible group header or an image
// entry. `offset` is the virtualizer's translateY for absolute positioning.
export function SimilarTableRow({
  item,
  language,
  expanded,
  offset,
  toggleGroup,
  revealFile,
  onPreview
}: {
  item: SimilarRowItem;
  language: Language;
  expanded: Set<number>;
  offset: number;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
  onPreview: (group: SimilarGroup, path: string) => void;
}) {
  if (item.type === "group") {
    const isExpanded = expanded.has(item.group.id);
    return (
      <button
        className={`tableRow similarGroupRow${isExpanded ? " expanded" : ""}`}
        style={{ transform: `translateY(${offset}px)` }}
        onClick={() => toggleGroup(item.group.id)}
        aria-expanded={isExpanded}
      >
        <span className="similarGroupTitle">
          <ChevronRight className="similarGroupChevron" size={17} aria-hidden="true" />
          <span>{t(language, "group")} {item.group.id}</span>
        </span>
        <span>{t(language, item.group.kind === "exact" ? "exact" : item.group.kind)}</span>
        <span />
        <span>{item.group.entries.length} files, pHash {item.group.best_phash_distance}, dHash {item.group.best_dhash_distance}</span>
        <span />
        <span />
      </button>
    );
  }
  return (
    <div
      className="tableRow similarEntryRow"
      style={{ transform: `translateY(${offset}px)` }}
      onDoubleClick={() => revealFile(item.entry.path)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          revealFile(item.entry.path);
        }
      }}
    >
      <span />
      <span />
      <SimilarThumbnail
        language={language}
        path={item.entry.path}
        onPreview={() => onPreview(item.group, item.entry.path)}
      />
      <span className="pathText clickablePath" title={item.entry.path}>{item.entry.path}</span>
      <span className="centerNumeric">{item.entry.resolution}</span>
      <span className="centerNumeric">{formatBytes(item.entry.size_bytes)}</span>
    </div>
  );
}
