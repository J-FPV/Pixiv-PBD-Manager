import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import type { CollectionList, CollectionMember } from "../types.collections";
import type { LibraryImage } from "../types";

const EMPTY: CollectionMember[] = [];
export function useCollectionAvailability(id: string | undefined, images: LibraryImage[]) {
  const [result, setResult] = useState<{ id: string; members: CollectionMember[]; error: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void runGuiApi<CollectionList>("collections.list", { id, image_ids: images.map((image) => image.image_id) })
      .then((data) => { if (active) setResult({ id, members: data.collections.find((item) => item.id === id)?.members || EMPTY, error: "" }); })
      .catch((error) => { if (active) setResult({ id, members: EMPTY, error: String(error) }); });
    return () => { active = false; };
  }, [id, images]);
  // Keep the last result for this collection while a changed image list is
  // refetched; dropping it would blank the drag button on every library update.
  const current = result?.id === id ? result : null;
  return { members: current?.members || EMPTY, loading: Boolean(id && !current), error: current?.error || "" };
}
