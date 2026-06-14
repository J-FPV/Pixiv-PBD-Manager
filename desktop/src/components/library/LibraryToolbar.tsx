import { PanelLeft, RefreshCw, Search, Tags, XCircle } from "lucide-react";
import { t } from "../../i18n";
import type { Language } from "../../types";
import { Button } from "../Button";

export function LibraryToolbar({
  language,
  keyword,
  setKeyword,
  count,
  busy,
  needsScan,
  onScan,
  onFetchTags,
  fetchDisabled,
  toggleSidebar
}: {
  language: Language;
  keyword: string;
  setKeyword: (value: string) => void;
  count: number;
  busy: boolean;
  needsScan: boolean;
  onScan: () => void;
  onFetchTags: () => void;
  fetchDisabled: boolean;
  toggleSidebar: () => void;
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
      <div className="toolbarSpacer" />
      <Button icon={<Tags size={15} />} onClick={onFetchTags} disabled={busy || fetchDisabled}>
        {t(language, "fetchPixivTags")}
      </Button>
      <Button icon={<RefreshCw size={15} />} onClick={onScan} disabled={busy}>
        {t(language, needsScan ? "scanLibrary" : "rescanLibrary")}
      </Button>
    </div>
  );
}
