import { useRef } from "react";
import type { CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { UserPlus, XCircle } from "lucide-react";
import { UNMATCHED_COL_WIDTHS_KEY } from "../constants";
import { useColumnWidths } from "../hooks/useColumnWidths";
import type { ColumnDef } from "../hooks/useColumnWidths";
import { t } from "../i18n";
import type { Language, UnmatchedFolder } from "../types";
import { Button } from "./Button";
import { ColumnResizeHandle } from "./ColumnResizeHandle";

type UnmatchedColumn = "path" | "count" | "actions";

const UNMATCHED_COLUMNS: ColumnDef<UnmatchedColumn>[] = [
  { key: "path", flex: true },
  { key: "count", width: 80 },
  { key: "actions", width: 250 },
];

export function UnmatchedView({
  language,
  folders,
  excludeFolder,
  assignFolder,
  openPath
}: {
  language: Language;
  folders: UnmatchedFolder[];
  excludeFolder: (path: string) => void;
  assignFolder: (path: string) => void;
  openPath: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: folders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 14
  });
  const { gridTemplate, leftHandle, rightHandle, overlay } = useColumnWidths<UnmatchedColumn>(
    UNMATCHED_COL_WIDTHS_KEY,
    UNMATCHED_COLUMNS,
  );
  const tableStyle: CSSProperties = { ["--cols" as string]: gridTemplate };
  return (
    <section className="panel">
      <div className="toolbar">
        <span className="summary">
          {folders.length ? `${folders.length} ${t(language, "unmatched")}` : t(language, "unmatchedHint")}
        </span>
      </div>
      <div className="table unmatchedTable" style={tableStyle}>
        <div className="tableHeader">
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("path")} side="left" />
            <span>{t(language, "path")}</span>
            <ColumnResizeHandle handle={rightHandle("path")} side="right" />
          </span>
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("count")} side="left" />
            <span>{t(language, "unmatchedCount")}</span>
            <ColumnResizeHandle handle={rightHandle("count")} side="right" />
          </span>
          <span className="headerCell">
            <ColumnResizeHandle handle={leftHandle("actions")} side="left" />
            <span>{t(language, "actions")}</span>
            <ColumnResizeHandle handle={rightHandle("actions")} side="right" />
          </span>
        </div>
        <div className="virtualList" ref={parentRef}>
          {folders.length ? (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = folders[row.index];
                return (
                  <div
                    className="tableRow unmatchedRow"
                    key={item.path}
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <span
                      className="pathText clickablePath"
                      title={item.path}
                      onDoubleClick={() => openPath(item.path)}
                    >
                      {item.path}
                    </span>
                    <span className="numeric">{item.count}</span>
                    <span className="unmatchedActions">
                      <Button icon={<UserPlus size={14} />} onClick={() => assignFolder(item.path)}>
                        {t(language, "assignArtist")}
                      </Button>
                      <Button icon={<XCircle size={14} />} variant="danger" onClick={() => excludeFolder(item.path)}>
                        {t(language, "excludeFolder")}
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="emptyState">{t(language, "unmatchedHint")}</div>
          )}
        </div>
      </div>
      {overlay}
    </section>
  );
}
