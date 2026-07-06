import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ArtistActionsDeps } from "./useArtistActions";

// Shared confirm+remove for both the multi-select toolbar action and the
// single-artist context-menu delete. ``ids`` is whichever set to remove.
function confirmRemoveArtists(deps: ArtistActionsDeps, ids: string[], title: string): void {
  const { language: languageValue, settings, artists, handleEvent, appendLog, showToast, setArtists, setSelected, setConfirm } =
    deps;
  if (!ids.length) {
    appendLog("warn", t(languageValue, "noSelection"));
    return;
  }
  const idSet = new Set(ids);
  const names = artists
    .filter((artist) => idSet.has(artist.id))
    .slice(0, 8)
    .map((artist) => `${artist.name || artist.id} (${artist.id})`);
  const more = ids.length > names.length ? `\n... +${ids.length - names.length}` : "";
  setConfirm({
    title,
    body: `${t(languageValue, "confirmRemoveArtists")}\n\n${names.join("\n")}${more}`,
    confirmLabel: title,
    onConfirm: async () => {
      try {
        const result = await runGuiApi<{ removed: number; artist_ids: string[] }>(
          "artists.remove",
          { artist_ids: ids, database: settings.database },
          handleEvent
        );
        const removed = new Set(result.artist_ids);
        setArtists((list) => list.filter((artist) => !removed.has(artist.id)));
        setSelected((current) => new Set([...current].filter((id) => !removed.has(id))));
        const message = `${t(languageValue, "removedArtists")}: ${result.removed}`;
        appendLog("info", message);
        showToast(message);
      } catch (error) {
        appendLog("error", error instanceof Error ? error.message : String(error));
      }
    }
  });
}

export function removeSelectedArtists(deps: ArtistActionsDeps): void {
  confirmRemoveArtists(deps, Array.from(deps.selected), t(deps.language, "removeSelectedArtists"));
}

export function removeArtist(deps: ArtistActionsDeps, artistId: string): void {
  confirmRemoveArtists(deps, artistId ? [artistId] : [], t(deps.language, "removeSelectedArtists"));
}
