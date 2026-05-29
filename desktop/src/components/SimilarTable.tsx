import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SIMILAR_COL_WIDTHS_KEY } from "../constants";
import { useColumnWidths } from "../hooks/useColumnWidths";
import type { ColumnDef } from "../hooks/useColumnWidths";
import { t } from "../i18n";
import type { Language, SimilarGroup, SimilarResult } from "../types";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SimilarTableRow, type SimilarRowItem } from "./SimilarTableRow";

type SimilarColumn = "group" | "kind" | "preview" | "path" | "resolution" | "size";

const SIMILAR_COLUMNS: ColumnDef<SimilarColumn>[] = [
  { key: "group", width: 120 },
  { key: "kind", width: 120 },
  { key: "preview", width: 76 },
  { key: "path", flex: true },
  { key: "resolution", width: 110 },
  { key: "size", width: 90 }
];

const HEADER_COLUMNS: { key: SimilarColumn; labelKey: Parameters<typeof t>[1]; numeric?: boolean }[] = [
  { key: "group", labelKey: "group" },
  { key: "kind", labelKey: "kind" },
  { key: "preview", labelKey: "preview" },
  { key: "path", labelKey: "path" },
  { key: "resolution", labelKey: "resolution", numeric: true },
  { key: "size", labelKey: "size", numeric: true }
];

export function SimilarTable({
  language,
  result,
  expanded,
  toggleGroup,
  revealFile
}: {
  language: Language;
  result: SimilarResult | null;
  expanded: Set<number>;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ group: SimilarGroup; path: string } | null>(null);
  const rows = useMemo<SimilarRowItem[]>(() => {
    const output: SimilarRowItem[] = [];
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
    SIMILAR_COLUMNS
  );
  const tableStyle: CSSProperties = { ["--cols" as string]: gridTemplate };

  return (
    <>
      <div className="table similarTable" style={tableStyle}>
        <div className="tableHeader">
          {HEADER_COLUMNS.map((column) => (
            <span className="headerCell" key={column.key}>
              <ColumnResizeHandle handle={leftHandle(column.key)} side="left" />
              <span className={column.numeric ? "centerNumeric" : undefined}>{t(language, column.labelKey)}</span>
              <ColumnResizeHandle handle={rightHandle(column.key)} side="right" />
            </span>
          ))}
        </div>
        <div className="virtualList" ref={parentRef}>
          {rows.length ? (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = rows[row.index];
                const key = item.type === "group" ? `group-${item.group.id}` : `${item.group.id}-${item.entry.path}`;
                return (
                  <SimilarTableRow
                    key={key}
                    item={item}
                    language={language}
                    expanded={expanded}
                    offset={row.start}
                    toggleGroup={toggleGroup}
                    revealFile={revealFile}
                    onPreview={(group, path) => setPreview({ group, path })}
                  />
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
    </>
  );
}
