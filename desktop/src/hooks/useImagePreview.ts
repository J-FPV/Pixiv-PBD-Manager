import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import type { ImageDifferencePayload, ImageThumbnailPayload } from "../types";
import { thumbnailCache } from "../components/thumbnailCache";

export type PreviewMode = "single" | "side" | "slider" | "difference";

const PREVIEW_MAX = 1200;

// Modes that need the comparison image rendered next to / over the base one.
function needsCompareImage(mode: PreviewMode): boolean {
  return mode === "side" || mode === "slider";
}

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export interface ImagePreviewState {
  image: ImageThumbnailPayload | null;
  compareImage: ImageThumbnailPayload | null;
  difference: ImageDifferencePayload | null;
  error: string;
}

// Loads the full-size thumbnail for `path`, the compare image (side/slider),
// and the aligned diff (difference mode). Every fetch is abortable so rapid
// path/mode changes don't race a stale response onto the screen.
export function useImagePreview(path: string, comparePath: string, mode: PreviewMode): ImagePreviewState {
  const [image, setImage] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(path) || null);
  const [compareImage, setCompareImage] = useState<ImageThumbnailPayload | null>(null);
  const [difference, setDifference] = useState<ImageDifferencePayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setImage(thumbnailCache.get(path) || null);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path, max_size: PREVIEW_MAX })
      .then((payload) => {
        if (!cancelled) {
          thumbnailCache.set(path, payload);
          setImage(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(describeError(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    if (!comparePath || comparePath === path || !needsCompareImage(mode)) {
      setCompareImage(null);
      return () => {
        cancelled = true;
      };
    }
    setCompareImage(thumbnailCache.get(comparePath) || null);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", { path: comparePath, max_size: PREVIEW_MAX })
      .then((payload) => {
        if (!cancelled) {
          thumbnailCache.set(comparePath, payload);
          setCompareImage(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(describeError(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [comparePath, mode, path]);

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
      max_size: PREVIEW_MAX
    })
      .then((payload) => {
        if (!cancelled) {
          setDifference(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(describeError(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [comparePath, mode, path]);

  return { image, compareImage, difference, error };
}
