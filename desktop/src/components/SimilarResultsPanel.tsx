import { useMemo } from "react";
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

function SimilarKindStats({ language, result }: { language: Language; result: SimilarResult }) {
  const stats = useMemo(
    () =>
      (["exact", "likely", "possible"] as const).map((kind) => {
        const groups = result.groups.filter((group) => group.kind === kind);
        return {
          kind,
          groups: groups.length,
          bytes: groups.reduce((total, group) => total + (group.estimated_reclaim_bytes || 0), 0)
        };
      }),
    [result]
  );
  return (
    <div className="similarKindStats">
      {stats.map((stat) => (
        <span className={stat.kind} key={stat.kind}>
          <strong>{t(language, stat.kind === "exact" ? "exact" : stat.kind)}</strong>
          {stat.groups} {t(language, "groupsLabel")} · {formatBytes(stat.bytes)}
        </span>
      ))}
    </div>
  );
}

function CleanupActionBar({
  language,
  busy,
  ignoredSize,
  selection,
  quarantineEntries
}: {
  language: Language;
  busy: boolean;
  ignoredSize: number;
  selection: ReturnType<typeof useCleanupSelection>;
  quarantineEntries: (entries: SimilarEntry[]) => void;
}) {
  const hasSelection = selection.selectedEntries.length > 0;
  return (
    <div className="cleanupActionBar">
      <label className="checkLine compactCheck">
        <input type="checkbox" checked={selection.showIgnored} onChange={(event) => selection.setShowIgnored(event.target.checked)} />
        <span>{t(language, "showIgnored")} ({ignoredSize})</span>
      </label>
      <Button
        className={hasSelection ? "favToggle active" : "favToggle"}
        disabled={busy || (!hasSelection && !selection.recommendedCount)}
        onClick={() => hasSelection ? selection.clearSelection() : selection.selectAllRecommended()}
      >
        {t(language, hasSelection ? "clearSelection" : "selectRecommended")}
      </Button>
      <span className="summary">
        {t(language, "selectedFiles")}: {selection.selectedEntries.length} / {t(language, "estimatedSpace")}: {" "}
        {formatBytes(selection.selectedBytes)}
      </span>
      <Button
        icon={<Archive size={16} />}
        variant="primary"
        disabled={busy || !hasSelection}
        onClick={() => quarantineEntries(selection.selectedEntries)}
      >
        {t(language, "cleanupSelected")}
      </Button>
    </div>
  );
}

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
      {result ? <SimilarKindStats language={language} result={result} /> : null}
      <CleanupActionBar
        language={language}
        busy={busy}
        ignoredSize={ignored.size}
        selection={selection}
        quarantineEntries={quarantineEntries}
      />
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
