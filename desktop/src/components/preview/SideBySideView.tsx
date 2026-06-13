import { t } from "../../i18n";
import type { Language, SimilarEntry } from "../../types";
import type { ZoomTransform } from "../../hooks/useZoomPan";
import { ImageMeta } from "./ImageMeta";
import { ZoomLayer } from "./ZoomLayer";

export interface SideBySidePaneProps {
  language: Language;
  loadingText: string;
  transform: ZoomTransform;
  dataUrl?: string;
  entry?: SimilarEntry;
  isKeep: boolean;
}

function Pane({ language, loadingText, transform, dataUrl, entry, isKeep }: SideBySidePaneProps) {
  return (
    <div className={`previewPane${isKeep ? " keep" : ""}`}>
      <div className="previewPaneStage">
        {dataUrl ? (
          <ZoomLayer dataUrl={dataUrl} alt={entry?.path || ""} transform={transform} />
        ) : (
          <span className="previewPlaceholder">{loadingText}</span>
        )}
      </div>
      <ImageMeta language={language} entry={entry} isKeep={isKeep} />
    </div>
  );
}

// Two panes side by side sharing one zoom/pan transform, each with its own
// metadata caption. Used to weigh resolution/size/date when picking a keeper.
export function SideBySideView({
  language,
  transform,
  baseUrl,
  compareUrl,
  baseEntry,
  compareEntry,
  recommendedKeepPath
}: {
  language: Language;
  transform: ZoomTransform;
  baseUrl?: string;
  compareUrl?: string;
  baseEntry?: SimilarEntry;
  compareEntry?: SimilarEntry;
  recommendedKeepPath: string | null;
}) {
  const loadingText = t(language, "loadingPreview");
  return (
    <div className="previewSideBySide">
      <Pane
        language={language}
        loadingText={loadingText}
        transform={transform}
        dataUrl={baseUrl}
        entry={baseEntry}
        isKeep={!!baseEntry && baseEntry.path === recommendedKeepPath}
      />
      <Pane
        language={language}
        loadingText={loadingText}
        transform={transform}
        dataUrl={compareUrl}
        entry={compareEntry}
        isKeep={!!compareEntry && compareEntry.path === recommendedKeepPath}
      />
    </div>
  );
}
