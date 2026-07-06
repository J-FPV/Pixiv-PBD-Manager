import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ArtistActionsDeps } from "./useArtistActions";

export function addArtist(deps: ArtistActionsDeps, reloadArtists: () => Promise<void>): void {
  const { language: languageValue, settings, handleEvent, appendLog, setPrompt, runTask } = deps;
  setPrompt({
    title: t(languageValue, "addArtist"),
    fields: [
      { key: "artist_id", label: t(languageValue, "artistId"), value: "" },
      { key: "name", label: t(languageValue, "artistName"), value: "" },
      { key: "save_path", label: t(languageValue, "savePath"), value: "", browse: "folder" }
    ],
    onSubmit: (values) =>
      void runTask("library", t(languageValue, "addArtist"), async (signal) => {
        await runGuiApi(
          "artists.add",
          { artist_id: values.artist_id, name: values.name, save_path: values.save_path, database: settings.database },
          handleEvent,
          { signal }
        );
        appendLog("info", `Added artist ${values.artist_id}`);
        await reloadArtists();
      })
  });
}
