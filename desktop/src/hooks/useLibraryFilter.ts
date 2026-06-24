import { useCallback, useMemo } from "react";
import { t } from "../i18n";
import type { Language, LibraryFilters, LibraryImage } from "../types";
import {
  buildLibraryFilterIndex,
  filterAndComputeFacets,
  type FacetDimension
} from "../utils/libraryFacets";

const RESOLUTION_LABELS: Record<string, string> = {
  lt1: "≤ 1MP",
  "1to4": "1–4MP",
  "4to8": "4–8MP",
  ge8: "≥ 8MP",
  unknown: "?"
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

// In-memory filtering + faceting for the library grid (mirrors useArtistSort).
// `visibleImages` applies every active filter; `facets` counts each dimension
// over the set matching all *other* filters so sibling options stay visible.
export function useLibraryFilter(images: LibraryImage[], filters: LibraryFilters, language: Language) {
  const index = useMemo(() => buildLibraryFilterIndex(images), [images]);
  const artistNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const image of images) {
      if (image.artist_id && image.artist_name && !map.has(image.artist_id)) {
        map.set(image.artist_id, image.artist_name);
      }
    }
    return map;
  }, [images]);

  const labelFor = useCallback(
    (dim: FacetDimension, value: string): string => {
      switch (dim) {
        case "artists":
          return value ? artistNames.get(value) || `#${value}` : t(language, "unknownArtist");
        case "folders":
          return basename(value);
        case "formats":
          return value ? value.toUpperCase() : "?";
        case "orientations":
          return t(language, value === "portrait" || value === "landscape" || value === "square" ? value : "unknownOrientation");
        case "resolutions":
          return RESOLUTION_LABELS[value] ?? value;
        case "dates":
          return value === "unknown" ? "?" : value;
        default:
          return value;
      }
    },
    [artistNames, language]
  );

  return useMemo(() => filterAndComputeFacets(index, filters, labelFor), [filters, index, labelFor]);
}
