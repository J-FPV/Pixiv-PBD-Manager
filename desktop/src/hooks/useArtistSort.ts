import { useMemo, useState } from "react";
import type { Artist } from "../types";

export type ArtistSortKey = "id" | "name" | "works" | "new_works";
export type SortDirection = "asc" | "desc";

// Filters artists by the search keyword (id / name / save-path / folder name)
// and sorts by the active column, with a stable id tiebreak.
export function useArtistSort(artists: Artist[], filter: string) {
  const [sortKey, setSortKey] = useState<ArtistSortKey>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const changeSort = (key: ArtistSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const visibleArtists = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
      ? artists.filter((artist) => {
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
        })
      : artists;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      let result = 0;
      if (sortKey === "id") {
        result = left.id.localeCompare(right.id, undefined, { numeric: true });
      } else if (sortKey === "name") {
        result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortKey === "works") {
        result = left.works - right.works;
      } else {
        result = left.new_works - right.new_works;
      }
      if (result === 0) {
        result = left.id.localeCompare(right.id, undefined, { numeric: true });
      }
      return result * direction;
    });
  }, [artists, filter, sortDirection, sortKey]);

  return { visibleArtists, sortKey, sortDirection, changeSort };
}
