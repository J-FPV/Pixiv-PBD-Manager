import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { Artist } from "../types";
import type { ArtistActionsDeps } from "./useArtistActions";

export async function openSelected(deps: ArtistActionsDeps): Promise<void> {
  const { language: languageValue, settings, selected, handleEvent, appendLog } = deps;
  const selectedIds = Array.from(selected);
  if (!selectedIds.length) {
    appendLog("warn", t(languageValue, "noSelection"));
    return;
  }
  try {
    const result = await runGuiApi<{ opened: number }>(
      "browser.open",
      { ...settings, artist_ids: selectedIds },
      handleEvent
    );
    appendLog("info", `Opened ${result.opened} page(s)`);
  } catch (error) {
    appendLog("error", error instanceof Error ? error.message : String(error));
  }
}

async function copyArtistUrls(deps: ArtistActionsDeps, chosen: Artist[]): Promise<void> {
  const { language: languageValue, appendLog, showToast } = deps;
  const text = chosen.map((artist) => artist.pixiv_url).join("\n");
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    const message = `${t(languageValue, "copiedUrls")}: ${chosen.length}`;
    appendLog("info", message);
    showToast(message);
  } catch (error) {
    appendLog("error", error instanceof Error ? error.message : String(error));
  }
}

export async function copyUrls(deps: ArtistActionsDeps): Promise<void> {
  const { artists, selected } = deps;
  const chosen = selected.size ? artists.filter((artist) => selected.has(artist.id)) : artists;
  await copyArtistUrls(deps, chosen);
}

export async function copyArtistUrl(deps: ArtistActionsDeps, artistId: string): Promise<void> {
  const { artists, appendLog } = deps;
  const artist = artists.find((item) => item.id === artistId);
  if (!artist) {
    appendLog("warn", t(deps.language, "noSelection"));
    return;
  }
  await copyArtistUrls(deps, [artist]);
}

export async function openArtist(deps: ArtistActionsDeps, id: string): Promise<void> {
  const { settings, handleEvent, appendLog } = deps;
  const artistId = id.trim();
  if (!artistId) {
    return;
  }
  try {
    const result = await runGuiApi<{ opened: number }>(
      "browser.open",
      { ...settings, urls: [`https://www.pixiv.net/users/${encodeURIComponent(artistId)}/artworks`] },
      handleEvent
    );
    appendLog("info", `Opened ${result.opened} page(s)`);
  } catch (error) {
    appendLog("error", error instanceof Error ? error.message : String(error));
  }
}
