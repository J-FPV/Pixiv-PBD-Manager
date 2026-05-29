import { useEffect } from "react";
import { SIMILAR_RESULT_CACHE_KEY, UI_STATE_KEY, UNMATCHED_CACHE_KEY } from "../constants";
import { persistJson } from "../utils/storage";
import type { AppState } from "./useAppState";

// Mirrors the slices of UI state that survive restarts into localStorage: the
// general UI layout, the unmatched-folder cache, and the last similar result.
export function useUiStatePersistence(s: AppState): void {
  const {
    activeTab,
    filter,
    similarRoots,
    similarExcludes,
    similarRootBoxHeight,
    similarExcludeBoxHeight,
    settings,
    expandedGroups,
    unmatchedFolders,
    similarResult
  } = s;

  useEffect(() => {
    persistJson(UI_STATE_KEY, {
      activeTab,
      filter,
      similarRoots,
      similarExcludes,
      similarRootBoxHeight,
      similarExcludeBoxHeight,
      similarSkipPixivPages: settings.similar_skip_pixiv_pages,
      expandedGroups: Array.from(expandedGroups)
    });
  }, [
    activeTab,
    filter,
    similarRoots,
    similarExcludes,
    similarRootBoxHeight,
    similarExcludeBoxHeight,
    settings.similar_skip_pixiv_pages,
    expandedGroups
  ]);

  useEffect(() => {
    persistJson(UNMATCHED_CACHE_KEY, unmatchedFolders);
  }, [unmatchedFolders]);

  useEffect(() => {
    persistJson(SIMILAR_RESULT_CACHE_KEY, similarResult);
  }, [similarResult]);
}
