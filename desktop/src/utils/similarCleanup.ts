import type { SimilarEntry, SimilarGroup, SimilarResult } from "../types";

function needsUpgrade(group: SimilarGroup): boolean {
  return (
    !group.signature ||
    !Array.isArray(group.recommended_remove_paths) ||
    group.recommended_keep_path === undefined ||
    group.estimated_reclaim_bytes === undefined
  );
}

function recommendation(group: SimilarGroup): {
  keep: string | null;
  remove: string[];
  reclaim: number;
} {
  if (group.entries.length < 2 || group.kind === "possible") {
    return { keep: null, remove: [], reclaim: 0 };
  }
  if (group.kind === "likely") {
    const ratios = group.entries.map((entry) =>
      entry.width > 0 && entry.height > 0 ? entry.width / entry.height : 0
    );
    const smallest = Math.min(...ratios);
    const largest = Math.max(...ratios);
    if (smallest <= 0 || (largest - smallest) / smallest > 0.02) {
      return { keep: null, remove: [], reclaim: 0 };
    }
  }
  const ranked = [...group.entries].sort((left, right) => {
    const areaDifference = right.width * right.height - left.width * left.height;
    if (areaDifference) return areaDifference;
    const sizeDifference = right.size_bytes - left.size_bytes;
    if (sizeDifference) return sizeDifference;
    const timeDifference = right.mtime_ns - left.mtime_ns;
    if (timeDifference) return timeDifference;
    const leftPath = left.path.toLowerCase();
    const rightPath = right.path.toLowerCase();
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
  return {
    keep: ranked[0].path,
    remove: ranked.slice(1).map((entry) => entry.path),
    reclaim: ranked.slice(1).reduce((total, entry) => total + entry.size_bytes, 0)
  };
}

async function contentSignature(entries: SimilarEntry[]): Promise<string> {
  const tokens = entries
    .map((entry) => `${entry.sha256}:${entry.size_bytes}:${entry.width}x${entry.height}`)
    .sort()
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tokens));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function similarResultNeedsUpgrade(result: SimilarResult | null): boolean {
  return Boolean(result?.groups.some(needsUpgrade));
}

export async function upgradeSimilarResult(result: SimilarResult): Promise<SimilarResult> {
  const groups = await Promise.all(
    result.groups.map(async (group) => {
      if (!needsUpgrade(group)) return group;
      const suggested = recommendation(group);
      return {
        ...group,
        signature: group.signature || (await contentSignature(group.entries)),
        recommended_keep_path: group.recommended_keep_path ?? suggested.keep,
        recommended_remove_paths: Array.isArray(group.recommended_remove_paths)
          ? group.recommended_remove_paths
          : suggested.remove,
        estimated_reclaim_bytes: group.estimated_reclaim_bytes ?? suggested.reclaim
      };
    })
  );
  return { ...result, groups };
}
