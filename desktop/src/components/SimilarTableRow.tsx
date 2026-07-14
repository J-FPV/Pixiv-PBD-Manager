import { Archive, ChevronRight, Eye, EyeOff } from "lucide-react";
import { t } from "../i18n";
import type { Language, SimilarEntry, SimilarGroup } from "../types";
import { formatBytes } from "../utils/format";
import { SimilarThumbnail } from "./SimilarThumbnail";

export type SimilarRowItem =
  | { type: "group"; group: SimilarGroup }
  | { type: "entry"; group: SimilarGroup; entry: SimilarEntry };

interface SimilarEntryRowProps {
  group: SimilarGroup;
  entry: SimilarEntry;
  language: Language;
  offset: number;
  selected: boolean;
  revealFile: (path: string) => void;
  toggleCleanupEntry: (group: SimilarGroup, path: string) => void;
  quarantineEntry: (entry: SimilarEntry) => void;
  onPreview: (group: SimilarGroup, path: string) => void;
}

// An image entry row: keep/remove label + thumbnail + path/resolution/size and
// a per-image "move to quarantine" action.
function SimilarEntryRow({
  group,
  entry,
  language,
  offset,
  selected,
  revealFile,
  toggleCleanupEntry,
  quarantineEntry,
  onPreview
}: SimilarEntryRowProps) {
  const recommendedKeep = group.recommended_keep_path === entry.path;
  return (
    <div
      className={`tableRow similarEntryRow${selected ? " cleanupSelectedRow" : ""}`}
      style={{ transform: `translateY(${offset}px)` }}
      onDoubleClick={() => revealFile(entry.path)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          revealFile(entry.path);
        }
      }}
    >
      <span className="cleanupEntrySelect">
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleCleanupEntry(group, entry.path)}
          title={t(language, selected ? "markedForCleanup" : "keep")}
        />
      </span>
      <span className={selected ? "cleanupRemoveLabel" : recommendedKeep ? "cleanupKeepLabel" : ""}>
        {selected ? t(language, "markedForCleanup") : recommendedKeep ? t(language, "recommendedKeep") : t(language, "keep")}
      </span>
      <SimilarThumbnail language={language} path={entry.path} onPreview={() => onPreview(group, entry.path)} />
      <span className="pathText clickablePath" title={entry.path}>{entry.path}</span>
      <span className="centerNumeric">{entry.resolution}</span>
      <span className="centerNumeric">{formatBytes(entry.size_bytes)}</span>
      <button
        type="button"
        className="iconTableAction"
        title={t(language, "moveToQuarantine")}
        onClick={(event) => {
          event.stopPropagation();
          quarantineEntry(entry);
        }}
      >
        <Archive size={16} />
      </button>
    </div>
  );
}

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
  quarantineEntry,
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
  quarantineEntry: (entry: SimilarEntry) => void;
  ignored: boolean;
  ignoreGroup: (group: SimilarGroup) => void;
  unignoreGroup: (signature: string) => void;
  onPreview: (group: SimilarGroup, path: string) => void;
}) {
  if (item.type === "group") {
    const isExpanded = expanded.has(item.group.id);
    const ruleKey =
      item.group.kind === "exact"
        ? "recommendationExact"
        : item.group.kind === "likely"
          ? "recommendationLikely"
          : "recommendationPossible";
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
          <small className="recommendationRule">{t(language, ruleKey)}</small>
        </span>
        <span />
        <span className="centerNumeric">{formatBytes(item.group.estimated_reclaim_bytes || 0)}</span>
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
  return (
    <SimilarEntryRow
      group={item.group}
      entry={item.entry}
      language={language}
      offset={offset}
      selected={selectedForCleanup.has(item.entry.path)}
      revealFile={revealFile}
      toggleCleanupEntry={toggleCleanupEntry}
      quarantineEntry={quarantineEntry}
      onPreview={onPreview}
    />
  );
}
