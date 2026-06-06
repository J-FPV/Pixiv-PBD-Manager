import { useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { ARTIST_DND_MIME } from "../constants";
import { t } from "../i18n";
import type { Language } from "../types";
import { tagColor } from "../utils/tagColor";

interface ChipMenuState {
  x: number;
  y: number;
  tag: string;
}

function readDraggedIds(event: ReactDragEvent): string[] {
  try {
    const raw = event.dataTransfer.getData(ARTIST_DND_MIME);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// One draggable-target tag chip: click toggles its filter, right-click opens the
// manage menu, and dropping a dragged artist selection assigns the tag.
function TagChip({
  tag,
  count,
  active,
  onToggle,
  onMenu,
  onDropArtists
}: {
  tag: string;
  count: number;
  active: boolean;
  onToggle: (tag: string) => void;
  onMenu: (event: ReactMouseEvent, tag: string) => void;
  onDropArtists: (ids: string[], tag: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const { background, color } = tagColor(tag);
  return (
    <button
      className={`tagChip ${active ? "active" : ""} ${dragOver ? "dragOver" : ""}`}
      style={{ background, color }}
      onClick={() => onToggle(tag)}
      onContextMenu={(event) => onMenu(event, tag)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        onDropArtists(readDraggedIds(event), tag);
      }}
    >
      <span className="tagChipName">{tag}</span>
      <span className="tagChipCount">{count}</span>
    </button>
  );
}

export function ArtistTagBar({
  language,
  tags,
  tagCounts,
  selectedTags,
  expanded,
  setExpanded,
  toggleTag,
  addTag,
  renameTag,
  deleteTag,
  assignTag
}: {
  language: Language;
  tags: string[];
  tagCounts: Record<string, number>;
  selectedTags: Set<string>;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  toggleTag: (name: string) => void;
  addTag: () => void;
  renameTag: (name: string) => void;
  deleteTag: (name: string) => void;
  assignTag: (artistIds: string[], name: string) => void;
}) {
  const [menu, setMenu] = useState<ChipMenuState | null>(null);

  const openMenu = (event: ReactMouseEvent, tag: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, tag });
  };

  return (
    <div className="tagBar">
      <button className="tagBarToggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Tags size={15} />
        <span>{t(language, "tags")}</span>
        <span className="tagBarCount">{tags.length}</span>
        {!expanded && selectedTags.size ? <span className="tagBarActiveDot" /> : null}
      </button>
      {expanded ? (
        <div className="tagBarChips">
          {tags.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              count={tagCounts[tag] ?? 0}
              active={selectedTags.has(tag)}
              onToggle={toggleTag}
              onMenu={openMenu}
              onDropArtists={assignTag}
            />
          ))}
          <button className="tagChipAdd" onClick={addTag} title={t(language, "addTag")}>
            <Plus size={15} />
          </button>
          {!tags.length ? <span className="tagBarEmpty">{t(language, "noTags")}</span> : null}
        </div>
      ) : null}
      {menu ? (
        <div className="menuOverlay" onClick={() => setMenu(null)} onContextMenu={(event) => event.preventDefault()}>
          <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => {
                renameTag(menu.tag);
                setMenu(null);
              }}
            >
              <Pencil size={15} />
              <span>{t(language, "renameTag")}</span>
            </button>
            <button
              className="menuDanger"
              onClick={() => {
                deleteTag(menu.tag);
                setMenu(null);
              }}
            >
              <Trash2 size={15} />
              <span>{t(language, "deleteTag")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
