import { useRef } from "react";
import type { RefObject } from "react";
import { Image as ImageIcon } from "lucide-react";
import { browsePath } from "../api";
import { t } from "../i18n";
import type { Language, SimilarResult, SimilarThreshold } from "../types";
import { clampTextareaHeight } from "../utils/textarea";
import { Button } from "./Button";

export function SimilarToolbar({
  language,
  roots,
  excludes,
  rootBoxHeight,
  excludeBoxHeight,
  setRoots,
  setExcludes,
  setRootBoxHeight,
  setExcludeBoxHeight,
  threshold,
  setThreshold,
  skipPixivPages,
  setSkipPixivPages,
  busy,
  findSimilar,
  result
}: {
  language: Language;
  roots: string;
  excludes: string;
  rootBoxHeight?: number;
  excludeBoxHeight?: number;
  setRoots: (value: string) => void;
  setExcludes: (value: string) => void;
  setRootBoxHeight: (value: number | undefined) => void;
  setExcludeBoxHeight: (value: number | undefined) => void;
  threshold: SimilarThreshold;
  setThreshold: (value: SimilarThreshold) => void;
  skipPixivPages: boolean;
  setSkipPixivPages: (value: boolean) => void;
  busy: boolean;
  findSimilar: () => void;
  result: SimilarResult | null;
}) {
  const rootTextareaRef = useRef<HTMLTextAreaElement>(null);
  const excludeTextareaRef = useRef<HTMLTextAreaElement>(null);

  const appendFolder = async (value: string, setter: (next: string) => void) => {
    const picked = await browsePath("folder");
    if (!picked) {
      return;
    }
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.includes(picked)) {
      setter([...lines, picked].join("\n"));
    }
  };

  const rememberTextareaHeight = (
    ref: RefObject<HTMLTextAreaElement | null>,
    setter: (value: number | undefined) => void
  ) => {
    setter(clampTextareaHeight(ref.current?.offsetHeight));
  };

  return (
    <div className="similarHeader">
      <div className="similarPaths">
        <label>
          <span>{t(language, "similarRoots")}</span>
          <textarea
            ref={rootTextareaRef}
            value={roots}
            onChange={(event) => setRoots(event.target.value)}
            onMouseUp={() => rememberTextareaHeight(rootTextareaRef, setRootBoxHeight)}
            onBlur={() => rememberTextareaHeight(rootTextareaRef, setRootBoxHeight)}
            placeholder={t(language, "similarRootsHint")}
            style={rootBoxHeight ? { height: rootBoxHeight } : undefined}
          />
          <button type="button" className="button browseButton" onClick={() => void appendFolder(roots, setRoots)}>
            {t(language, "addFolder")}
          </button>
        </label>
        <label>
          <span>{t(language, "excludeRoots")}</span>
          <textarea
            ref={excludeTextareaRef}
            value={excludes}
            onChange={(event) => setExcludes(event.target.value)}
            onMouseUp={() => rememberTextareaHeight(excludeTextareaRef, setExcludeBoxHeight)}
            onBlur={() => rememberTextareaHeight(excludeTextareaRef, setExcludeBoxHeight)}
            placeholder={t(language, "similarExcludeRootsHint")}
            style={excludeBoxHeight ? { height: excludeBoxHeight } : undefined}
          />
          <button type="button" className="button browseButton" onClick={() => void appendFolder(excludes, setExcludes)}>
            {t(language, "addFolder")}
          </button>
        </label>
      </div>
      <div className="toolbar">
        <div className="segmented">
          <button className={threshold === "likely" ? "active" : ""} onClick={() => setThreshold("likely")}>
            {t(language, "likely")}
          </button>
          <button className={threshold === "possible" ? "active" : ""} onClick={() => setThreshold("possible")}>
            {t(language, "possible")}
          </button>
        </div>
        <label className="checkLine compactCheck">
          <input type="checkbox" checked={skipPixivPages} onChange={(event) => setSkipPixivPages(event.target.checked)} />
          <span>{t(language, "skipPixivPages")}</span>
        </label>
        <Button icon={<ImageIcon size={16} />} disabled={busy} onClick={findSimilar} variant="primary">
          {t(language, "findSimilar")}
        </Button>
        {result ? (
          <span className="summary">
            {result.files_seen} files / {result.indexed} indexed / {result.groups.length} groups / {result.error_count} errors
          </span>
        ) : null}
      </div>
    </div>
  );
}
