import type { LibraryImage, LibrarySort, LibrarySortKey } from "../types";

export const LIBRARY_SORT_KEYS: LibrarySortKey[] = ["pid", "created", "modified", "filename", "size", "pixels", "rating"];
export const DEFAULT_LIBRARY_SORT: LibrarySort = { key: "pid", direction: "desc" };
// Bumped when the default changes; a saved sort equal to the old default was
// never chosen deliberately, so it follows the new one.
export const LIBRARY_SORT_REVISION = 2;
const PREVIOUS_DEFAULT: LibrarySort = { key: "modified", direction: "desc" };

export function normalizeLibrarySort(value: unknown): LibrarySort {
  if (!value || typeof value !== "object") return DEFAULT_LIBRARY_SORT;
  const candidate = value as Partial<LibrarySort>;
  return LIBRARY_SORT_KEYS.includes(candidate.key as LibrarySortKey) &&
    (candidate.direction === "asc" || candidate.direction === "desc")
    ? { key: candidate.key as LibrarySortKey, direction: candidate.direction }
    : DEFAULT_LIBRARY_SORT;
}

export function migrateLibrarySort(value: unknown, revision: unknown): LibrarySort {
  const sort = normalizeLibrarySort(value);
  return revision !== LIBRARY_SORT_REVISION &&
    sort.key === PREVIOUS_DEFAULT.key && sort.direction === PREVIOUS_DEFAULT.direction
    ? DEFAULT_LIBRARY_SORT
    : sort;
}

function artworkId(image: LibraryImage): number | null {
  return /^\d+$/.test(image.pid) ? Number(image.pid) : null;
}

// When the file arrived on disk: Windows sets creation time on download or copy,
// while a copy keeps the original modification time.
function downloadedAt(image: LibraryImage): number | null {
  return image.created_ns ?? (image.mtime_ns || null);
}

function numericValue(image: LibraryImage, key: LibrarySortKey): number | null {
  switch (key) {
    case "pid": return artworkId(image);
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
      if (sort.key === "pid") {
        // Pages of one work keep reading order; works without a PID follow,
        // ordered by when they were downloaded.
        if (!missingA) {
          const order = primary * direction || (left.page ?? 0) - (right.page ?? 0);
          if (order) return order;
        } else {
          const timeA = downloadedAt(left);
          const timeB = downloadedAt(right);
          if ((timeA === null) !== (timeB === null)) return timeA === null ? 1 : -1;
          primary = timeA === null || timeB === null ? 0 : timeA - timeB;
        }
      }
    }
    if (primary) return primary * direction;
    const name = collator.compare(left.filename, right.filename);
    return name * (sort.key === "filename" ? direction : 1) ||
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  });
}
