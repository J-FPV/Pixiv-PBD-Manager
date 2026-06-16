import type { ImageThumbnailPayload } from "../types";

// Module-level cache so the same image isn't re-encoded by the Python backend
// every time a row is virtualized in or a modal reopens. Lifetime = page load.
export const thumbnailCache = new Map<string, ImageThumbnailPayload>();

export function thumbnailCacheKey(path: string, variant: string): string {
  return `${variant}:${path}`;
}
