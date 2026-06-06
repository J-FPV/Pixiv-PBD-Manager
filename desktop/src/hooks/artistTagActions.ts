import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { TagMutationPayload } from "../types";
import type { ArtistActionsDeps } from "./useArtistActions";

// Tags that touch many artists (assign/rename/delete) return the refreshed
// artist list + global tag list, so we replace both in one shot rather than
// paying a second artists.list round-trip.
function applyTagMutation(deps: ArtistActionsDeps, payload: TagMutationPayload): void {
  deps.setArtists(payload.artists);
  deps.setArtistTags(payload.tags);
}

export function addTag(deps: ArtistActionsDeps): void {
  const { language, settings, handleEvent, appendLog, setPrompt, setArtistTags, runTask } = deps;
  setPrompt({
    title: t(language, "addTag"),
    fields: [{ key: "name", label: t(language, "tagName"), value: "" }],
    onSubmit: (values) =>
      void runTask("library", t(language, "addTag"), async (signal) => {
        const name = values.name.trim();
        if (!name) {
          return;
        }
        const result = await runGuiApi<{ tags: string[] }>(
          "artists.add_tag",
          { name, database: settings.database },
          handleEvent,
          { signal }
        );
        setArtistTags(result.tags);
        appendLog("info", `Added tag ${name}`);
      })
  });
}

export function assignTag(deps: ArtistActionsDeps, artistIds: string[], name: string): void {
  const { language, settings, handleEvent, appendLog, runTask } = deps;
  if (!artistIds.length || !name) {
    return;
  }
  void runTask("library", t(language, "assignTag"), async (signal) => {
    const result = await runGuiApi<TagMutationPayload & { assigned: number }>(
      "artists.assign_tag",
      { artist_ids: artistIds, name, database: settings.database },
      handleEvent,
      { signal }
    );
    applyTagMutation(deps, result);
    appendLog("info", `Assigned "${name}" to ${result.assigned} artist(s)`);
  });
}

export function renameTag(deps: ArtistActionsDeps, oldName: string): void {
  const { language, settings, handleEvent, appendLog, setPrompt, runTask } = deps;
  setPrompt({
    title: t(language, "renameTag"),
    fields: [{ key: "name", label: t(language, "tagName"), value: oldName }],
    onSubmit: (values) =>
      void runTask("library", t(language, "renameTag"), async (signal) => {
        const next = values.name.trim();
        if (!next || next === oldName) {
          return;
        }
        const result = await runGuiApi<TagMutationPayload>(
          "artists.rename_tag",
          { old: oldName, new: next, database: settings.database },
          handleEvent,
          { signal }
        );
        applyTagMutation(deps, result);
        appendLog("info", `Renamed tag ${oldName} -> ${next}`);
      })
  });
}

export function deleteTag(deps: ArtistActionsDeps, name: string): void {
  const { language, settings, handleEvent, appendLog, setConfirm, runTask } = deps;
  setConfirm({
    title: t(language, "deleteTag"),
    body: `${t(language, "confirmDeleteTag")}\n\n${name}`,
    confirmLabel: t(language, "deleteTag"),
    onConfirm: () =>
      void runTask("library", t(language, "deleteTag"), async (signal) => {
        const result = await runGuiApi<TagMutationPayload>(
          "artists.delete_tag",
          { name, database: settings.database },
          handleEvent,
          { signal }
        );
        applyTagMutation(deps, result);
        appendLog("info", `Deleted tag ${name}`);
      })
  });
}
