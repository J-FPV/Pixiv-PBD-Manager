import { PanelLeft, RefreshCw, Search, Stethoscope, Tags, XCircle } from "lucide-react";
import { t } from "../../i18n";
import type { Language, LibraryIndexStatus } from "../../types";
import { Button } from "../Button";

export function LibraryToolbar({
  language,
  keyword,
  setKeyword,
  count,
  busy,
  needsScan,
  indexStatus,
  onScan,
  onFetchTags,
  fetchDisabled,
  toggleSidebar,
  onDoctor
}: {
  language: Language;
  keyword: string;
  setKeyword: (value: string) => void;
  count: number;
  busy: boolean;
  needsScan: boolean;
  indexStatus: LibraryIndexStatus | null;
  onScan: () => void;
  onFetchTags: () => void;
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
      <Button icon={<Tags size={15} />} onClick={onFetchTags} disabled={busy || fetchDisabled}>
        {t(language, "fetchPixivTags")}
      </Button>
      <Button icon={<RefreshCw size={15} />} onClick={onScan} disabled={busy}>
        {t(language, needsScan ? "scanLibrary" : "rescanLibrary")}
      </Button>
    </div>
  );
}
