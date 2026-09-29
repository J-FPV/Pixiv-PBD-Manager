export type BackupCategory = "artists" | "annotations" | "settings" | "collections";
export interface BackupEntry {
  id: string; created: string; kind: string; reason: string; size: number;
  categories: BackupCategory[]; available: boolean;
}
export interface BackupList { backups: BackupEntry[]; directory: string; warning: string }
export interface HistoryEntry {
  id: string; created: string; command: string; category: BackupCategory | "restore"; state: string; count: number;
}
export interface HistoryList { entries: HistoryEntry[]; latest_id: string | null }
export interface RestorePreview {
  token: string; categories: BackupCategory[]; created: string; invalid_paths: string[];
  changes: { category: BackupCategory; changed: number; unlinked?: number; damaged?: boolean; records?: number }[];
  details?: { category: BackupCategory; label: string; before: unknown; after: unknown }[];
}
