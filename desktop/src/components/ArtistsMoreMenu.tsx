import { useEffect, useState } from "react";
import { ChevronDown, Copy, DatabaseBackup, ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";

// The "more actions" dropdown in the artists toolbar. Owns its open/close state
// and closes on any outside pointer-down.
export function ArtistsMoreMenu({
  language,
  busy,
  selectedCount,
  artistsCount,
  openSelected,
  refreshArtistNames,
  rebuildWorkIndex,
  copyUrls
}: {
  language: Language;
  busy: boolean;
  selectedCount: number;
  artistsCount: number;
  openSelected: () => void;
  refreshArtistNames: () => void;
  rebuildWorkIndex: () => void;
  copyUrls: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".toolbarMenuWrap")) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <div className="toolbarMenuWrap">
      <button
        type="button"
        className="button toolbarMenuButton"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <MoreHorizontal size={17} />
        <span>{t(language, "moreActions")}</span>
        <ChevronDown className={`toolbarChevron${open ? " open" : ""}`} size={15} />
      </button>
      {open ? (
        <div className="toolbarDropdown alignRight">
          <button type="button" disabled={selectedCount === 0} onClick={run(openSelected)}>
            <ExternalLink size={15} />
            <span>{t(language, "openSelected")}{selectedCount ? ` (${selectedCount})` : ""}</span>
          </button>
          <button type="button" disabled={busy || selectedCount === 0} onClick={run(refreshArtistNames)}>
            <RefreshCw size={15} />
            <span>{t(language, "refreshArtistNames")}{selectedCount ? ` (${selectedCount})` : ""}</span>
          </button>
          <button type="button" disabled={busy || artistsCount === 0} onClick={run(rebuildWorkIndex)}>
            <DatabaseBackup size={15} />
            <span>{t(language, "rebuildWorkIndex")}</span>
          </button>
          <button type="button" onClick={run(copyUrls)}>
            <Copy size={15} />
            <span>{t(language, "copyUrls")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
