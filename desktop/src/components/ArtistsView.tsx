import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  XCircle
} from "lucide-react";
import { ARTISTS_COL_WIDTHS_KEY } from "../constants";
import { useColumnWidths } from "../hooks/useColumnWidths";
import type { ColumnDef } from "../hooks/useColumnWidths";
import { t } from "../i18n";
import type { Artist, Language } from "../types";
import { Button } from "./Button";
import { ColumnResizeHandle } from "./ColumnResizeHandle";

type ArtistColumn = "checkbox" | "id" | "name" | "works" | "newWorks" | "savePaths" | "lastSeen";

const ARTIST_COLUMNS: ColumnDef<ArtistColumn>[] = [
  { key: "checkbox", width: 30, resizable: false },
  { key: "id", width: 110 },
  { key: "name", width: 160 },
  { key: "works", width: 64 },
  { key: "newWorks", width: 72 },
  { key: "savePaths", flex: true },
  { key: "lastSeen", width: 170 },
];

type ArtistSortKey = "id" | "name" | "works" | "new_works";
type SortDirection = "asc" | "desc";

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
  const [menu, setMenu] = useState<{ x: number; y: number; artistId: string } | null>(null);
  const [toolbarMenu, setToolbarMenu] = useState<"select" | "more" | null>(null);
  const [sortKey, setSortKey] = useState<ArtistSortKey>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const { gridTemplate, leftHandle, rightHandle, overlay } = useColumnWidths<ArtistColumn>(
    ARTISTS_COL_WIDTHS_KEY,
    ARTIST_COLUMNS,
  );
  const tableStyle: CSSProperties = { ["--cols" as string]: gridTemplate };

  const openMenu = (event: ReactMouseEvent, artistId: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, artistId });
  };
  const changeSort = (key: ArtistSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };
  const sortHeader = (
    key: ArtistSortKey,
    columnKey: ArtistColumn,
    label: string,
    align: "left" | "right" | "center" = "left",
  ) => {
    const alignClass =
      align === "right" ? "numericHeader" : align === "center" ? "centerNumericHeader" : "";
    return (
      <span className="headerCell">
        <ColumnResizeHandle handle={leftHandle(columnKey)} side="left" />
        <button className={`headerButton ${alignClass}`} onClick={() => changeSort(key)}>
          <span>{label}</span>
          <span className={`sortArrow ${sortKey === key ? "active" : ""}`}>
            {sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : ""}
          </span>
        </button>
        <ColumnResizeHandle handle={rightHandle(columnKey)} side="right" />
      </span>
    );
  };
  const plainHeader = (columnKey: ArtistColumn, label: string) => (
    <span className="headerCell">
      <ColumnResizeHandle handle={leftHandle(columnKey)} side="left" />
      <span>{label}</span>
      <ColumnResizeHandle handle={rightHandle(columnKey)} side="right" />
    </span>
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const visibleArtists = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
      ? artists.filter((artist) => {
          const savePathText = artist.save_paths.join(" ").toLowerCase();
          const folderNames = artist.save_paths
            .map((path) => path.split(/[\\/]/).filter(Boolean).pop() || "")
            .join(" ")
            .toLowerCase();
          return (
            artist.id.includes(keyword) ||
            artist.name.toLowerCase().includes(keyword) ||
            savePathText.includes(keyword) ||
            folderNames.includes(keyword)
          );
        })
      : artists;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      let result = 0;
      if (sortKey === "id") {
        result = left.id.localeCompare(right.id, undefined, { numeric: true });
      } else if (sortKey === "name") {
        result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortKey === "works") {
        result = left.works - right.works;
      } else {
        result = left.new_works - right.new_works;
      }
      if (result === 0) {
        result = left.id.localeCompare(right.id, undefined, { numeric: true });
      }
      return result * direction;
    });
  }, [artists, filter, sortDirection, sortKey]);

  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [filter, sortDirection, sortKey]);

  useEffect(() => {
    const closeToolbarMenu = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".toolbarMenuWrap")) {
        setToolbarMenu(null);
      }
    };
    document.addEventListener("pointerdown", closeToolbarMenu);
    return () => document.removeEventListener("pointerdown", closeToolbarMenu);
  }, []);

  const virtualizer = useVirtualizer({
    count: visibleArtists.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 14
  });

  return (
    <section className="panel">
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
        <div className="toolbarMenuWrap">
          <button
            type="button"
            className="button toolbarMenuButton"
            onClick={() => setToolbarMenu((current) => (current === "select" ? null : "select"))}
            aria-expanded={toolbarMenu === "select"}
          >
            <CheckSquare size={16} />
            <span>{t(language, "selection")}{selected.size ? ` (${selected.size})` : ""}</span>
            <ChevronDown className={`toolbarChevron${toolbarMenu === "select" ? " open" : ""}`} size={15} />
          </button>
          {toolbarMenu === "select" ? (
            <div className="toolbarDropdown">
              <button
                type="button"
                onClick={() => {
                  selectAll(visibleArtists.map((artist) => artist.id));
                  setToolbarMenu(null);
                }}
              >
                <CheckSquare size={15} />
                <span>{t(language, "selectAll")}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  clearAll();
                  setToolbarMenu(null);
                }}
              >
                <Square size={15} />
                <span>{t(language, "clearAll")}{selected.size ? ` (${selected.size})` : ""}</span>
              </button>
            </div>
          ) : null}
        </div>
        <Button icon={<Play size={16} />} disabled={busy} onClick={scan} variant="primary">
          {t(language, "scan")}
        </Button>
        <Button icon={<RefreshCw size={16} />} disabled={busy} onClick={checkUpdates}>
          {t(language, "checkUpdatesShort")}
        </Button>
        <Button icon={<Download size={16} />} disabled={busy} onClick={downloadUpdated}>
          {t(language, "downloadUpdatedShort")}
        </Button>
        {selected.size ? (
          <Button
            icon={<ExternalLink size={16} />}
            onClick={openSelected}
            title={`${t(language, "openSelected")} (${selected.size})`}
            iconOnly
          >
            {t(language, "openSelected")}
          </Button>
        ) : null}
        <span className="toolbarSpacer" />
        <div className="toolbarMenuWrap">
          <button
            type="button"
            className="button toolbarMenuButton"
            onClick={() => setToolbarMenu((current) => (current === "more" ? null : "more"))}
            aria-expanded={toolbarMenu === "more"}
          >
            <MoreHorizontal size={17} />
            <span>{t(language, "moreActions")}</span>
            <ChevronDown className={`toolbarChevron${toolbarMenu === "more" ? " open" : ""}`} size={15} />
          </button>
          {toolbarMenu === "more" ? (
            <div className="toolbarDropdown alignRight">
              <button
                type="button"
                onClick={() => {
                  addArtist();
                  setToolbarMenu(null);
                }}
              >
                <Plus size={15} />
                <span>{t(language, "addArtist")}</span>
              </button>
              <button
                type="button"
                disabled={busy || selected.size === 0}
                onClick={() => {
                  refreshArtistNames();
                  setToolbarMenu(null);
                }}
              >
                <RefreshCw size={15} />
                <span>{t(language, "refreshArtistNames")}{selected.size ? ` (${selected.size})` : ""}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  copyUrls();
                  setToolbarMenu(null);
                }}
              >
                <Copy size={15} />
                <span>{t(language, "copyUrls")}</span>
              </button>
            </div>
          ) : null}
        </div>
        {selected.size ? (
          <Button
            icon={<Trash2 size={16} />}
            disabled={busy}
            onClick={removeSelectedArtists}
            variant="danger"
            title={`${t(language, "removeSelectedArtists")} (${selected.size})`}
            iconOnly
          >
            {t(language, "removeSelectedArtists")}
          </Button>
        ) : null}
      </div>

      <div className="table artistsTable" style={tableStyle}>
        <div className="tableHeader">
          <span />
          {sortHeader("id", "id", t(language, "artistId"))}
          {sortHeader("name", "name", t(language, "artistName"))}
          {sortHeader("works", "works", t(language, "works"), "center")}
          {sortHeader("new_works", "newWorks", t(language, "newWorks"), "center")}
          {plainHeader("savePaths", t(language, "savePaths"))}
          {plainHeader("lastSeen", t(language, "lastSeen"))}
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
                    onClick={(event) => {
                      if (!artist.save_paths[0]) {
                        return;
                      }
                      event.stopPropagation();
                      openPath(artist.save_paths[0]);
                    }}
                    onDoubleClick={(event) => {
                      if (artist.save_paths[0]) {
                        event.stopPropagation();
                      }
                    }}
                  >
                    {artist.save_paths.join("; ")}
                  </span>
                  <span>{artist.last_seen}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {menu ? (
        <div className="menuOverlay" onClick={() => setMenu(null)} onContextMenu={(event) => event.preventDefault()}>
          <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => {
                editArtistId(menu.artistId);
                setMenu(null);
              }}
            >
              <Pencil size={15} />
              <span>{t(language, "editArtistId")}</span>
            </button>
            <button
              onClick={() => {
                editSavePath(menu.artistId);
                setMenu(null);
              }}
            >
              <FolderOpen size={15} />
              <span>{t(language, "editSavePath")}</span>
            </button>
          </div>
        </div>
      ) : null}
      {overlay}
    </section>
  );
}
