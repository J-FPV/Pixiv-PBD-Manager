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

export function matchesKeyword(image: LibraryImage, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const pixivMatch = (image.pixiv_tags || []).some(
    (entry) => entry.tag.toLowerCase().includes(needle) || entry.translation.toLowerCase().includes(needle)
  );
  return (
    image.filename.toLowerCase().includes(needle) ||
    image.folder.toLowerCase().includes(needle) ||
    image.pid.includes(needle) ||
    image.artist_name.toLowerCase().includes(needle) ||
    image.path.toLowerCase().includes(needle) ||
    pixivMatch
  );
}

function matchesDimension(image: LibraryImage, dim: FacetDimension, selected: string[]): boolean {
  if (!selected.length) return true;
  return dimensionValues(image, dim).some((value) => selected.includes(value));
}

// `except` skips one chip dimension so a facet's own selection doesn't zero out
// its sibling options (standard faceted-search behavior). The keyword always applies.
export function matchesFilters(image: LibraryImage, filters: LibraryFilters, except?: FacetDimension): boolean {
  for (const dim of FILTER_DIMENSIONS) {
    if (dim === except) continue;
    if (!matchesDimension(image, dim, filters[dim])) return false;
  }
  return matchesKeyword(image, filters.keyword);
}

export function computeFacets(
  images: LibraryImage[],
  filters: LibraryFilters,
  labelFor: (dim: FacetDimension, value: string) => string
): LibraryFacets {
  const result = {} as LibraryFacets;
  for (const dim of FILTER_DIMENSIONS) {
    const counts = new Map<string, number>();
    for (const image of images) {
      if (!matchesFilters(image, filters, dim)) continue;
      for (const value of dimensionValues(image, dim)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    result[dim] = Array.from(counts.entries())
      .map(([value, count]) => ({ value, count, label: labelFor(dim, value) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
  return result;
}
