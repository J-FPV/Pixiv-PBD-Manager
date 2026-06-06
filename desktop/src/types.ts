import type { PathPickKind } from "./api";

export type Language = "zh" | "en";
export type ThemeMode = "system" | "light" | "dark";

// Independent task lanes. The library lane (scan / update-check / download /
// name-refresh …) mutates the artist DB and/or hits Pixiv, so its tasks stay
// serialized among themselves; the similar lane is local image hashing writing
// a separate index, so it can run in parallel with the library lane.
export type TaskLane = "library" | "similar";
export const TASK_LANES: TaskLane[] = ["library", "similar"];

export const TAB_KEYS = ["artists", "unmatched", "similar", "settings", "logs"] as const;
export type TabKey = typeof TAB_KEYS[number];

export interface UnmatchedFolder {
  path: string;
  count: number;
}

export type ScanChangeKind = "new_artist" | "name_change" | "add_save_paths" | "add_work_ids";

export interface ScanChangeNewArtist {
  id: string;
  kind: "new_artist";
  artist_id: string;
  name: string;
  sources: string[];
  roots: string[];
  save_paths: string[];
  work_ids: string[];
}

export interface ScanChangeNameChange {
  id: string;
  kind: "name_change";
  artist_id: string;
  old_name: string;
  new_name: string;
}

export interface ScanChangeAddSavePaths {
  id: string;
  kind: "add_save_paths";
  artist_id: string;
  name: string;
  existing: string[];
  paths: string[];
}

export interface ScanChangeAddWorkIds {
  id: string;
  kind: "add_work_ids";
  artist_id: string;
  name: string;
  existing_count: number;
  work_ids: string[];
}

export type ScanChange =
  | ScanChangeNewArtist
  | ScanChangeNameChange
  | ScanChangeAddSavePaths
  | ScanChangeAddWorkIds;

export interface ScanPreviewPayload {
  changes: ScanChange[];
  files_seen: number;
  files_matched: number;
  excluded_dirs: number;
  artists: number;
  name_only_artists: number;
  resolved_name_only: number;
  fuzzy_resolved_name_only: number;
  ssl_fallback_used: number;
  resolve_errors: string[];
  unmatched_folders: UnmatchedFolder[];
}

export interface ScanApplyPayload {
  applied: number;
  new_artists: number;
  name_changes: number;
  save_paths_added: number;
  work_ids_added: number;
  db_path: string;
  artists: Artist[];
}

export interface AppSettings {
  language?: Language;
  theme?: ThemeMode;
  database?: string;
  download_roots?: string[];
  download_roots_textarea_height?: number;
  exclude_roots?: string[];
  exclude_roots_textarea_height?: number;
  browser?: string;
  user_data_dir?: string;
  delay?: number;
  limit?: number;
  download_concurrency?: number;
  watch_interval?: number;
  resolve_online?: boolean;
  resolve_limit?: number;
  fuzzy_search?: boolean;
  fuzzy_min_score?: number;
  ssl_fallback?: boolean;
  similar_threshold?: SimilarThreshold;
  similar_skip_pixiv_pages?: boolean;
  scan_local_subfolders?: boolean;
  // -1 = unlimited; 0 = root level only; N = walk N levels under each download root.
  scan_max_depth?: number;
  // Allow folder names with numeric ID < 3000 to be recognised as Pixiv user IDs.
  // Off by default so date prefixes like ``2020-07-01-X`` aren't misread.
  scan_recognize_low_pids?: boolean;
  // -1 = unlimited; 0 = artist save_path top level only.
  update_check_depth?: number;
  update_check_pages?: number;
  separate_r18?: boolean;
  show_progress_percent?: boolean;
}

export interface SettingsPayload {
  settings: AppSettings;
  cookie_consent: boolean;
  pixiv_cookie: string;
  has_cookie: boolean;
  cookie_storage: string;
  project_root?: string;
  settings_path?: string;
}

export interface Artist {
  id: string;
  name: string;
  pixiv_url: string;
  works: number;
  new_works: number;
  work_ids: string[];
  new_work_ids: string[];
  save_paths: string[];
  download_roots: string[];
  last_seen: string;
  last_checked: string | null;
  last_opened: string;
  notes: string;
  favorite: boolean;
  tags: string[];
}

export interface ArtistsPayload {
  artists: Artist[];
  tags?: string[];
  db_path: string;
  project_root?: string;
}

// Commands that mutate tags (assign/rename/delete) return the refreshed artist
// list plus the global ordered tag-definition list.
export interface TagMutationPayload {
  artists: Artist[];
  tags: string[];
}

export interface ArtistNameRefreshResult {
  requested: number;
  checked: number;
  changed: number;
  failed: number;
  errors: string[];
  refreshed: { artist_id: string; old_name: string; name: string; changed: boolean }[];
  artists: Artist[];
}

export interface ProgressEvent {
  type: "progress";
  key: string;
  payload: Record<string, unknown>;
}

export interface ResultEvent<T> {
  type: "result";
  command: string;
  payload: T;
}

export interface ErrorEvent {
  type: "error";
  command?: string;
  message: string;
  traceback?: string;
}

export type ApiEvent<T = unknown> = ProgressEvent | ResultEvent<T> | ErrorEvent;

export interface ScanResult {
  files_seen: number;
  files_matched: number;
  excluded_dirs: number;
  artists: number;
  name_only_artists: number;
  changed: number;
  resolved_name_only: number;
  fuzzy_resolved_name_only: number;
  ssl_fallback_used: number;
  resolve_errors: string[];
  db_path: string;
  unmatched_folders?: UnmatchedFolder[];
}

export interface UpdateResult {
  checked: number;
  artists_with_updates: number;
  new_works: number;
  ssl_fallback_used: number;
  errors: string[];
}

export interface DownloadResult {
  artists: number;
  artworks: number;
  pages_saved: number;
  files_skipped: number;
  ssl_fallback_used: number;
  errors: string[];
}

export type SimilarThreshold = "likely" | "possible";

export interface SimilarEntry {
  path: string;
  size_bytes: number;
  mtime_ns: number;
  width: number;
  height: number;
  resolution: string;
  sha256: string;
  phash: string;
  dhash: string;
}

export interface SimilarGroup {
  id: number;
  kind: "exact" | "likely" | "possible";
  best_phash_distance: number;
  best_dhash_distance: number;
  entries: SimilarEntry[];
}

export interface SimilarResult {
  roots: string[];
  index_path: string;
  files_seen: number;
  indexed: number;
  reused: number;
  changed: number;
  error_count: number;
  errors: string[];
  groups: SimilarGroup[];
}

export interface LogEntry {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
}

// ---- shared UI shapes (extracted from former App.tsx) ----

export interface ProgressLineState {
  label: string;
  current: number;
  total: number;
  indeterminate?: boolean;
  speedBps?: number;
}

export interface TaskProgressState {
  main: ProgressLineState;
  // Per-slot download bars, keyed by the backend's concurrency slot id. One
  // entry per concurrent download; non-download tasks leave this unset.
  files?: Record<number, ProgressLineState>;
}

export interface PromptField {
  key: string;
  label: string;
  value: string;
  browse?: PathPickKind;
}

export interface PromptState {
  title: string;
  fields: PromptField[];
  onSubmit: (values: Record<string, string>) => void;
}

export interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

export interface ImageThumbnailPayload {
  path: string;
  data_url: string;
  width: number;
  height: number;
}

export interface ImageDifferencePayload {
  base_path: string;
  compare_path: string;
  data_url: string;
  width: number;
  height: number;
}
