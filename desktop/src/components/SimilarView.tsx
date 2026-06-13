import { useMemo, useState } from "react";
import { Archive, Images } from "lucide-react";
import { t } from "../i18n";
import type {
  CleanupSummary,
  Language,
  SimilarEntry,
  SimilarGroup,
  SimilarResult,
  SimilarThreshold
} from "../types";
import { CleanupHistory } from "./CleanupHistory";
import { SimilarResultsPanel } from "./SimilarResultsPanel";

export function SimilarView({
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
  setRoots,
  setExcludes,
  setRootBoxHeight,
  setExcludeBoxHeight,
  setThreshold,
  setSkipPixivPages,
  findSimilar,
  toggleGroup,
  revealFile,
  cleanupSummary,
  quarantineEntries,
  restoreCleanupItems,
  deleteCleanupItems,
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
  setRoots: (value: string) => void;
  setExcludes: (value: string) => void;
  setRootBoxHeight: (value: number | undefined) => void;
  setExcludeBoxHeight: (value: number | undefined) => void;
  setThreshold: (value: SimilarThreshold) => void;
  setSkipPixivPages: (value: boolean) => void;
  findSimilar: () => void;
  toggleGroup: (id: number) => void;
  revealFile: (path: string) => void;
  cleanupSummary: CleanupSummary;
  quarantineEntries: (entries: SimilarEntry[]) => void;
  restoreCleanupItems: (operationId: string, itemIds: string[]) => void;
  deleteCleanupItems: (operationId: string, itemIds: string[]) => void;
  ignoreGroup: (group: SimilarGroup) => void;
  unignoreGroup: (signature: string) => void;
}) {
  const [view, setView] = useState<"results" | "quarantine">("results");
  const ignored = useMemo(
    () => new Set(cleanupSummary.ignored_groups.map((group) => group.signature)),
    [cleanupSummary.ignored_groups]
  );

  return (
    <section className="panel">
      <div className="similarViewTabs">
        <button className={view === "results" ? "active" : ""} onClick={() => setView("results")}>
          <Images size={16} />
          {t(language, "scanResults")}
        </button>
        <button className={view === "quarantine" ? "active" : ""} onClick={() => setView("quarantine")}>
          <Archive size={16} />
          {t(language, "quarantine")} ({cleanupSummary.operations.length})
        </button>
      </div>
      <div className="similarViewBody">
        {view === "results" ? (
          <SimilarResultsPanel
            language={language}
            result={result}
            threshold={threshold}
            skipPixivPages={skipPixivPages}
            busy={busy}
            expanded={expanded}
            roots={roots}
            excludes={excludes}
            rootBoxHeight={rootBoxHeight}
            excludeBoxHeight={excludeBoxHeight}
            ignored={ignored}
            setRoots={setRoots}
            setExcludes={setExcludes}
            setRootBoxHeight={setRootBoxHeight}
            setExcludeBoxHeight={setExcludeBoxHeight}
            setThreshold={setThreshold}
            setSkipPixivPages={setSkipPixivPages}
            findSimilar={findSimilar}
            toggleGroup={toggleGroup}
            revealFile={revealFile}
            quarantineEntries={quarantineEntries}
            ignoreGroup={ignoreGroup}
            unignoreGroup={unignoreGroup}
          />
        ) : (
          <CleanupHistory
            language={language}
            summary={cleanupSummary}
            busy={busy}
            restoreItems={restoreCleanupItems}
            deleteItems={deleteCleanupItems}
            revealFile={revealFile}
          />
        )}
      </div>
    </section>
  );
}
