export type ReviewStatus = "no_clues" | "pending" | "query_failed" | "conflict" | "awaiting_confirmation";
export interface ReviewCandidate { artist_id: string; name: string; source: string }
export interface ReviewQuery { pid: string; status: "resolved" | "failed" | "empty" | "stale"; artist_id: string; name: string; error: string }
export interface ReviewItem {
  path: string; count: number; status: ReviewStatus; revision: string; updated_at: number;
  candidates: ReviewCandidate[]; queries: ReviewQuery[]; samples?: Record<string, string>;
  sample_paths?: string[];
  stale?: boolean; unavailable?: boolean; unverified?: boolean; error?: string; name_hint?: string;
}
