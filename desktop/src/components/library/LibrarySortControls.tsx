import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { t } from "../../i18n";
import type { Language, LibrarySort, LibrarySortKey } from "../../types";
import { LIBRARY_SORT_KEYS } from "../../utils/librarySort";

const LABELS = {
  created: "createdTime",
  modified: "modifiedTime",
  filename: "sortFilename",
  size: "fileSize",
  pixels: "sortPixels",
  rating: "rating"
} as const;

export function LibrarySortControls({ language, sort, setSort }: {
  language: Language;
  sort: LibrarySort;
  setSort: (sort: LibrarySort) => void;
}) {
  const directionLabel = t(language, sort.direction === "asc" ? "sortAscending" : "sortDescending");
  return (
    <div className="librarySortControls">
      <select
        aria-label={t(language, "sortBy")}
        value={sort.key}
        onChange={(event) => {
          const key = event.target.value as LibrarySortKey;
          setSort({ key, direction: key === "filename" ? "asc" : "desc" });
        }}
      >
        {LIBRARY_SORT_KEYS.map((key) => <option key={key} value={key}>{t(language, LABELS[key])}</option>)}
      </select>
      <button
        type="button"
        className="button iconButton"
        title={directionLabel}
        aria-label={directionLabel}
        onClick={() => setSort({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}
      >
        {sort.direction === "asc" ? <ArrowUpNarrowWide size={16} /> : <ArrowDownWideNarrow size={16} />}
      </button>
    </div>
  );
}
