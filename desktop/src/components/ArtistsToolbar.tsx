import { CheckSquare, Download, Play, Plus, RefreshCw, Search, Square, Trash2, XCircle } from "lucide-react";
import { t } from "../i18n";
import type { Artist, Language } from "../types";
import { Button } from "./Button";
import { ArtistsMoreMenu } from "./ArtistsMoreMenu";

export function ArtistsToolbar({
  language,
  filter,
  setFilter,
  busy,
  selected,
  visibleArtists,
  selectAll,
  clearAll,
  addArtist,
  scan,
  checkUpdates,
  downloadUpdated,
  openSelected,
  refreshArtistNames,
  copyUrls,
  removeSelectedArtists
}: {
  language: Language;
  filter: string;
  setFilter: (value: string) => void;
  busy: boolean;
  selected: Set<string>;
  visibleArtists: Artist[];
  selectAll: (ids: string[]) => void;
  clearAll: () => void;
  addArtist: () => void;
  scan: () => void;
  checkUpdates: () => void;
  downloadUpdated: () => void;
  openSelected: () => void;
  refreshArtistNames: () => void;
  copyUrls: () => void;
  removeSelectedArtists: () => void;
}) {
  const visibleIds = visibleArtists.map((artist) => artist.id);
  const hasVisibleArtists = visibleIds.length > 0;
  const allVisibleSelected = hasVisibleArtists && visibleIds.every((id) => selected.has(id));
  const toggleVisibleSelection = () => (allVisibleSelected ? clearAll() : selectAll(visibleIds));

  return (
    <div className="toolbar">
      <div className="searchBox">
        <Search size={16} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t(language, "search")} />
        {filter ? (
          <button className="searchClear" title={t(language, "clearSearch")} onClick={() => setFilter("")}>
            <XCircle size={16} />
          </button>
        ) : null}
      </div>
      <Button
        icon={allVisibleSelected ? <Square size={16} /> : <CheckSquare size={16} />}
        disabled={!hasVisibleArtists}
        onClick={toggleVisibleSelection}
      >
        {allVisibleSelected
          ? `${t(language, "clearAll")}${selected.size ? ` (${selected.size})` : ""}`
          : t(language, "selectAll")}
      </Button>
      <Button icon={<Plus size={16} />} onClick={addArtist}>
        {t(language, "add")}
      </Button>
      <Button icon={<Play size={16} />} disabled={busy} onClick={scan} variant="primary">
        {t(language, "scan")}
      </Button>
      <Button icon={<RefreshCw size={16} />} disabled={busy} onClick={checkUpdates}>
        {t(language, "checkUpdatesShort")}
      </Button>
      <Button icon={<Download size={16} />} disabled={busy} onClick={downloadUpdated}>
        {t(language, "downloadUpdatedShort")}
      </Button>
      <span className="toolbarSpacer" />
      <ArtistsMoreMenu
        language={language}
        busy={busy}
        selectedCount={selected.size}
        openSelected={openSelected}
        refreshArtistNames={refreshArtistNames}
        copyUrls={copyUrls}
      />
      <Button
        icon={<Trash2 size={16} />}
        disabled={busy || selected.size === 0}
        onClick={removeSelectedArtists}
        variant="danger"
        title={
          selected.size
            ? `${t(language, "removeSelectedArtists")} (${selected.size})`
            : t(language, "removeSelectedArtists")
        }
        iconOnly
      >
        {t(language, "removeSelectedArtists")}
      </Button>
    </div>
  );
}
