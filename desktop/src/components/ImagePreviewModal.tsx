import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { Language, SimilarEntry } from "../types";
import { useImagePreview, type PreviewMode } from "../hooks/useImagePreview";
import { useZoomPan } from "../hooks/useZoomPan";
import { Button } from "./Button";
import { ModalOverlay } from "./ModalOverlay";
import { PreviewControls } from "./preview/PreviewControls";
import { PreviewStage } from "./preview/PreviewStage";

const MODE_KEYS: Record<string, PreviewMode> = { "1": "single", "2": "side", "3": "slider", "4": "difference" };

export interface ImagePreviewModalProps {
  language: Language;
  path: string;
  entries: SimilarEntry[];
  recommendedKeepPath?: string | null;
  onPathChange?: (path: string) => void;
  onClose: () => void;
  revealFile: (path: string) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA";
}

export function ImagePreviewModal({
  language,
  path,
  entries,
  recommendedKeepPath = null,
  onPathChange,
  onClose,
  revealFile
}: ImagePreviewModalProps) {
  const [mode, setMode] = useState<PreviewMode>("single");
  const [comparePath, setComparePath] = useState("");
  const uniquePaths = useMemo(() => Array.from(new Set(entries.map((entry) => entry.path))), [entries]);
  const entryByPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const currentIndex = Math.max(0, uniquePaths.indexOf(path));
  const compareChoices = useMemo(() => uniquePaths.filter((item) => item !== path), [path, uniquePaths]);
  const canSwitch = uniquePaths.length > 1;

  const preview = useImagePreview(path, comparePath, mode);
  const { transform, containerRef, reset, isZoomed, panHandlers } = useZoomPan(`${mode}|${path}|${comparePath}`);

  useEffect(() => {
    if (!compareChoices.length) {
      setComparePath("");
      setMode("single");
      return;
    }
    if (!comparePath || comparePath === path || !compareChoices.includes(comparePath)) {
      setComparePath(compareChoices[0]);
    }
  }, [compareChoices, comparePath, path]);

  const switchBy = (offset: number) => {
    if (!canSwitch || !onPathChange) {
      return;
    }
    onPathChange(uniquePaths[(currentIndex + offset + uniquePaths.length) % uniquePaths.length]);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.key === "ArrowLeft") {
        switchBy(-1);
      } else if (event.key === "ArrowRight") {
        switchBy(1);
      } else if (event.key === "0" || event.key.toLowerCase() === "r") {
        reset();
      } else if (MODE_KEYS[event.key] && (event.key === "1" || canSwitch)) {
        setMode(MODE_KEYS[event.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal imagePreviewModal" onClick={(event) => event.stopPropagation()}>
        <div className="previewTitleRow">
          <h3>{t(language, "preview")}</h3>
          {canSwitch ? (
            <div className="previewStepper">
              <Button icon={<ChevronLeft size={16} />} onClick={() => switchBy(-1)}>{t(language, "previousImage")}</Button>
              <span>{currentIndex + 1} / {uniquePaths.length}</span>
              <Button icon={<ChevronRight size={16} />} onClick={() => switchBy(1)}>{t(language, "nextImage")}</Button>
            </div>
          ) : null}
        </div>
        {canSwitch ? (
          <PreviewControls
            language={language}
            mode={mode}
            setMode={setMode}
            comparePath={comparePath}
            setComparePath={setComparePath}
            compareChoices={compareChoices}
            onReset={reset}
            isZoomed={isZoomed}
          />
        ) : null}
        <PreviewStage
          language={language}
          mode={mode}
          transform={transform}
          containerRef={containerRef}
          panHandlers={panHandlers}
          preview={preview}
          path={path}
          baseEntry={entryByPath.get(path)}
          compareEntry={entryByPath.get(comparePath)}
          recommendedKeepPath={recommendedKeepPath}
        />
        <div className="previewFooter">
          <div className="previewPathList">
            <div className="imagePreviewPath" title={path}>{path}</div>
            {mode !== "single" && comparePath ? (
              <div className="imagePreviewPath" title={comparePath}>
                {t(language, "differenceHint")}: {comparePath}
              </div>
            ) : null}
          </div>
          <div className="modalActions previewActions">
            <Button onClick={() => revealFile(path)}>{t(language, "openFolder")}</Button>
            <Button variant="primary" onClick={onClose}>{t(language, "close")}</Button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
