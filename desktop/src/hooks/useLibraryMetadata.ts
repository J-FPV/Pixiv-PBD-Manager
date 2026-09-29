import { useRef } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { LibraryImage, LibraryMetadataPatch, LibraryMetadataResult } from "../types";
import type { AppState } from "./useAppState";
import type { SyncDelta } from "../types.sync";

export function applyLibraryMetadataPatch(image: LibraryImage, patch: LibraryMetadataPatch): LibraryImage {
  const markers = new Set(patch.markers ?? image.markers);
  if (patch.markers === undefined) {
    for (const marker of patch.add_markers ?? []) markers.add(marker);
    for (const marker of patch.remove_markers ?? []) markers.delete(marker);
  }
  const tags = new Set(patch.tags ?? image.tags);
  for (const tag of patch.add_tags ?? []) tags.add(tag.trim());
  for (const tag of patch.remove_tags ?? []) tags.delete(tag.trim());
  if (patch.copy_pixiv_tags) for (const tag of image.pixiv_tags) tags.add(tag.tag);
  return { ...image, favorite: patch.favorite ?? image.favorite,
    rating: patch.rating === undefined ? image.rating : Math.max(0, Math.min(5, Math.trunc(patch.rating))),
    markers: [...markers].sort(), tags: [...tags].filter(Boolean).sort() };
}

type PendingEdit = { ids: Set<string>; patch: LibraryMetadataPatch };

function annotations(image: LibraryImage): LibraryMetadataPatch {
  return { favorite: image.favorite, rating: image.rating, markers: image.markers, tags: image.tags };
}

export function mergeAnnotationResponse(current: LibraryImage, incoming: LibraryImage): LibraryImage {
  if (!incoming.image_id || current.image_id !== incoming.image_id) return incoming;
  return current.annotation_revision > incoming.annotation_revision
    ? { ...incoming, ...annotations(current), annotation_revision: current.annotation_revision }
    : incoming;
}

export function useLibraryMetadata(s: AppState, reload: () => Promise<void>) {
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(new Map<number, PendingEdit>());
  const sequence = useRef(0);
  const reapply = (image: LibraryImage) => {
    for (const edit of pending.current.values()) {
      if (edit.ids.has(image.image_id)) image = applyLibraryMetadataPatch(image, edit.patch);
    }
    return image;
  };
  const mergeSnapshot = (images: LibraryImage[]) => s.setLibraryImages((current) => {
    const byId = new Map(current.map((image) => [image.image_id, image]));
    return images.map((image) => reapply(byId.has(image.image_id)
      ? mergeAnnotationResponse(byId.get(image.image_id)!, image) : image));
  });
  const update = async (paths: string[], patch: LibraryMetadataPatch) => {
    const targets = new Set(paths);
    const identities = Object.fromEntries(s.libraryImages.filter((image) => targets.has(image.path))
      .map((image) => [image.path, image.image_id]));
    if (Object.keys(identities).length !== targets.size || Object.values(identities).some((value) => !value)) {
      const message = t(s.language, "annotationRefreshRequired");
      s.showToast(message);
      throw new Error(message);
    }
    const id = ++sequence.current;
    pending.current.set(id, { ids: new Set(Object.values(identities)), patch });
    s.setLibraryImages((current) => current.map((image) =>
      identities[image.path] === image.image_id ? applyLibraryMetadataPatch(image, patch) : image));
    const request = queue.current.then(() => runGuiApi<LibraryMetadataResult>(
      "library.update_metadata", { paths, identities, ...patch }, s.handleEvent));
    queue.current = request.then(() => undefined, () => undefined);
    try {
      const result = await request;
      pending.current.delete(id);
      const updated = new Map(result.images.map((image) => [image.image_id, image]));
      s.setLibraryImages((current) => current.map((image) => {
        const saved = updated.get(image.image_id);
        return saved ? reapply(mergeAnnotationResponse(image, { ...image, ...annotations(saved),
          annotation_revision: saved.annotation_revision })) : image;
      }));
      if (result.annotation_status) s.setAnnotationStatus(result.annotation_status);
      s.showToast(t(s.language, "libraryUpdated").replace("{count}", String(result.updated)));
      return result.updated;
    } catch (reason) {
      pending.current.delete(id);
      s.appendLog("error", reason instanceof Error ? reason.message : String(reason));
      await reload();
      throw reason;
    }
  };
  const mergeDelta = (delta: SyncDelta) => s.setLibraryImages((current) => {
    const removed = new Set(delta.removed), incoming = new Map(delta.upserts.map((image) => [image.path, image]));
    const byId = new Map(current.map((image) => [image.image_id, image]));
    const next = current.filter((image) => !removed.has(image.path)).map((image) => {
      const value = incoming.get(image.path);
      if (!value) return image;
      incoming.delete(image.path);
      return reapply(mergeAnnotationResponse(image, value));
    });
    for (const image of incoming.values()) next.push(reapply(byId.has(image.image_id) ? mergeAnnotationResponse(byId.get(image.image_id)!, image) : image));
    return next;
  });
  return { update, mergeSnapshot, mergeDelta };
}
