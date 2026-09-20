import { useDeferredValue, useMemo } from "react";
import type { LibraryImage, LibrarySort } from "../types";
import { sortLibraryImages } from "../utils/librarySort";

export function useLibrarySort(images: LibraryImage[], sort: LibrarySort, language: string) {
  const deferredSort = useDeferredValue(sort);
  const sortedImages = useMemo(
    () => sortLibraryImages(images, deferredSort, language),
    [images, deferredSort, language]
  );
  return { sortedImages, sortResetKey: `${deferredSort.key}:${deferredSort.direction}` };
}
