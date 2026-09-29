import type { AnnotationStatus, LibraryImage } from "./types";

export interface SyncDelta {
  upserts: LibraryImage[]; removed: string[]; index_version: string; base_version: string;
  unavailable: { path: string; error: string }[]; pending: string[]; cancelled?: boolean;
  annotation_status: AnnotationStatus; indexed: number;
}
export interface SyncBatch { generation: number; token: number; paths: string[]; full: boolean }
export interface NativeSyncStatus { generation: number; enabled: boolean; pending: number; unavailable: string[]; error: string; batch: SyncBatch | null }
