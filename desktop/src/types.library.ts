// Image-library catalog shapes: the per-image row, its filter/facet vocabulary,
// and the payloads of the `library.*` IPC commands. Split out of types.ts to
// keep that file under the max-lines budget; re-exported from there, so callers
// keep importing everything from "../types".

import type { SortDirection } from "./types";

export type LibrarySortKey = "created" | "modified" | "filename" | "size" | "pixels" | "rating";
export interface LibrarySort {
  key: LibrarySortKey;
  direction: SortDirection;
}

export type ImageOrientation = "portrait" | "landscape" | "square" | "unknown";

// A tag fetched from Pixiv: original text + optional English translation,
// shown together (Pixiv-style) as one chip.
export interface PixivTag {
  tag: string;
  translation: string;
}

export type LibraryMarker = "high_value" | "used" | "to_sort";

// One row of the image library catalog (joined with live artist data).
export interface LibraryImage {
  path: string;
  filename: string;
  folder: string;
  size_bytes: number;
  mtime_ns: number;
  created_ns: number | null;
  width: number;
  height: number;
  resolution: string;
  orientation: ImageOrientation;
  format: string;
  pid: string;
  page: number | null;
  artist_id: string;
  artist_name: string;
  artist_tags: string[];
  tags: string[];
  pixiv_tags: PixivTag[];
  favorite: boolean;
  rating: number;
  markers: LibraryMarker[];
  artwork_url: string;
  artist_url: string;
}

// Every filter dimension is a multi-select set (OR within a dimension, AND
// across dimensions); `keyword` is a free-text path/name search.
export interface LibraryFilters {
  keyword: string;
  artists: string[];
  folders: string[];
  tags: string[];
  favorites: string[];
  ratings: string[];
  markers: string[];
  formats: string[];
  orientations: string[];
  resolutions: string[];
  dates: string[];
}

export interface LibraryFacet {
  value: string;
  label: string;
  count: number;
}

export interface LibraryFacets {
  artists: LibraryFacet[];
  folders: LibraryFacet[];
  tags: LibraryFacet[];
  favorites: LibraryFacet[];
  ratings: LibraryFacet[];
  markers: LibraryFacet[];
  formats: LibraryFacet[];
  orientations: LibraryFacet[];
  resolutions: LibraryFacet[];
  dates: LibraryFacet[];
}

export interface LibraryListPayload {
  images: LibraryImage[];
  needs_scan: boolean;
  index_status: LibraryIndexStatus;
  db_path: string;
}

export interface LibraryIndexStatus {
  index_exists: boolean;
  metadata_path: string;
  stale: boolean;
  reasons: string[];
  updated_at: number | null;
  age_seconds: number;
  entry_count: number;
}

export interface LibraryScanSummary {
  files_seen: number;
  indexed: number;
  reused: number;
  changed: number;
  errors: number;
  error_examples: string[];
  needs_scan: boolean;
  index_status: LibraryIndexStatus;
}

export type DoctorStatus = "ok" | "warning" | "error";

export interface DoctorCheck {
  id: "database" | "save_paths" | "path_overlap" | "browser_data" | "quarantine" | "library_index";
  status: DoctorStatus;
  code: string;
  path?: string;
  paths?: string[];
  detail?: string;
  count?: number;
  age_seconds?: number;
  reasons?: string[];
}

export interface DoctorReport {
  generated_at: string;
  summary: { ok: number; warnings: number; errors: number };
  checks: DoctorCheck[];
}

export interface LibrarySetTagsPayload {
  image: LibraryImage;
}

export interface LibraryMetadataPatch {
  favorite?: boolean;
  rating?: number;
  markers?: LibraryMarker[];
  add_markers?: LibraryMarker[];
  remove_markers?: LibraryMarker[];
  add_tags?: string[];
  remove_tags?: string[];
  copy_pixiv_tags?: boolean;
}

export interface LibraryMetadataResult {
  updated: number;
  images: LibraryImage[];
}

export interface LibraryExportResult {
  output: string;
  exported: number;
}

// Counters mirror operations/tags.py::TagFetchResult. The fetch is incremental:
// `skipped` are works already in the PID-keyed sidecar cache, and `attempted`
// is what actually cost a network request.
export interface LibraryFetchTagsResult {
  images: LibraryImage[];
  errors: string[];
  cancelled?: boolean;
  total: number;      // work ids in scope
  attempted: number;  // work ids we issued a request for (total - skipped)
  fetched: number;    // requests that succeeded this run
  failed: number;     // requests that errored this run
  skipped: number;    // served from the sidecar cache, no request
  deferred: number;   // subset of skipped: failed repeatedly, backing off
  seeded: number;     // adopted from the catalog on first upgraded run
  cached: number;     // entries in pixiv_tags.json after the run
}
