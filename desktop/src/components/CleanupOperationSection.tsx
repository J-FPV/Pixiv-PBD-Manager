import { useEffect, useMemo, useState } from "react";
import { FolderOpen, RotateCcw, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { CleanupOperation, Language } from "../types";
import { formatBytes } from "../utils/format";
import { parentPath } from "../utils/paths";
import { Button } from "./Button";
import { PaginationBar } from "./PaginationBar";

const ITEM_PAGE_SIZE_OPTIONS = [25, 50, 100];

function statusLabel(language: Language, status: string): string {
  if (status === "quarantined") {
    return t(language, "cleanupQuarantined");
  }
  if (status === "restored") {
    return t(language, "cleanupRestored");
  }
  if (status === "deleted") {
    return t(language, "cleanupDeleted");
  }
  if (status === "cancelled") {
    return t(language, "cleanupCancelled");
  }
  return t(language, "cleanupError");
}

function CleanupOperationHeader({
  language,
  operation,
  busy,
  selectableCount,
  selectedIds,
  toggleAll,
  restoreItems,
  deleteItems,
  revealFile
}: {
  language: Language;
  operation: CleanupOperation;
  busy: boolean;
  selectableCount: number;
  selectedIds: string[];
  toggleAll: () => void;
  restoreItems: (operationId: string, itemIds: string[]) => void;
  deleteItems: (operationId: string, itemIds: string[]) => void;
  revealFile: (path: string) => void;
}) {
  const totalSize = operation.items.reduce((total, item) => total + item.size_bytes, 0);
  const failed = operation.items.filter((item) => item.status === "error").length;
  const allSelected = selectableCount > 0 && selectedIds.length === selectableCount;
  return (
    <div className="cleanupOperationHeader">
      <div>
        <strong>{t(language, "cleanupOperation")} / {new Date(operation.created_at).toLocaleString()}</strong>
        <span>
          {operation.items.length} files / {formatBytes(totalSize)}
          {failed ? ` / ${t(language, "cleanupFailed")}: ${failed}` : ""} / {operation.quarantine_root}
        </span>
      </div>
      <div className="cleanupOperationActions">
        <Button icon={<FolderOpen size={16} />} onClick={() => revealFile(parentPath(operation.manifest_path))}>
          {t(language, "openTaskFolder")}
        </Button>
        <label className="checkLine compactCheck">
          <input type="checkbox" checked={allSelected} disabled={!selectableCount} onChange={toggleAll} />
          <span>{t(language, "selectQuarantined")}</span>
        </label>
        <Button icon={<RotateCcw size={16} />} disabled={busy || !selectedIds.length} onClick={() => restoreItems(operation.id, selectedIds)}>
          {t(language, "restore")}
        </Button>
        <Button icon={<Trash2 size={16} />} variant="danger" disabled={busy || !selectedIds.length} onClick={() => deleteItems(operation.id, selectedIds)}>
          {t(language, "deletePermanently")}
        </Button>
      </div>
    </div>
  );
}

export function CleanupOperationSection({
  language,
  operation,
  busy,
  selected,
  toggleAll,
  toggleItem,
  restoreItems,
  deleteItems,
  revealFile
}: {
  language: Language;
  operation: CleanupOperation;
  busy: boolean;
  selected: Set<string>;
  toggleAll: () => void;
  toggleItem: (id: string) => void;
  restoreItems: (operationId: string, itemIds: string[]) => void;
  deleteItems: (operationId: string, itemIds: string[]) => void;
  revealFile: (path: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const selectable = operation.items.filter((item) => item.status === "quarantined");
  const operationSelected = operation.items.filter((item) => selected.has(item.id)).map((item) => item.id);
  const pageCount = Math.max(1, Math.ceil(operation.items.length / pageSize));
  const visibleItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return operation.items.slice(start, start + pageSize);
  }, [operation.items, page, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), pageCount));
  }, [pageCount]);

  return (
    <section className="cleanupOperation">
      <CleanupOperationHeader
        language={language}
        operation={operation}
        busy={busy}
        selectableCount={selectable.length}
        selectedIds={operationSelected}
        toggleAll={toggleAll}
        restoreItems={restoreItems}
        deleteItems={deleteItems}
        revealFile={revealFile}
      />
      {operation.items.length > ITEM_PAGE_SIZE_OPTIONS[0] ? (
        <PaginationBar
          language={language}
          page={page}
          pageCount={pageCount}
          total={operation.items.length}
          pageSize={pageSize}
          pageSizeOptions={ITEM_PAGE_SIZE_OPTIONS}
          compact
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
        />
      ) : null}
      <div className="cleanupItemHeader">
        <span />
        <span>{t(language, "originalPath")}</span>
        <span>{t(language, "size")}</span>
        <span>{t(language, "cleanupStatus")}</span>
      </div>
      {visibleItems.map((item) => {
        const currentPath = item.status === "quarantined" ? item.quarantine_path : item.original_path;
        return (
          <div
            className="cleanupItemRow"
            key={item.id}
            onDoubleClick={() => revealFile(currentPath)}
            title={item.error || item.original_path}
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              disabled={item.status !== "quarantined"}
              onChange={() => toggleItem(item.id)}
            />
            <span className="pathText clickablePath">{item.original_path}</span>
            <span>{formatBytes(item.size_bytes)}</span>
            <span className={`cleanupStatus ${item.status}`}>{statusLabel(language, item.status)}</span>
            {item.error ? <small>{item.error}</small> : null}
          </div>
        );
      })}
    </section>
  );
}
