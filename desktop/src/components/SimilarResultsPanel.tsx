import { Archive } from "lucide-react";
import { t } from "../i18n";
import { useCleanupSelection } from "../hooks/useCleanupSelection";
import type {
  Language,
  SimilarEntry,
  SimilarGroup,
  SimilarResult,
  SimilarThreshold
} from "../types";
import { formatBytes } from "../utils/format";
import { Button } from "./Button";
import { SimilarTable } from "./SimilarTable";
import { SimilarToolbar } from "./SimilarToolbar";

export function SimilarResultsPanel({
  language,
  result,
  threshold,
  skipPixivPages,
  busy,
  expanded,
  roots,
  excludes,
  rootBoxHeight,
  excludeBoxHeight,
  ignored,
  setRoots,
  setExcludes,
  setRootBoxHeight,
  setExcludeBoxHeight,
  setThreshold,
  setSkipPixivPages,
  findSimilar,
  toggleGroup,
  revealFile,
  quarantineEntries,
  ignoreGroup,
  unignoreGroup
}: {
  language: Language;
  result: SimilarResult | null;
  threshold: SimilarThreshold;
  skipPixivPages: boolean;
  busy: boolean;
  expanded: Set<number>;
  roots: string;
  excludes: string;
  rootBoxHeight?: number;
  excludeBoxHeight?: number;
  ignored: Set<string>;
  setRoots: (value: string) => void;
  setExcludes: (value: string) => void;
  setRootBoxHeight: (value: number | undefined) => void;
  setExcludeBoxHeight: (value: number | undefined) => void;
  setThreshold: (value: SimilarThreshold) => void;
  setSkipPixivPages: (value: boolean) => void;
  findSimilar: () => void;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
  quarantineEntries: (entries: SimilarEntry[]) => void;
  ignoreGroup: (group: SimilarGroup) => void;
  unignoreGroup: (signature: string) => void;
}) {
  const selection = useCleanupSelection(result, ignored);

  return (
    <div className="similarResultsView">
      <SimilarToolbar
        language={language}
        roots={roots}
        excludes={excludes}
        rootBoxHeight={rootBoxHeight}
        excludeBoxHeight={excludeBoxHeight}
        setRoots={setRoots}
        setExcludes={setExcludes}
        setRootBoxHeight={setRootBoxHeight}
        setExcludeBoxHeight={setExcludeBoxHeight}
        threshold={threshold}
        setThreshold={setThreshold}
        skipPixivPages={skipPixivPages}
        setSkipPixivPages={setSkipPixivPages}
        busy={busy}
        findSimilar={findSimilar}
        result={result}
      />
      <div className="cleanupActionBar">
        <label className="checkLine compactCheck">
          <input
            type="checkbox"
            checked={selection.showIgnored}
            onChange={(event) => selection.setShowIgnored(event.target.checked)}
          />
          <span>{t(language, "showIgnored")} ({ignored.size})</span>
        </label>
        <Button
          onClick={selection.selectAllRecommended}
          disabled={busy || !selection.recommendedCount}
        >
          {t(language, "selectRecommended")}
        </Button>
        <Button
          onClick={selection.clearSelection}
          disabled={busy || !selection.selectedEntries.length}
        >
          {t(language, "clearSelection")}
        </Button>
        <span className="summary">
          {t(language, "selectedFiles")}: {selection.selectedEntries.length} / {t(language, "estimatedSpace")}:{" "}
          {formatBytes(selection.selectedBytes)}
        </span>
        <Button
          icon={<Archive size={16} />}
          variant="primary"
          disabled={busy || !selection.selectedEntries.length}
          onClick={() => quarantineEntries(selection.selectedEntries)}
        >
          {t(language, "cleanupSelected")}
        </Button>
      </div>
      <SimilarTable
        language={language}
        result={selection.visibleResult}
        expanded={expanded}
        toggleGroup={toggleGroup}
        revealFile={revealFile}
        selectedForCleanup={selection.selectedForCleanup}
        toggleCleanupEntry={selection.toggleCleanupEntry}
        quarantineEntry={(entry) => quarantineEntries([entry])}
        ignoredSignatures={ignored}
        ignoreGroup={ignoreGroup}
        unignoreGroup={unignoreGroup}
      />
    </div>
  );
}
