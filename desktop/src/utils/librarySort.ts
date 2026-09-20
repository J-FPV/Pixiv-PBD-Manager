import type { LibraryImage, LibrarySort, LibrarySortKey } from "../types";

export const LIBRARY_SORT_KEYS: LibrarySortKey[] = ["created", "modified", "filename", "size", "pixels", "rating"];
export const DEFAULT_LIBRARY_SORT: LibrarySort = { key: "modified", direction: "desc" };

export function normalizeLibrarySort(value: unknown): LibrarySort {
  if (!value || typeof value !== "object") return DEFAULT_LIBRARY_SORT;
  const candidate = value as Partial<LibrarySort>;
  return LIBRARY_SORT_KEYS.includes(candidate.key as LibrarySortKey) &&
    (candidate.direction === "asc" || candidate.direction === "desc")
    ? { key: candidate.key as LibrarySortKey, direction: candidate.direction }
    : DEFAULT_LIBRARY_SORT;
}

function numericValue(image: LibraryImage, key: LibrarySortKey): number | null {
  switch (key) {
    case "created": return image.created_ns ?? null;
    case "modified": return image.mtime_ns || null;
    case "size": return image.size_bytes;
    case "pixels": return image.width > 0 && image.height > 0 ? image.width * image.height : null;
    case "rating": return image.rating || 0;
    default: return null;
  }
}

export function sortLibraryImages(images: LibraryImage[], sort: LibrarySort, locale: string): LibraryImage[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...images].sort((left, right) => {
    let primary = 0;
    if (sort.key !== "filename") {
      const a = numericValue(left, sort.key);
      const b = numericValue(right, sort.key);
      const missingA = a === null || !Number.isFinite(a);
      const missingB = b === null || !Number.isFinite(b);
      // Missing metadata stays last in both directions.
      if (missingA !== missingB) return missingA ? 1 : -1;
      primary = missingA || missingB ? 0 : a! - b!;
    }
    if (primary) return primary * direction;
    const name = collator.compare(left.filename, right.filename);
    return name * (sort.key === "filename" ? direction : 1) ||
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  });
}
