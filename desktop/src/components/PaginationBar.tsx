import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";
import { Button } from "./Button";

export function PaginationBar({
  language,
  page,
  pageCount,
  total,
  pageSize,
  pageSizeOptions,
  compact = false,
  onPageChange,
  onPageSizeChange
}: {
  language: Language;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  pageSizeOptions: number[];
  compact?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);

  return (
    <div className={`paginationBar${compact ? " compact" : ""}`}>
      <Button
        icon={<ChevronLeft size={compact ? 14 : 15} />}
        disabled={safePage <= 1}
        onClick={() => onPageChange(safePage - 1)}
      >
        {t(language, "previousPage")}
      </Button>
      <span className="paginationStatus">
        {safePage} / {safePageCount} · {total}
      </span>
      <Button
        icon={<ChevronRight size={compact ? 14 : 15} />}
        disabled={safePage >= safePageCount}
        onClick={() => onPageChange(safePage + 1)}
      >
        {t(language, "nextPage")}
      </Button>
      <label className="paginationSize">
        <span>{t(language, "itemsPerPage")}</span>
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
