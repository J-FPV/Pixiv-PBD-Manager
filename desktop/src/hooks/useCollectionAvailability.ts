import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import type { CollectionList, CollectionMember } from "../types.collections";
import type { LibraryImage } from "../types";

const EMPTY: CollectionMember[] = [];
export function useCollectionAvailability(id: string | undefined, images: LibraryImage[]) {
  const [result, setResult] = useState<{ id: string; images: LibraryImage[]; members: CollectionMember[]; error: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void runGuiApi<CollectionList>("collections.list", { id, image_ids: images.map((image) => image.image_id) })
      .then((data) => { if (active) setResult({ id, images, members: data.collections.find((item) => item.id === id)?.members || EMPTY, error: "" }); })
      .catch((error) => { if (active) setResult({ id, images, members: EMPTY, error: String(error) }); });
    return () => { active = false; };
  }, [id, images]);
  const current = result?.id === id && result?.images === images ? result : null;
  return { members: current?.members || EMPTY, loading: Boolean(id && !current), error: current?.error || "" };
}
