import { useEffect, useRef } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckSquare, Square, Star } from "lucide-react";
import { ARTIST_DND_MIME, ARTISTS_COL_WIDTHS_KEY } from "../constants";
import { useColumnWidths } from "../hooks/useColumnWidths";
import type { ColumnDef } from "../hooks/useColumnWidths";
import { useNow } from "../hooks/useNow";
import type { ArtistSortKey, SortDirection } from "../hooks/useArtistSort";
import { t } from "../i18n";
import type { Artist, Language } from "../types";
import { formatRelativeTime } from "../utils/format";
import { ColumnResizeHandle } from "./ColumnResizeHandle";

type ArtistColumn = "checkbox" | "favorite" | "id" | "name" | "works" | "newWorks" | "savePaths" | "lastSeen";

const ARTIST_COLUMNS: ColumnDef<ArtistColumn>[] = [
  { key: "checkbox", width: 30, resizable: false },
  { key: "favorite", width: 38, resizable: false },
  { key: "id", width: 110 },
  { key: "name", width: 160 },
  { key: "works", width: 64 },
  { key: "newWorks", width: 72 },
  { key: "savePaths", flex: true },
  { key: "lastSeen", width: 170 }
];

// Sortable star header for the favorite column.
function FavoriteHeader({
  language,
  sortKey,
  sortDirection,
  changeSort
}: {
  language: Language;
  sortKey: ArtistSortKey;
  sortDirection: SortDirection;
  changeSort: (key: ArtistSortKey) => void;
}) {
  return (
    <span className="headerCell">
      <button
        className="headerButton centerNumericHeader starHeader"
        title={t(language, "favorite")}
        onClick={() => changeSort("favorite")}
      >
        <Star size={15} />
        <span className={`sortArrow ${sortKey === "favorite" ? "active" : ""}`}>
          {sortKey === "favorite" ? (sortDirection === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </span>
  );
}

// Drag the whole current selection if the grabbed row is part of it, else just
// that row. The payload is the artist-id list a tag chip reads on drop.
function startArtistDrag(event: ReactDragEvent, artistId: string, selected: Set<string>): void {
  const ids = selected.has(artistId) ? Array.from(selected) : [artistId];
  event.dataTransfer.setData(ARTIST_DND_MIME, JSON.stringify(ids));
  event.dataTransfer.effectAllowed = "copy";
}

// Per-row star toggle; stops propagation so it never toggles row selection.
function FavoriteCell({
  artist,
  language,
  setFavorite
}: {
  artist: Artist;
  language: Language;
  setFavorite: (id: string, favorite: boolean) => void;
}) {
  return (
    <span className="favoriteCell">
      <button
        type="button"
        className={`starButton ${artist.favorite ? "active" : ""}`}
        title={t(language, artist.favorite ? "unfavorite" : "favorite")}
        onClick={(event) => {
          event.stopPropagation();
          setFavorite(artist.id, !artist.favorite);
        }}
      >
        <Star size={16} fill={artist.favorite ? "currentColor" : "none"} />
      </button>
    </span>
  );
}

type ArtistsTableProps = {
  language: Language;
  visibleArtists: Artist[];
  selected: Set<string>;
  filter: string;
  sortKey: ArtistSortKey;
  sortDirection: SortDirection;
  changeSort: (key: ArtistSortKey) => void;
  toggleArtist: (id: string) => void;
  openArtist: (id: string) => void;
  openPath: (path: string) => void;
  openMenu: (event: ReactMouseEvent, artistId: string) => void;
  setFavorite: (id: string, favorite: boolean) => void;
};

export function ArtistsTable({
  language,
  visibleArtists,
  selected,
  filter,
  sortKey,
  sortDirection,
  changeSort,
  toggleArtist,
  openArtist,
  openPath,
  openMenu,
  setFavorite
}: ArtistsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { gridTemplate, leftHandle, rightHandle, overlay } = useColumnWidths<ArtistColumn>(
    ARTISTS_COL_WIDTHS_KEY,
    ARTIST_COLUMNS
  );
  const virtualizer = useVirtualizer({
    count: visibleArtists.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 14
  });
  // Re-render every 30s so the relative "last check" times stay current while idle.
  const now = useNow(30_000);

  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [filter, sortDirection, sortKey]);

  const sortHeader = (key: ArtistSortKey, columnKey: ArtistColumn, label: string, align: "left" | "center" = "left") => (
    <span className="headerCell">
      <ColumnResizeHandle handle={leftHandle(columnKey)} side="left" />
      <button className={`headerButton ${align === "center" ? "centerNumericHeader" : ""}`} onClick={() => changeSort(key)}>
        <span>{label}</span>
        <span className={`sortArrow ${sortKey === key ? "active" : ""}`}>
          {sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
      <ColumnResizeHandle handle={rightHandle(columnKey)} side="right" />
    </span>
  );
  const plainHeader = (columnKey: ArtistColumn, label: string) => (
    <span className="headerCell">
      <ColumnResizeHandle handle={leftHandle(columnKey)} side="left" />
      <span>{label}</span>
      <ColumnResizeHandle handle={rightHandle(columnKey)} side="right" />
    </span>
  );

  return (
    <div className="table artistsTable" style={{ ["--cols" as string]: gridTemplate }}>
      <div className="tableHeader">
        <span />
        <FavoriteHeader language={language} sortKey={sortKey} sortDirection={sortDirection} changeSort={changeSort} />
        {sortHeader("id", "id", t(language, "artistId"))}
        {sortHeader("name", "name", t(language, "artistName"))}
        {sortHeader("works", "works", t(language, "works"), "center")}
        {sortHeader("new_works", "newWorks", t(language, "newWorks"), "center")}
        {plainHeader("savePaths", t(language, "savePaths"))}
        {sortHeader("lastSeen", "lastSeen", t(language, "lastSeen"), "center")}
      </div>
      <div className="virtualList" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const artist = visibleArtists[row.index];
            const checked = selected.has(artist.id);
            return (
              <button
                className={`tableRow artistRow ${checked ? "checked" : ""}`}
                key={artist.id}
                style={{ transform: `translateY(${row.start}px)` }}
                draggable
                onDragStart={(event) => startArtistDrag(event, artist.id, selected)}
                onClick={() => toggleArtist(artist.id)}
                onDoubleClick={() => openArtist(artist.id)}
                onContextMenu={(event) => openMenu(event, artist.id)}
              >
                <span className="checkbox">{checked ? <CheckSquare size={17} /> : <Square size={17} />}</span>
                <FavoriteCell artist={artist} language={language} setFavorite={setFavorite} />
                <span>{artist.id}</span>
                <span>{artist.name}</span>
                <span className="centerNumeric">{artist.works}</span>
                <span className="centerNumeric strong">{artist.new_works}</span>
                <span
                  className={`pathText pathCell ${artist.save_paths.length ? "clickablePath" : ""}`}
                  title={artist.save_paths[0] || ""}
                  onDoubleClick={(event) => {
                    if (artist.save_paths[0]) {
                      event.stopPropagation();
                      openPath(artist.save_paths[0]);
                    }
                  }}
                >
                  {artist.save_paths.join("; ")}
                </span>
                {/* The "lastSeen" column id is historical; it now shows the last update-check time. */}
                <span className="centerNumeric" title={artist.last_checked ?? ""}>
                  {formatRelativeTime(language, artist.last_checked, now)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {overlay}
    </div>
  );
}
