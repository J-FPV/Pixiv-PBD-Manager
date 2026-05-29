import type { Language, SimilarResult, SimilarThreshold } from "../types";
import { SimilarTable } from "./SimilarTable";
import { SimilarToolbar } from "./SimilarToolbar";

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
  revealFile
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
}) {
  return (
    <section className="panel">
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
      <SimilarTable
        language={language}
        result={result}
        expanded={expanded}
        toggleGroup={toggleGroup}
        revealFile={revealFile}
      />
    </section>
  );
}
