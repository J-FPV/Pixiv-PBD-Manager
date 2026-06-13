import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { CleanupOperation, CleanupSummary, Language } from "../types";
import { CleanupOperationSection } from "./CleanupOperationSection";

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
  const availableIds = useMemo(
    () =>
      new Set(
        summary.operations.flatMap((operation) =>
          operation.items.filter((item) => item.status === "quarantined").map((item) => item.id)
        )
      ),
    [summary]
  );

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [availableIds]);

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
    <div className="cleanupHistory">
      {summary.operations.map((operation) => (
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
  );
}
