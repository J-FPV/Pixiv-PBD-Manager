import { useEffect, useMemo, useState } from "react";
import type { Artist } from "../types";
import { lastSeenTimestamp } from "../utils/format";

export type ArtistSortKey = "id" | "name" | "works" | "new_works" | "lastSeen" | "favorite";
export type SortDirection = "asc" | "desc";

function matchesKeyword(artist: Artist, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  const savePathText = artist.save_paths.join(" ").toLowerCase();
  const folderNames = artist.save_paths
    .map((path) => path.split(/[\\/]/).filter(Boolean).pop() || "")
    .join(" ")
    .toLowerCase();
  return (
    artist.id.includes(keyword) ||
    artist.name.toLowerCase().includes(keyword) ||
    savePathText.includes(keyword) ||
    folderNames.includes(keyword)
  );
}

function compareArtists(left: Artist, right: Artist, sortKey: ArtistSortKey): number {
  if (sortKey === "id") {
    return left.id.localeCompare(right.id, undefined, { numeric: true });
  }
  if (sortKey === "name") {
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  }
  if (sortKey === "works") {
    return left.works - right.works;
  }
  if (sortKey === "new_works") {
    return left.new_works - right.new_works;
  }
  if (sortKey === "favorite") {
    return (left.favorite ? 1 : 0) - (right.favorite ? 1 : 0);
  }
  // The "lastSeen" sort id is historical; it now orders by last update-check time.
  return lastSeenTimestamp(left.last_checked) - lastSeenTimestamp(right.last_checked);
}

// Filters artists by the search keyword (id / name / save-path / folder name),
// the favorites-only toggle, and the set of active tag chips (OR semantics),
// then sorts by the active column with a stable id tiebreak. Owns the favorite
// and tag-filter state; ``artistTags`` (the backend's global tag list) is used
// only to drop a stale selected tag after it is renamed or deleted.
export function useArtistSort(artists: Artist[], filter: string, artistTags: string[]) {
  const [sortKey, setSortKey] = useState<ArtistSortKey>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const changeSort = (key: ArtistSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const toggleTag = (name: string) => {
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Number of artists carrying each tag, for the count badge on each chip.
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const artist of artists) {
      for (const tag of artist.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  }, [artists]);

  // Drop any selected tag that no longer exists (renamed/deleted elsewhere).
  useEffect(() => {
    setSelectedTags((current) => {
      const live = new Set(artistTags);
      const next = new Set([...current].filter((tag) => live.has(tag)));
      return next.size === current.size ? current : next;
    });
  }, [artistTags]);

  const visibleArtists = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = artists.filter((artist) => {
      if (favoriteOnly && !artist.favorite) {
        return false;
      }
      if (selectedTags.size && !artist.tags.some((tag) => selectedTags.has(tag))) {
        return false;
      }
      return matchesKeyword(artist, keyword);
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const result = compareArtists(left, right, sortKey) || left.id.localeCompare(right.id, undefined, { numeric: true });
      return result * direction;
    });
  }, [artists, filter, favoriteOnly, selectedTags, sortDirection, sortKey]);

  return {
    visibleArtists,
    favoriteOnly,
    setFavoriteOnly,
    selectedTags,
    toggleTag,
    tagCounts,
    sortKey,
    sortDirection,
    changeSort
  };
}
