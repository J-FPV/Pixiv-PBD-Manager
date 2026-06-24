import type { LibraryFacets, LibraryFilters, LibraryImage } from "../types";

export const FILTER_DIMENSIONS = [
  "artists",
  "folders",
  "tags",
  "formats",
  "orientations",
  "resolutions",
  "dates"
] as const;

export type FacetDimension = (typeof FILTER_DIMENSIONS)[number];

type DimensionValueMap = Record<FacetDimension, string[]>;

export interface LibraryFilterIndexEntry {
  image: LibraryImage;
  values: DimensionValueMap;
  keywordText: string;
}

export function imageTagSet(image: LibraryImage): string[] {
  const pixiv = (image.pixiv_tags || []).map((entry) => entry.tag);
  return Array.from(new Set([...(image.tags || []), ...(image.artist_tags || []), ...pixiv]));
}

export function resolutionBucket(image: LibraryImage): string {
  const mp = (image.width * image.height) / 1_000_000;
  if (!mp) return "unknown";
  if (mp < 1) return "lt1";
  if (mp < 4) return "1to4";
  if (mp < 8) return "4to8";
  return "ge8";
}

export function dateBucket(image: LibraryImage): string {
  if (!image.mtime_ns) return "unknown";
  const date = new Date(image.mtime_ns / 1_000_000);
  return Number.isNaN(date.getTime()) ? "unknown" : String(date.getFullYear());
}

export function dimensionValues(image: LibraryImage, dim: FacetDimension): string[] {
  switch (dim) {
    case "artists":
      return [image.artist_id || ""];
    case "folders":
      return [image.folder];
    case "tags":
      return imageTagSet(image);
    case "formats":
      return [image.format];
    case "orientations":
      return [image.orientation];
    case "resolutions":
      return [resolutionBucket(image)];
    case "dates":
      return [dateBucket(image)];
  }
}

function indexImage(image: LibraryImage): LibraryFilterIndexEntry {
  const values = {} as DimensionValueMap;
  for (const dim of FILTER_DIMENSIONS) {
    values[dim] = dimensionValues(image, dim);
  }
  const pixivTags = (image.pixiv_tags || []).flatMap((entry) => [entry.tag, entry.translation]);
  return {
    image,
    values,
    keywordText: [image.filename, image.folder, image.pid, image.artist_name, image.path, ...pixivTags]
      .join("\n")
      .toLowerCase()
  };
}

export function buildLibraryFilterIndex(images: LibraryImage[]): LibraryFilterIndexEntry[] {
  return images.map(indexImage);
}

export function filterAndComputeFacets(
  index: LibraryFilterIndexEntry[],
  filters: LibraryFilters,
  labelFor: (dim: FacetDimension, value: string) => string
): { visibleImages: LibraryImage[]; facets: LibraryFacets } {
  const selected = {} as Record<FacetDimension, Set<string>>;
  const counts = {} as Record<FacetDimension, Map<string, number>>;
  for (const dim of FILTER_DIMENSIONS) {
    selected[dim] = new Set(filters[dim]);
    counts[dim] = new Map();
  }
  const keyword = filters.keyword.trim().toLowerCase();
  const visibleImages: LibraryImage[] = [];

  for (const entry of index) {
    if (keyword && !entry.keywordText.includes(keyword)) {
      continue;
    }
    const matches = {} as Record<FacetDimension, boolean>;
    let failedDimensions = 0;
    for (const dim of FILTER_DIMENSIONS) {
      const selectedValues = selected[dim];
      const matched = !selectedValues.size || entry.values[dim].some((value) => selectedValues.has(value));
      matches[dim] = matched;
      if (!matched) {
        failedDimensions += 1;
      }
    }

    if (failedDimensions === 0) {
      visibleImages.push(entry.image);
    }
    for (const dim of FILTER_DIMENSIONS) {
      if (failedDimensions > 1 || (failedDimensions === 1 && matches[dim])) {
        continue;
      }
      const dimensionCounts = counts[dim];
      for (const value of entry.values[dim]) {
        dimensionCounts.set(value, (dimensionCounts.get(value) ?? 0) + 1);
      }
    }
  }

  const facets = {} as LibraryFacets;
  for (const dim of FILTER_DIMENSIONS) {
    facets[dim] = Array.from(counts[dim].entries())
      .map(([value, count]) => ({ value, count, label: labelFor(dim, value) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
  return { visibleImages, facets };
}
