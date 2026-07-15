import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryImage } from "../types";

export function useLibrarySelection(images: LibraryImage[], visibleImages: LibraryImage[]) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const selectedImages = useMemo(() => images.filter((image) => selectedPaths.has(image.path)), [images, selectedPaths]);
  const allVisibleSelected = visibleImages.length > 0 && visibleImages.every((image) => selectedPaths.has(image.path));

  useEffect(() => {
    const available = new Set(images.map((image) => image.path));
    setSelectedPaths((current) => {
      const next = new Set([...current].filter((path) => available.has(path)));
      return next.size === current.size ? current : next;
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
