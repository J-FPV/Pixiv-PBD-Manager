import { Maximize2 } from "lucide-react";
import { t } from "../../i18n";
import type { Language } from "../../types";
import type { PreviewMode } from "../../hooks/useImagePreview";
import { Button } from "../Button";

const MODES: { mode: PreviewMode; labelKey: Parameters<typeof t>[1] }[] = [
  { mode: "single", labelKey: "singlePreview" },
  { mode: "side", labelKey: "sideBySide" },
  { mode: "slider", labelKey: "sliderCompare" },
  { mode: "difference", labelKey: "differencePreview" }
];

export interface PreviewControlsProps {
  language: Language;
  mode: PreviewMode;
  setMode: (mode: PreviewMode) => void;
  comparePath: string;
  setComparePath: (path: string) => void;
  compareChoices: string[];
  onReset: () => void;
  isZoomed: boolean;
}

// Mode switcher (single / side-by-side / slider / difference), the compare
// target selector (hidden in single mode), and a reset-view action.
export function PreviewControls({
  language,
  mode,
  setMode,
  comparePath,
  setComparePath,
  compareChoices,
  onReset,
  isZoomed
}: PreviewControlsProps) {
  return (
    <div className="previewControls">
      <div className="segmented">
        {MODES.map((item) => (
          <button
            key={item.mode}
            className={mode === item.mode ? "active" : ""}
            onClick={() => setMode(item.mode)}
          >
            {t(language, item.labelKey)}
          </button>
        ))}
      </div>
      {mode !== "single" ? (
        <label className="previewCompare">
          <span>{t(language, "compareWith")}</span>
          <select value={comparePath} onChange={(event) => setComparePath(event.target.value)}>
            {compareChoices.map((item, index) => (
              <option key={item} value={item}>
                {index + 1}. {item}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="previewHint">{t(language, "zoomHint")}</span>
      )}
      <Button icon={<Maximize2 size={15} />} onClick={onReset} disabled={!isZoomed}>
        {t(language, "resetView")}
      </Button>
    </div>
  );
}
