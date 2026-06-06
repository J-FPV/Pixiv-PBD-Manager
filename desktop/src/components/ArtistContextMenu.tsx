import { Copy, Download, Pencil, RefreshCw, Star, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";

export interface ArtistMenuState {
  x: number;
  y: number;
  artistId: string;
  favorite: boolean;
}

// Right-click context menu for a single artist row. Actions here always target
// the clicked artist, independent of the current multi-selection.
export function ArtistContextMenu({
  menu,
  language,
  checkArtistUpdates,
  downloadArtistUpdated,
  copyArtistUrl,
  editArtist,
  setFavorite,
  removeArtist,
  onClose
}: {
  menu: ArtistMenuState;
  language: Language;
  checkArtistUpdates: (id: string) => void;
  downloadArtistUpdated: (id: string) => void;
  copyArtistUrl: (id: string) => void | Promise<void>;
  editArtist: (id: string) => void;
  setFavorite: (id: string, favorite: boolean) => void;
  removeArtist: (id: string) => void;
  onClose: () => void;
}) {
  const run = (action: (id: string) => void | Promise<void>) => () => {
    void action(menu.artistId);
    onClose();
  };

  return (
    <div className="menuOverlay" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={run(editArtist)}>
          <Pencil size={15} />
          <span>{t(language, "edit")}</span>
        </button>
        <button
          onClick={() => {
            setFavorite(menu.artistId, !menu.favorite);
            onClose();
          }}
        >
          <Star size={15} fill={menu.favorite ? "currentColor" : "none"} />
          <span>{t(language, menu.favorite ? "unfavorite" : "favorite")}</span>
        </button>
        <button onClick={run(checkArtistUpdates)}>
          <RefreshCw size={15} />
          <span>{t(language, "checkUpdates")}</span>
        </button>
        <button onClick={run(downloadArtistUpdated)}>
          <Download size={15} />
          <span>{t(language, "downloadUpdated")}</span>
        </button>
        <button onClick={run(copyArtistUrl)}>
          <Copy size={15} />
          <span>{t(language, "copyUrls")}</span>
        </button>
        <button className="menuDanger" onClick={run(removeArtist)}>
          <Trash2 size={15} />
          <span>{t(language, "removeSelectedArtists")}</span>
        </button>
      </div>
    </div>
  );
}
