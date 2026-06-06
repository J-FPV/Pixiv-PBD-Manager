import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ArtistActionsDeps } from "./useArtistActions";

// Split a comma-separated tag string into a cleaned, de-duplicated, sorted list
// (matches the backend's normalization so the change-detection compares equal).
export function parseTags(raw: string): string[] {
  return Array.from(new Set(raw.split(",").map((tag) => tag.trim()).filter(Boolean))).sort();
}

export function setFavorite(deps: ArtistActionsDeps, artistId: string, favorite: boolean): void {
  const { settings, handleEvent, appendLog, setArtists, runTask } = deps;
  // Update local state immediately so the star reacts instantly; the cold
  // sidecar round-trip persists in the background (mirrors confirmRemoveArtists).
  setArtists((list) => list.map((artist) => (artist.id === artistId ? { ...artist, favorite } : artist)));
  void runTask("library", t(deps.language, favorite ? "favorite" : "unfavorite"), async (signal) => {
    try {
      await runGuiApi(
        "artists.set_favorite",
        { artist_id: artistId, favorite, database: settings.database },
        handleEvent,
        { signal }
      );
    } catch (error) {
      // Roll the optimistic flip back if the backend rejected it.
      setArtists((list) => list.map((artist) => (artist.id === artistId ? { ...artist, favorite: !favorite } : artist)));
      appendLog("error", error instanceof Error ? error.message : String(error));
    }
  });
}
