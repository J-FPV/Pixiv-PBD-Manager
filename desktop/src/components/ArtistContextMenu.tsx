import { Pencil, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";

export interface ArtistMenuState {
  x: number;
  y: number;
  artistId: string;
}

// Right-click context menu for a single artist row: "编辑" opens the combined
// edit window (artist ID + save path), and a red "删除" removes the artist.
export function ArtistContextMenu({
  menu,
  language,
  editArtist,
  removeArtist,
  onClose
}: {
  menu: ArtistMenuState;
  language: Language;
  editArtist: (id: string) => void;
  removeArtist: (id: string) => void;
  onClose: () => void;
}) {
  const run = (action: (id: string) => void) => () => {
    action(menu.artistId);
    onClose();
  };

  return (
    <div className="menuOverlay" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={run(editArtist)}>
          <Pencil size={15} />
          <span>{t(language, "edit")}</span>
        </button>
        <button className="menuDanger" onClick={run(removeArtist)}>
          <Trash2 size={15} />
          <span>{t(language, "removeSelectedArtists")}</span>
        </button>
      </div>
    </div>
  );
}
