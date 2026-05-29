import { FolderOpen, Pencil } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";

export interface ArtistMenuState {
  x: number;
  y: number;
  artistId: string;
}

// Right-click context menu for a single artist row.
export function ArtistContextMenu({
  menu,
  language,
  editArtistId,
  editSavePath,
  onClose
}: {
  menu: ArtistMenuState;
  language: Language;
  editArtistId: (id: string) => void;
  editSavePath: (id: string) => void;
  onClose: () => void;
}) {
  const run = (action: (id: string) => void) => () => {
    action(menu.artistId);
    onClose();
  };

  return (
    <div className="menuOverlay" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={run(editArtistId)}>
          <Pencil size={15} />
          <span>{t(language, "editArtistId")}</span>
        </button>
        <button onClick={run(editSavePath)}>
          <FolderOpen size={15} />
          <span>{t(language, "editSavePath")}</span>
        </button>
      </div>
    </div>
  );
}
