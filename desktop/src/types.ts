export type Language = "zh" | "en";
export type TabKey = "artists" | "similar" | "settings" | "logs";

export interface AppSettings {
  language?: Language;
  database?: string;
  download_roots?: string[];
  exclude_roots?: string[];
  browser?: string;
  user_data_dir?: string;
  delay?: number;
  limit?: number;
  watch_interval?: number;
  resolve_online?: boolean;
  resolve_limit?: number;
  fuzzy_search?: boolean;
  fuzzy_min_score?: number;
  ssl_fallback?: boolean;
  similar_threshold?: SimilarThreshold;
  scan_local_subfolders?: boolean;
  separate_r18?: boolean;
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
}

export interface ArtistsPayload {
  artists: Artist[];
  db_path: string;
  project_root?: string;
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
