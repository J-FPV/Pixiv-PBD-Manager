import { ChevronRight, Eye, EyeOff } from "lucide-react";
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
  selectedForCleanup,
  toggleCleanupEntry,
  ignored,
  ignoreGroup,
  unignoreGroup,
  onPreview
}: {
  item: SimilarRowItem;
  language: Language;
  expanded: Set<number>;
  offset: number;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
  selectedForCleanup: Set<string>;
  toggleCleanupEntry: (group: SimilarGroup, path: string) => void;
  ignored: boolean;
  ignoreGroup: (group: SimilarGroup) => void;
  unignoreGroup: (signature: string) => void;
  onPreview: (group: SimilarGroup, path: string) => void;
}) {
  if (item.type === "group") {
    const isExpanded = expanded.has(item.group.id);
    return (
      <div
        className={`tableRow similarGroupRow${isExpanded ? " expanded" : ""}`}
        style={{ transform: `translateY(${offset}px)` }}
        onClick={() => toggleGroup(item.group.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            toggleGroup(item.group.id);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span className="similarGroupTitle">
          <ChevronRight className="similarGroupChevron" size={17} aria-hidden="true" />
          <span>{t(language, "group")} {item.group.id}</span>
        </span>
        <span>{t(language, item.group.kind === "exact" ? "exact" : item.group.kind)}</span>
        <span />
        <span>
          {item.group.entries.length} files, pHash {item.group.best_phash_distance}, dHash {item.group.best_dhash_distance}
        </span>
        <span />
        <span>{formatBytes(item.group.estimated_reclaim_bytes || 0)}</span>
        <button
          type="button"
          className="iconTableAction"
          title={t(language, ignored ? "unignoreGroup" : "ignoreGroup")}
          disabled={!item.group.signature}
          onClick={(event) => {
            event.stopPropagation();
            if (ignored) {
              unignoreGroup(item.group.signature);
            } else {
              ignoreGroup(item.group);
            }
          }}
        >
          {ignored ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
    );
  }
  const selected = selectedForCleanup.has(item.entry.path);
  const recommendedKeep = item.group.recommended_keep_path === item.entry.path;
  return (
    <div
      className={`tableRow similarEntryRow${selected ? " cleanupSelectedRow" : ""}`}
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
      <span className="cleanupEntrySelect">
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleCleanupEntry(item.group, item.entry.path)}
          title={t(language, selected ? "markedForCleanup" : "keep")}
        />
      </span>
      <span className={selected ? "cleanupRemoveLabel" : recommendedKeep ? "cleanupKeepLabel" : ""}>
        {selected
          ? t(language, "markedForCleanup")
          : recommendedKeep
            ? t(language, "recommendedKeep")
            : t(language, "keep")}
      </span>
      <SimilarThumbnail
        language={language}
        path={item.entry.path}
        onPreview={() => onPreview(item.group, item.entry.path)}
      />
      <span className="pathText clickablePath" title={item.entry.path}>{item.entry.path}</span>
      <span className="centerNumeric">{item.entry.resolution}</span>
      <span className="centerNumeric">{formatBytes(item.entry.size_bytes)}</span>
      <span />
    </div>
  );
}
