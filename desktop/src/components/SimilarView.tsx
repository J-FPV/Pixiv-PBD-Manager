import { useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Image as ImageIcon } from "lucide-react";
import { browsePath } from "../api";
import { SIMILAR_COL_WIDTHS_KEY } from "../constants";
import { useColumnWidths } from "../hooks/useColumnWidths";
import type { ColumnDef } from "../hooks/useColumnWidths";
import { t } from "../i18n";
import type {
  Language,
  SimilarEntry,
  SimilarGroup,
  SimilarResult,
  SimilarThreshold
} from "../types";
import { formatBytes } from "../utils/format";
import { clampTextareaHeight } from "../utils/textarea";
import { Button } from "./Button";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SimilarThumbnail } from "./SimilarThumbnail";

type SimilarColumn = "group" | "kind" | "preview" | "path" | "resolution" | "size";

const SIMILAR_COLUMNS: ColumnDef<SimilarColumn>[] = [
  { key: "group", width: 120 },
  { key: "kind", width: 120 },
  { key: "preview", width: 76 },
  { key: "path", flex: true },
  { key: "resolution", width: 110 },
  { key: "size", width: 90 },
];

type SimilarRow =
  | { type: "group"; group: SimilarGroup }
  | { type: "entry"; group: SimilarGroup; entry: SimilarEntry };

