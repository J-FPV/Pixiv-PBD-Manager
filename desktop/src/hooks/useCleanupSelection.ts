import { useEffect, useMemo, useState } from "react";
import type { SimilarGroup, SimilarResult } from "../types";

export function useCleanupSelection(result: SimilarResult | null, ignored: Set<string>) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [selectedForCleanup, setSelectedForCleanup] = useState<Set<string>>(new Set());

  useEffect(() => {
    const recommended = new Set<string>();
    for (const group of result?.groups || []) {
      if (!ignored.has(group.signature)) {
        for (const path of group.recommended_remove_paths || []) {
          recommended.add(path);
        }
      }
    }
    setSelectedForCleanup(recommended);
    // A new scan/result snapshot resets the draft to the backend recommendation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(() => {
    setSelectedForCleanup((current) => {
      const ignoredPaths = new Set(
        (result?.groups || [])
          .filter((group) => ignored.has(group.signature))
          .flatMap((group) => group.entries.map((entry) => entry.path))
      );
      return new Set([...current].filter((path) => !ignoredPaths.has(path)));
    });
  }, [ignored, result]);

  const visibleGroups = useMemo(
    () => (result?.groups || []).filter((group) => showIgnored || !ignored.has(group.signature)),
    [ignored, result, showIgnored]
  );
  const visibleResult = result ? { ...result, groups: visibleGroups } : null;
  const selectedEntries = useMemo(
    () =>
      (result?.groups || [])
        .flatMap((group) => group.entries)
        .filter((entry) => selectedForCleanup.has(entry.path)),
    [result, selectedForCleanup]
  );
  const selectedBytes = selectedEntries.reduce((total, entry) => total + entry.size_bytes, 0);

  // Every backend-recommended-for-removal path across the currently visible
  // (non-ignored) groups — the target of the "select recommended" action.
  const recommendedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const group of result?.groups || []) {
      if (!ignored.has(group.signature)) {
        for (const path of group.recommended_remove_paths || []) {
          paths.add(path);
        }
      }
    }
    return paths;
  }, [ignored, result]);

  const selectAllRecommended = () => setSelectedForCleanup(new Set(recommendedPaths));
  const clearSelection = () => setSelectedForCleanup(new Set());

  const toggleCleanupEntry = (group: SimilarGroup, path: string) => {
    setSelectedForCleanup((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
        return next;
      }
      const selectedInGroup = group.entries.filter((entry) => next.has(entry.path)).length;
      if (selectedInGroup >= group.entries.length - 1) {
        return current;
      }
      next.add(path);
      return next;
    });
  };

  return {
    showIgnored,
    setShowIgnored,
    selectedForCleanup,
    visibleResult,
    selectedEntries,
    selectedBytes,
    recommendedCount: recommendedPaths.size,
    selectAllRecommended,
    clearSelection,
    toggleCleanupEntry
  };
}
