import { PanelLeft, RefreshCw, RotateCcw, Search, Stethoscope, Tags, XCircle } from "lucide-react";
import { t } from "../../i18n";
import type { Language, LibraryIndexStatus, LibrarySort } from "../../types";
import { Button } from "../Button";
import { LibrarySortControls } from "./LibrarySortControls";

export function LibraryToolbar({
  language,
  keyword,
  sort,
  setSort,
  setKeyword,
  count,
  busy,
  needsScan,
  indexStatus,
  onScan,
  onFetchTags,
  onRefetchTags,
  fetchDisabled,
  toggleSidebar,
  onDoctor
}: {
  language: Language;
  keyword: string;
  sort: LibrarySort;
  setSort: (sort: LibrarySort) => void;
  setKeyword: (value: string) => void;
  count: number;
  busy: boolean;
  needsScan: boolean;
  indexStatus: LibraryIndexStatus | null;
  onScan: () => void;
  onFetchTags: () => void;
  onRefetchTags: () => void;
  fetchDisabled: boolean;
  toggleSidebar: () => void;
  onDoctor: () => void;
}) {
  return (
    <div className="toolbar libraryToolbar">
      <button type="button" className="iconTableAction" title={t(language, "libraryFilters")} onClick={toggleSidebar}>
        <PanelLeft size={16} />
      </button>
      <div className="searchBox">
        <Search size={16} />
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t(language, "search")} />
        {keyword ? (
          <button className="searchClear" type="button" onClick={() => setKeyword("")}>
            <XCircle size={16} />
          </button>
        ) : null}
      </div>
      <LibrarySortControls language={language} sort={sort} setSort={setSort} />
      <span className="libraryCount">{t(language, "libraryCount").replace("{count}", String(count))}</span>
      {indexStatus ? (
        <span className={`libraryIndexBadge ${indexStatus.stale ? "stale" : "fresh"}`}>
          {t(language, indexStatus.stale ? "libraryIndexOutdated" : "libraryIndexCurrent")}
        </span>
      ) : null}
      <div className="toolbarSpacer" />
      <Button icon={<Stethoscope size={15} />} onClick={onDoctor}>
        {t(language, "libraryDoctor")}
      </Button>
      <Button
        icon={<Tags size={15} />}
        onClick={onFetchTags}
        disabled={busy || fetchDisabled}
        title={t(language, "fetchPixivTagsHint")}
      >
        {t(language, "fetchPixivTags")}
      </Button>
      <Button
        icon={<RotateCcw size={15} />}
        variant="quiet"
        onClick={onRefetchTags}
        disabled={busy || fetchDisabled}
        title={t(language, "refetchPixivTagsHint")}
      >
        {t(language, "refetchPixivTags")}
      </Button>
      <Button icon={<RefreshCw size={15} />} onClick={onScan} disabled={busy}>
        {t(language, needsScan ? "scanLibrary" : "rescanLibrary")}
      </Button>
    </div>
  );
}