export function SimilarView({
  language,
  result,
  threshold,
  skipPixivPages,
  busy,
  expanded,
  roots,
  excludes,
  rootBoxHeight,
  excludeBoxHeight,
  setRoots,
  setExcludes,
  setRootBoxHeight,
  setExcludeBoxHeight,
  setThreshold,
  setSkipPixivPages,
  findSimilar,
  toggleGroup,
  revealFile
}: {
  language: Language;
  result: SimilarResult | null;
  threshold: SimilarThreshold;
  skipPixivPages: boolean;
  busy: boolean;
  expanded: Set<number>;
  roots: string;
  excludes: string;
  rootBoxHeight?: number;
  excludeBoxHeight?: number;
  setRoots: (value: string) => void;
  setExcludes: (value: string) => void;
  setRootBoxHeight: (value: number | undefined) => void;
  setExcludeBoxHeight: (value: number | undefined) => void;
  setThreshold: (value: SimilarThreshold) => void;
  setSkipPixivPages: (value: boolean) => void;
  findSimilar: () => void;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rootTextareaRef = useRef<HTMLTextAreaElement>(null);
  const excludeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<{ group: SimilarGroup; path: string } | null>(null);
  const rows = useMemo<SimilarRow[]>(() => {
    const output: SimilarRow[] = [];
    for (const group of result?.groups || []) {
      output.push({ type: "group", group });
      if (expanded.has(group.id)) {
        for (const entry of group.entries) {
          output.push({ type: "entry", group, entry });
        }
      }
    }
    return output;
  }, [result, expanded]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === "entry" ? 76 : 42),
    overscan: 14
  });
  const { gridTemplate, leftHandle, rightHandle, overlay } = useColumnWidths<SimilarColumn>(
    SIMILAR_COL_WIDTHS_KEY,
    SIMILAR_COLUMNS,
  );
  const tableStyle: CSSProperties = { ["--cols" as string]: gridTemplate };

  const appendFolder = async (value: string, setter: (next: string) => void) => {
    const picked = await browsePath("folder");
    if (!picked) {
      return;
    }
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.includes(picked)) {
      setter([...lines, picked].join("\n"));
    }
  };

  const rememberTextareaHeight = (
    ref: RefObject<HTMLTextAreaElement | null>,
    setter: (value: number | undefined) => void
  ) => {
    setter(clampTextareaHeight(ref.current?.offsetHeight));
  };

  return (
    <section className="panel">
      <div className="similarHeader">
        <div className="similarPaths">
          <label>
            <span>{t(language, "similarRoots")}</span>
            <textarea
              ref={rootTextareaRef}
              value={roots}
              onChange={(event) => setRoots(event.target.value)}
              onMouseUp={() => rememberTextareaHeight(rootTextareaRef, setRootBoxHeight)}
              onBlur={() => rememberTextareaHeight(rootTextareaRef, setRootBoxHeight)}
              placeholder={t(language, "similarRootsHint")}
              style={rootBoxHeight ? { height: rootBoxHeight } : undefined}
            />
            <button type="button" className="button browseButton" onClick={() => void appendFolder(roots, setRoots)}>
              {t(language, "addFolder")}
            </button>
          </label>
          <label>
            <span>{t(language, "excludeRoots")}</span>
            <textarea
              ref={excludeTextareaRef}
              value={excludes}
              onChange={(event) => setExcludes(event.target.value)}
              onMouseUp={() => rememberTextareaHeight(excludeTextareaRef, setExcludeBoxHeight)}
              onBlur={() => rememberTextareaHeight(excludeTextareaRef, setExcludeBoxHeight)}
              placeholder={t(language, "similarExcludeRootsHint")}
              style={excludeBoxHeight ? { height: excludeBoxHeight } : undefined}
            />
            <button type="button" className="button browseButton" onClick={() => void appendFolder(excludes, setExcludes)}>
              {t(language, "addFolder")}
            </button>
          </label>
        </div>
        <div className="toolbar">
          <div className="segmented">
            <button className={threshold === "likely" ? "active" : ""} onClick={() => setThreshold("likely")}>
              {t(language, "likely")}
            </button>
            <button className={threshold === "possible" ? "active" : ""} onClick={() => setThreshold("possible")}>
              {t(language, "possible")}
            </button>
          </div>
          <label className="checkLine compactCheck">
            <input
              type="checkbox"
              checked={skipPixivPages}
              onChange={(event) => setSkipPixivPages(event.target.checked)}
            />
            <span>{t(language, "skipPixivPages")}</span>
          </label>
          <Button icon={<ImageIcon size={16} />} disabled={busy} onClick={findSimilar} variant="primary">
            {t(language, "findSimilar")}
          </Button>
          {result ? (
            <span className="summary">
              {result.files_seen} files / {result.indexed} indexed / {result.groups.length} groups / {result.error_count} errors
            </span>
          ) : null}
        </div>
      </div>

      <div className="table similarTable" style={tableStyle}>
        <div className="tableHeader">
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("group")} side="left" />
            <span>{t(language, "group")}</span>
            <ColumnResizeHandle handle={rightHandle("group")} side="right" />
          </span>
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("kind")} side="left" />
            <span>{t(language, "kind")}</span>
            <ColumnResizeHandle handle={rightHandle("kind")} side="right" />
          </span>
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("preview")} side="left" />
            <span>{t(language, "preview")}</span>
            <ColumnResizeHandle handle={rightHandle("preview")} side="right" />
          </span>
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("path")} side="left" />
            <span>{t(language, "path")}</span>
            <ColumnResizeHandle handle={rightHandle("path")} side="right" />
          </span>
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("resolution")} side="left" />
            <span>{t(language, "resolution")}</span>
            <ColumnResizeHandle handle={rightHandle("resolution")} side="right" />
          </span>
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("size")} side="left" />
            <span>{t(language, "size")}</span>
            <ColumnResizeHandle handle={rightHandle("size")} side="right" />
          </span>
        </div>
        <div className="virtualList" ref={parentRef}>
          {rows.length ? (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = rows[row.index];
                if (item.type === "group") {
                  const isExpanded = expanded.has(item.group.id);
                  return (
                    <button
                      className="tableRow similarGroupRow"
                      key={`group-${item.group.id}`}
                      style={{ transform: `translateY(${row.start}px)` }}
                      onClick={() => toggleGroup(item.group.id)}
                    >
                      <span>{isExpanded ? "v" : ">"} {t(language, "group")} {item.group.id}</span>
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
                    key={`${item.group.id}-${item.entry.path}`}
                    style={{ transform: `translateY(${row.start}px)` }}
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
                      onPreview={() => setPreview({ group: item.group, path: item.entry.path })}
                    />
                    <span className="pathText clickablePath" title={item.entry.path}>{item.entry.path}</span>
                    <span>{item.entry.resolution}</span>
                    <span className="numeric">{formatBytes(item.entry.size_bytes)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="emptyState">{t(language, "empty")}</div>
          )}
        </div>
      </div>
      {preview ? (
        <ImagePreviewModal
          language={language}
          path={preview.path}
          paths={preview.group.entries.map((entry) => entry.path)}
          onPathChange={(path) => setPreview({ ...preview, path })}
          onClose={() => setPreview(null)}
          revealFile={revealFile}
        />
      ) : null}
      {overlay}
    </section>
  );
}
