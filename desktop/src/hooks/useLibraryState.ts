import { useState } from "react";
import type { LibraryImage } from "../types";

// The library browser's slice of app state, kept separate so useAppState stays
// within its line budget. Spread into the main state bag.
export function useLibraryState() {
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryNeedsScan, setLibraryNeedsScan] = useState(false);
  const [librarySelectedPath, setLibrarySelectedPath] = useState<string | null>(null);
  return {
    libraryImages,
    setLibraryImages,
    libraryLoaded,
    setLibraryLoaded,
    libraryNeedsScan,
    setLibraryNeedsScan,
    librarySelectedPath,
    setLibrarySelectedPath
  };
}
