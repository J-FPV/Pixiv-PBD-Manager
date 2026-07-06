import { useEffect, useState } from "react";
import { runGuiApi } from "../api";
import type { ImageDifferencePayload, ImageThumbnailPayload } from "../types";
import { thumbnailCache, thumbnailCacheKey } from "../components/thumbnailCache";

export type PreviewMode = "single" | "side" | "slider" | "difference";

const PREVIEW_MAX = 1200;

export interface ImagePreviewOptions {
  maxSize?: number;
  targetWidth?: number;
  maxPixels?: number;
  cacheVariant?: string;
}

// Modes that need the comparison image rendered next to / over the base one.
function needsCompareImage(mode: PreviewMode): boolean {
  return mode === "side" || mode === "slider";
}

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function thumbnailRequest(targetPath: string, maxSize: number, targetWidth: number, maxPixels: number) {
  return {
    path: targetPath,
    max_size: maxSize,
    ...(targetWidth ? { target_width: targetWidth } : {}),
    ...(maxPixels ? { max_pixels: maxPixels } : {})
  };
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
export function useImagePreview(
  path: string,
  comparePath: string,
  mode: PreviewMode,
  options: ImagePreviewOptions = {}
): ImagePreviewState {
  const maxSize = options.maxSize ?? PREVIEW_MAX;
  const targetWidth = options.targetWidth ?? 0;
  const maxPixels = options.maxPixels ?? 0;
  const cacheVariant = options.cacheVariant || `preview-${maxSize}-${targetWidth}-${maxPixels}`;
  const imageCacheKey = thumbnailCacheKey(path, cacheVariant);
  const compareCacheKey = thumbnailCacheKey(comparePath, cacheVariant);
  const [image, setImage] = useState<ImageThumbnailPayload | null>(() => thumbnailCache.get(imageCacheKey) || null);
  const [compareImage, setCompareImage] = useState<ImageThumbnailPayload | null>(null);
  const [difference, setDifference] = useState<ImageDifferencePayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setImage(thumbnailCache.get(imageCacheKey) || null);
    void runGuiApi<ImageThumbnailPayload>("image.thumbnail", thumbnailRequest(path, maxSize, targetWidth, maxPixels))
      .then((payload) => {
        if (!cancelled) {
          thumbnailCache.set(imageCacheKey, payload);
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
  }, [imageCacheKey, maxPixels, maxSize, path, targetWidth]);

  useEffect(() => {
    let cancelled = false;
    if (!comparePath || comparePath === path || !needsCompareImage(mode)) {
      setCompareImage(null);
      return () => {
        cancelled = true;
      };
    }
    setCompareImage(thumbnailCache.get(compareCacheKey) || null);
    void runGuiApi<ImageThumbnailPayload>(
      "image.thumbnail",
      thumbnailRequest(comparePath, maxSize, targetWidth, maxPixels)
    )
      .then((payload) => {
        if (!cancelled) {
          thumbnailCache.set(compareCacheKey, payload);
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
  }, [compareCacheKey, comparePath, maxPixels, maxSize, mode, path, targetWidth]);

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
      max_size: maxSize
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
  }, [comparePath, maxSize, mode, path]);

  return { image, compareImage, difference, error };
}
