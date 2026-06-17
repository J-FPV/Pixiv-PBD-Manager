import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { CleanupOperation, CleanupSummary, Language } from "../types";
import { CleanupOperationSection } from "./CleanupOperationSection";
import { PaginationBar } from "./PaginationBar";

const OPERATION_PAGE_SIZE_OPTIONS = [5, 10, 20];

export function CleanupHistory({
  language,
  summary,
  busy,
  restoreItems,
  deleteItems,
  revealFile
}: {
  language: Language;
  summary: CleanupSummary;
  busy: boolean;
  restoreItems: (operationId: string, itemIds: string[]) => void;
  deleteItems: (operationId: string, itemIds: string[]) => void;
  revealFile: (path: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const availableIds = useMemo(
    () =>
      new Set(
        summary.operations.flatMap((operation) =>
          operation.items.filter((item) => item.status === "quarantined").map((item) => item.id)
        )
      ),
    [summary]
  );
  const pageCount = Math.max(1, Math.ceil(summary.operations.length / pageSize));
  const visibleOperations = useMemo(() => {
    const start = (page - 1) * pageSize;
    return summary.operations.slice(start, start + pageSize);
  }, [page, pageSize, summary.operations]);

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [availableIds]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), pageCount));
  }, [pageCount]);

  const toggleAll = (operation: CleanupOperation) => {
    const ids = operation.items.filter((item) => item.status === "quarantined").map((item) => item.id);
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!summary.operations.length) {
    return <div className="emptyState">{t(language, "quarantineEmpty")}</div>;
  }

  return (
    <div className="cleanupHistoryShell">
      <PaginationBar
        language={language}
        page={page}
        pageCount={pageCount}
        total={summary.operations.length}
        pageSize={pageSize}
        pageSizeOptions={OPERATION_PAGE_SIZE_OPTIONS}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
      <div className="cleanupHistory">
        {visibleOperations.map((operation) => (
          <CleanupOperationSection
            key={operation.id}
            language={language}
            operation={operation}
            busy={busy}
            selected={selected}
            toggleAll={() => toggleAll(operation)}
            toggleItem={toggleItem}
            restoreItems={restoreItems}
            deleteItems={deleteItems}
            revealFile={revealFile}
          />
        ))}
      </div>
    </div>
  );
}
