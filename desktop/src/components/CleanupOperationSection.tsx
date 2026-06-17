import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { CleanupOperation, Language } from "../types";
import { formatBytes } from "../utils/format";
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
  const allSelected = selectable.length > 0 && operationSelected.length === selectable.length;
  const totalSize = operation.items.reduce((total, item) => total + item.size_bytes, 0);
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
      <div className="cleanupOperationHeader">
        <div>
          <strong>{t(language, "cleanupOperation")} / {new Date(operation.created_at).toLocaleString()}</strong>
          <span>{operation.items.length} files / {formatBytes(totalSize)} / {operation.quarantine_root}</span>
        </div>
        <div className="cleanupOperationActions">
          <label className="checkLine compactCheck">
            <input type="checkbox" checked={allSelected} disabled={!selectable.length} onChange={toggleAll} />
            <span>{t(language, "selectQuarantined")}</span>
          </label>
          <Button
            icon={<RotateCcw size={16} />}
            disabled={busy || !operationSelected.length}
            onClick={() => restoreItems(operation.id, operationSelected)}
          >
            {t(language, "restore")}
          </Button>
          <Button
            icon={<Trash2 size={16} />}
            variant="danger"
            disabled={busy || !operationSelected.length}
            onClick={() => deleteItems(operation.id, operationSelected)}
          >
            {t(language, "deletePermanently")}
          </Button>
        </div>
      </div>
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
