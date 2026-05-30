import { useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";

export interface ArtistMenuState {
  x: number;
  y: number;
  artistId: string;
}

// Right-click context menu for a single artist row: an "编辑" group that
// expands in place to the original Edit-ID / Edit-save-path actions, plus a
// red "删除". Clicking 编辑 only toggles the group; leaf items run and close.
export function ArtistContextMenu({
  menu,
  language,
  editArtistId,
  editSavePath,
  removeArtist,
  onClose
}: {
  menu: ArtistMenuState;
  language: Language;
  editArtistId: (id: string) => void;
  editSavePath: (id: string) => void;
  removeArtist: (id: string) => void;
  onClose: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const run = (action: (id: string) => void) => () => {
    action(menu.artistId);
    onClose();
  };

  return (
    <div className="menuOverlay" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={() => setEditOpen((value) => !value)}>
          <Pencil size={15} />
          <span>{t(language, "edit")}</span>
          <span className="menuChevron">{editOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
        {editOpen ? (
          <div className="submenuGroup">
            <button onClick={run(editArtistId)}>
              <Pencil size={15} />
              <span>{t(language, "editArtistId")}</span>
            </button>
            <button onClick={run(editSavePath)}>
              <FolderOpen size={15} />
              <span>{t(language, "editSavePath")}</span>
            </button>
          </div>
        ) : null}
        <button className="menuDanger" onClick={run(removeArtist)}>
          <Trash2 size={15} />
          <span>{t(language, "removeSelectedArtists")}</span>
        </button>
      </div>
    </div>
  );
}
