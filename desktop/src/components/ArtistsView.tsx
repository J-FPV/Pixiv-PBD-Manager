import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useArtistSort } from "../hooks/useArtistSort";
import type { Artist, Language } from "../types";
import { ArtistContextMenu, type ArtistMenuState } from "./ArtistContextMenu";
import { ArtistTagBar } from "./ArtistTagBar";
import { ArtistsTable } from "./ArtistsTable";
import { ArtistsToolbar } from "./ArtistsToolbar";

type ArtistsViewProps = {
  language: Language;
  artists: Artist[];
  artistTags: string[];
  selected: Set<string>;
  filter: string;
  busy: boolean;
  setFilter: (value: string) => void;
  toggleArtist: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearAll: () => void;
  scan: () => void;
  reopenScanPreview: () => void;
  hasScanPreview: boolean;
  checkUpdates: () => void;
  checkArtistUpdates: (id: string) => void;
  refreshArtistNames: () => void;
  rebuildWorkIndex: () => void;
  downloadUpdated: () => void;
  downloadArtistUpdated: (id: string) => void;
  openSelected: () => void;
  copyUrls: () => void;
  copyArtistUrl: (id: string) => void;
  removeSelectedArtists: () => void;
  addArtist: () => void;
  editArtist: (id: string) => void;
  setFavorite: (id: string, favorite: boolean) => void;
  addTag: () => void;
  assignTag: (artistIds: string[], name: string) => void;
  renameTag: (name: string) => void;
  deleteTag: (name: string) => void;
  removeArtist: (id: string) => void;
  openArtist: (id: string) => void;
  openPath: (path: string) => void;
};

export function ArtistsView({
  language,
  artists,
  artistTags,
  selected,
  filter,
  busy,
  setFilter,
  toggleArtist,
  selectAll,
  clearAll,
  scan,
  reopenScanPreview,
  hasScanPreview,
  checkUpdates,
  checkArtistUpdates,
  refreshArtistNames,
  rebuildWorkIndex,
  downloadUpdated,
  downloadArtistUpdated,
  openSelected,
  copyUrls,
  copyArtistUrl,
  removeSelectedArtists,
  addArtist,
  editArtist,
  setFavorite,
  addTag,
  assignTag,
  renameTag,
  deleteTag,
  removeArtist,
  openArtist,
  openPath
}: ArtistsViewProps) {
  const [menu, setMenu] = useState<ArtistMenuState | null>(null);
  const [tagBarExpanded, setTagBarExpanded] = useState(true);
  const { visibleArtists, favoriteOnly, setFavoriteOnly, selectedTags, toggleTag, tagCounts, sortKey, sortDirection, changeSort } =
    useArtistSort(artists, filter, artistTags);

  const openMenu = (event: ReactMouseEvent, artistId: string) => {
    event.preventDefault();
    const favorite = artists.find((artist) => artist.id === artistId)?.favorite ?? false;
    setMenu({ x: event.clientX, y: event.clientY, artistId, favorite });
  };

  return (
    <section className="panel artistsPanel">
      <ArtistsToolbar
        language={language}
        filter={filter}
        setFilter={setFilter}
        favoriteOnly={favoriteOnly}
        setFavoriteOnly={setFavoriteOnly}
        busy={busy}
        selected={selected}
        artistsCount={artists.length}
        visibleArtists={visibleArtists}
        selectAll={selectAll}
        clearAll={clearAll}
        addArtist={addArtist}
        scan={scan}
        reopenScanPreview={reopenScanPreview}
        hasScanPreview={hasScanPreview}
        checkUpdates={checkUpdates}
        downloadUpdated={downloadUpdated}
        openSelected={openSelected}
        refreshArtistNames={refreshArtistNames}
        rebuildWorkIndex={rebuildWorkIndex}
        copyUrls={copyUrls}
        removeSelectedArtists={removeSelectedArtists}
      />
      <ArtistTagBar
        language={language}
        tags={artistTags}
        tagCounts={tagCounts}
        selectedTags={selectedTags}
        expanded={tagBarExpanded}
        setExpanded={setTagBarExpanded}
        toggleTag={toggleTag}
        addTag={addTag}
        renameTag={renameTag}
        deleteTag={deleteTag}
        assignTag={assignTag}
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
        setFavorite={setFavorite}
      />
      {menu ? (
        <ArtistContextMenu
          menu={menu}
          language={language}
          checkArtistUpdates={checkArtistUpdates}
          downloadArtistUpdated={downloadArtistUpdated}
          copyArtistUrl={copyArtistUrl}
          editArtist={editArtist}
          setFavorite={setFavorite}
          removeArtist={removeArtist}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}
