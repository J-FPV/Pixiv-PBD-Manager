import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryImage } from "../types";

export function useLibrarySelection(images: LibraryImage[], visibleImages: LibraryImage[]) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const previousImages = useRef(images);
  const selectedImages = useMemo(() => images.filter((image) => selectedPaths.has(image.path)), [images, selectedPaths]);
  const allVisibleSelected = visibleImages.length > 0 && visibleImages.every((image) => selectedPaths.has(image.path));

  useEffect(() => {
    const available = new Set(images.map((image) => image.path));
    const byId = new Map(images.filter((image) => image.image_id).map((image) => [image.image_id, image.path]));
    const previousIds = new Map(previousImages.current.map((image) => [image.path, image.image_id]));
    previousImages.current = images;
    setSelectedPaths((current) => {
      const next = new Set([...current].map((path) => byId.get(previousIds.get(path) || "") || path).filter((path) => available.has(path)));
      return next.size === current.size && [...next].every((path) => current.has(path)) ? current : next;
    });
  }, [images]);

  const togglePath = useCallback((path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleVisible = useCallback(() => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const image of visibleImages) {
        if (allVisibleSelected) next.delete(image.path);
        else next.add(image.path);
      }
      return next;
    });
  }, [allVisibleSelected, visibleImages]);

  return {
    selectedPaths,
    selectedImages,
    allVisibleSelected,
    batchOpen,
    setBatchOpen,
    clear: () => setSelectedPaths(new Set()),
    togglePath,
    toggleVisible
  };
}
