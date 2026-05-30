import { useEffect, useRef } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckSquare, Square } from "lucide-react";
import { ARTISTS_COL_WIDTHS_KEY } from "../constants";
import { useColumnWidths } from "../hooks/useColumnWidths";
import type { ColumnDef } from "../hooks/useColumnWidths";
import type { ArtistSortKey, SortDirection } from "../hooks/useArtistSort";
import { t } from "../i18n";
import type { Artist, Language } from "../types";
import { formatRelativeTime } from "../utils/format";
import { ColumnResizeHandle } from "./ColumnResizeHandle";

type ArtistColumn = "checkbox" | "id" | "name" | "works" | "newWorks" | "savePaths" | "lastSeen";

const ARTIST_COLUMNS: ColumnDef<ArtistColumn>[] = [
  { key: "checkbox", width: 30, resizable: false },
  { key: "id", width: 110 },
  { key: "name", width: 160 },
  { key: "works", width: 64 },
  { key: "newWorks", width: 72 },
  { key: "savePaths", flex: true },
  { key: "lastSeen", width: 170 }
];

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
  openMenu
}: {
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
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { gridTemplate, leftHandle, rightHandle, overlay } = useColumnWidths<ArtistColumn>(
    ARTISTS_COL_WIDTHS_KEY,
    ARTIST_COLUMNS
  );
  const tableStyle: CSSProperties = { ["--cols" as string]: gridTemplate };
  const virtualizer = useVirtualizer({
    count: visibleArtists.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 14
  });

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
    <div className="table artistsTable" style={tableStyle}>
      <div className="tableHeader">
        <span />
        {sortHeader("id", "id", t(language, "artistId"))}
        {sortHeader("name", "name", t(language, "artistName"))}
        {sortHeader("works", "works", t(language, "works"), "center")}
        {sortHeader("new_works", "newWorks", t(language, "newWorks"), "center")}
        {plainHeader("savePaths", t(language, "savePaths"))}
        {sortHeader("lastSeen", "lastSeen", t(language, "lastSeen"))}
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
                onClick={() => toggleArtist(artist.id)}
                onDoubleClick={() => openArtist(artist.id)}
                onContextMenu={(event) => openMenu(event, artist.id)}
              >
                <span className="checkbox">{checked ? <CheckSquare size={17} /> : <Square size={17} />}</span>
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
                <span title={artist.last_seen}>{formatRelativeTime(language, artist.last_seen)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {overlay}
    </div>
  );
}
