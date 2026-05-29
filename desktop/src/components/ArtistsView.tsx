import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useArtistSort } from "../hooks/useArtistSort";
import type { Artist, Language } from "../types";
import { ArtistContextMenu, type ArtistMenuState } from "./ArtistContextMenu";
import { ArtistsTable } from "./ArtistsTable";
import { ArtistsToolbar } from "./ArtistsToolbar";

export function ArtistsView({
  language,
  artists,
  selected,
  filter,
  busy,
  setFilter,
  toggleArtist,
  selectAll,
  clearAll,
  scan,
  checkUpdates,
  refreshArtistNames,
  downloadUpdated,
  openSelected,
  copyUrls,
  removeSelectedArtists,
  addArtist,
  editArtistId,
  editSavePath,
  openArtist,
  openPath
}: {
  language: Language;
  artists: Artist[];
  selected: Set<string>;
  filter: string;
  busy: boolean;
  setFilter: (value: string) => void;
  toggleArtist: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearAll: () => void;
  scan: () => void;
  checkUpdates: () => void;
  refreshArtistNames: () => void;
  downloadUpdated: () => void;
  openSelected: () => void;
  copyUrls: () => void;
  removeSelectedArtists: () => void;
  addArtist: () => void;
  editArtistId: (id: string) => void;
  editSavePath: (id: string) => void;
  openArtist: (id: string) => void;
  openPath: (path: string) => void;
}) {
  const [menu, setMenu] = useState<ArtistMenuState | null>(null);
  const { visibleArtists, sortKey, sortDirection, changeSort } = useArtistSort(artists, filter);

  const openMenu = (event: ReactMouseEvent, artistId: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, artistId });
  };

  return (
    <section className="panel">
      <ArtistsToolbar
        language={language}
        filter={filter}
        setFilter={setFilter}
        busy={busy}
        selected={selected}
        visibleArtists={visibleArtists}
        selectAll={selectAll}
        clearAll={clearAll}
        addArtist={addArtist}
        scan={scan}
        checkUpdates={checkUpdates}
        downloadUpdated={downloadUpdated}
        openSelected={openSelected}
        refreshArtistNames={refreshArtistNames}
        copyUrls={copyUrls}
        removeSelectedArtists={removeSelectedArtists}
      />
      <ArtistsTable
        language={language}
        visibleArtists={visibleArtists}
        selected={selected}
        filter={filter}
        sortKey={sortKey}
        sortDirection={sortDirection}
        changeSort={changeSort}
        toggleArtist={toggleArtist}
        openArtist={openArtist}
        openPath={openPath}
        openMenu={openMenu}
      />
      {menu ? (
        <ArtistContextMenu
          menu={menu}
          language={language}
          editArtistId={editArtistId}
          editSavePath={editSavePath}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}
