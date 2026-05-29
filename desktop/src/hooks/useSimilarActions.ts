import type { Dispatch, SetStateAction } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { ApiEvent, AppSettings, Language, LogEntry, SimilarResult, TabKey } from "../types";
import { splitLines } from "../utils/paths";
import type { TaskRunner } from "./useTaskRunner";

// State for the similar-image scan lives in App; this hook only carries the
// scan action and the group expand/collapse toggle.
export interface SimilarActionsDeps {
  language: Language;
  settings: AppSettings;
  similarRoots: string;
  similarExcludes: string;
  setActiveTab: Dispatch<SetStateAction<TabKey>>;
  setSimilarResult: Dispatch<SetStateAction<SimilarResult | null>>;
  setExpandedGroups: Dispatch<SetStateAction<Set<number>>>;
  appendLog: (level: LogEntry["level"], message: string) => void;
  handleEvent: (event: ApiEvent) => void;
  runTask: TaskRunner["runTask"];
}

export interface SimilarActions {
  findSimilar: () => void;
  toggleGroup: (id: number) => void;
}

export function useSimilarActions(deps: SimilarActionsDeps): SimilarActions {
  const {
    language: languageValue,
    settings,
    similarRoots,
    similarExcludes,
    setActiveTab,
    setSimilarResult,
    setExpandedGroups,
    appendLog,
    handleEvent,
    runTask
  } = deps;

  const findSimilar = () =>
    runTask(t(languageValue, "findSimilar"), async (signal, registerControls) => {
      setActiveTab("similar");
      const threshold = settings.similar_threshold || "likely";
      const result = await runGuiApi<SimilarResult>(
        "similar.run",
        {
          ...settings,
          threshold,
          similar_skip_pixiv_pages: Boolean(settings.similar_skip_pixiv_pages),
          roots: splitLines(similarRoots),
          exclude_roots: splitLines(similarExcludes)
        },
        handleEvent,
        { signal, onStart: registerControls }
      );
      setSimilarResult(result);
      setExpandedGroups(new Set());
      appendLog("info", `Similar result: ${result.files_seen} files, ${result.groups.length} groups`);
      for (const err of result.errors) {
        appendLog("error", err);
      }
    });

  const toggleGroup = (id: number) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return { findSimilar, toggleGroup };
}
