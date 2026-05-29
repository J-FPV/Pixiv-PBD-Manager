import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import type { ImageDifferencePayload, ImageThumbnailPayload } from "../types";
import { thumbnailCache } from "../components/thumbnailCache";

export type PreviewMode = "image" | "difference";

// Loads the full-size thumbnail for `path` and, in difference mode, the diff
// against `comparePath`. Both fetches are abortable so rapid path/mode changes
// don't race a stale response onto the screen.
export function useImagePreview(
  path: string,
  comparePath: string,
  mode: PreviewMode
): { image: ImageThumbnailPayload | null; difference: ImageDifferencePayload | null; error: string } {
  const [image, setImage] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(path) || null);
  const [difference, setDifference] = useState<ImageDifferencePayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setImage(thumbnailCache.get(path) || null);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path, max_size: 1200 })
      .then((payload) => {
        if (!cancelled) {
          thumbnailCache.set(path, payload);
          setImage(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    setDifference(null);
    if (mode !== "difference" || !comparePath || comparePath === path) {
      return () => {
        cancelled = true;
      };
    }
    setError("");
    void runGuiApi<ImageDifferencePayload>("image.difference", {
      base_path: path,
      compare_path: comparePath,
      max_size: 1200
    })
      .then((payload) => {
        if (!cancelled) {
          setDifference(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [comparePath, mode, path]);

  return { image, difference, error };
}
