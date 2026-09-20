import { UI_STATE_KEY } from "../constants";
import { TAB_KEYS, type LibrarySort, type TabKey } from "../types";
import { normalizeLibrarySort } from "./librarySort";
import { loadJson } from "./storage";
import { clampTextareaHeight } from "./textarea";

export interface PersistedUiState {
  activeTab?: TabKey;
  filter?: string;
  similarRoots?: string;
  similarExcludes?: string;
  similarRootBoxHeight?: number;
  similarExcludeBoxHeight?: number;
  similarSkipPixivPages?: boolean;
  expandedGroups?: number[];
  librarySort?: LibrarySort;
}

export function normalizedUiState(): PersistedUiState {
  const state = loadJson<PersistedUiState>(UI_STATE_KEY, {});
  return {
    ...state,
    librarySort: normalizeLibrarySort(state.librarySort),
    activeTab: (TAB_KEYS as readonly string[]).includes(state.activeTab as string)
      ? state.activeTab
      : "artists",
    similarRootBoxHeight: clampTextareaHeight(state.similarRootBoxHeight),
    similarExcludeBoxHeight: clampTextareaHeight(state.similarExcludeBoxHeight),
    similarSkipPixivPages: typeof state.similarSkipPixivPages === "boolean" ? state.similarSkipPixivPages : undefined,
    expandedGroups: Array.isArray(state.expandedGroups)
      ? state.expandedGroups.filter((item) => Number.isFinite(Number(item))).map(Number)
      : []
  };
}
