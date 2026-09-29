import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runGuiApi } from "../api";
import { EMPTY_LIBRARY_FILTERS } from "../constants";
import type { CollectionList, ImageCollection } from "../types.collections";
import type { LibraryFilters, LibraryImage, LibrarySort } from "../types";

export function useCollections(images: LibraryImage[], setFilters: (filters: LibraryFilters) => void, setSort: (sort: LibrarySort) => void) {
  const [data, setData] = useState<CollectionList>({ collections: [], store_id: "" });
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);
  const currentId = useRef("");
  const sequence = useRef(0);
  const load = useCallback(async (id = currentId.current) => {
    const request = ++sequence.current;
    const result = await runGuiApi<CollectionList>("collections.list", { id });
    if (request === sequence.current) setData(result);
    return result;
  }, []);
  useEffect(() => {
    void load().catch((err) => setError(String(err)));
    const saved = (event: Event) => {
      if ((event as CustomEvent).detail?.command === "history.undo" || event.type === "pbd-library-sync") void load().catch((err) => setError(String(err)));
    };
    window.addEventListener("pbd-api-result", saved); window.addEventListener("pbd-library-sync", saved);
    return () => { window.removeEventListener("pbd-api-result", saved); window.removeEventListener("pbd-library-sync", saved); };
  }, [load]);
  const chosen = data.collections.find((item) => item.id === selectedId) || null;
  const members = useMemo(() => new Set(chosen?.members.filter((member) => member.store_id === data.store_id).map((member) => member.image_id)), [chosen, data.store_id]);
  const collectionImages = useMemo(() => chosen?.kind === "project" ? images.filter((image) => members.has(image.image_id)) : images, [chosen?.kind, images, members]);
  const select = async (id: string) => {
    setError(""); setBusy(true);
    try {
      currentId.current = id;
      const result = await load(id);
      if (currentId.current !== id) return;
      setSelectedId(id);
      const collection = result.collections.find((item) => item.id === id);
      if (collection?.kind === "smart") { setFilters({ ...EMPTY_LIBRARY_FILTERS, ...collection.filters }); setSort(collection.sort); }
    } catch (err) { setError(String(err)); } finally { setBusy(false); }
  };
  const run = async (command: string, payload: object) => {
    if (controller.current) return null;
    setError(""); setBusy(true); setProgress("");
    controller.current = new AbortController();
    try {
      const result = await runGuiApi<{ id?: string; cancelled?: boolean }>(command, payload, (event) => {
        if (event.type === "progress") {
          const p = event.payload as { current?: number; total?: number };
          if (p.current !== undefined) setProgress(`${p.current} / ${p.total ?? ""}`);
        }
      }, { signal: controller.current.signal, gracefulCancel: true });
      await load();
      return result.cancelled ? null : result;
    } catch (err) { setError(String(err)); void load().catch(() => undefined); return null; }
    finally { setBusy(false); setProgress(""); controller.current = null; }
  };
  const create = async (kind: ImageCollection["kind"], name: string, filters: LibraryFilters, sort: LibrarySort) => {
    const result = await run("collections.create", { kind, name, filters: kind === "smart" ? filters : {}, sort });
    if (result?.id) await select(result.id);
    return Boolean(result);
  };
  return { data, chosen, selectedId, collectionImages, busy, error, progress, cancel: () => controller.current?.abort(), select, create, run,
    update: (filters: LibraryFilters, sort: LibrarySort) => chosen && run("collections.update", { id: chosen.id, revision: chosen.revision, filters, sort }),
    add: (id: string, targets: LibraryImage[]) => run("collections.members.add", { id, store_id: data.store_id, image_ids: targets.map((image) => image.image_id) }),
    remove: (targets: LibraryImage[]) => chosen && run("collections.members.remove", { id: chosen.id, members: targets.map((image) => ({ store_id: data.store_id, image_id: image.image_id })) }) };
}
export type CollectionsController = ReturnType<typeof useCollections>;
