import type { LibraryFilters, LibrarySort } from "./types";

export interface CollectionMember {
  store_id: string; image_id: string; path: string; status: string; available: boolean;
}
export interface ImageCollection {
  id: string; name: string; kind: "smart" | "project"; filters: Partial<LibraryFilters>; sort: LibrarySort;
  members: CollectionMember[]; member_count: number; revision: string;
}
export interface CollectionList { store_id: string; collections: ImageCollection[] }
