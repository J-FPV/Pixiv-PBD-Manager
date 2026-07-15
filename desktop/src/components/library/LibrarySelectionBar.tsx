import { CheckSquare2, FileDown, SlidersHorizontal, Square, X } from "lucide-react";
import { t } from "../../i18n";
import type { Language } from "../../types";
import { Button } from "../Button";

export function LibrarySelectionBar({
  language,
  selectedCount,
  visibleCount,
  allVisibleSelected,
  busy,
  onToggleVisible,
  onClear,
  onBatchEdit,
  onExport
}: {
  language: Language;
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  busy: boolean;
  onToggleVisible: () => void;
  onClear: () => void;
  onBatchEdit: () => void;
  onExport: () => void;
}) {
  return (
    <div className="librarySelectionBar">
      <Button
        icon={allVisibleSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}
        disabled={!visibleCount}
        onClick={onToggleVisible}
      >
        {t(language, allVisibleSelected ? "deselectVisible" : "selectVisible")}
      </Button>
      <span className={selectedCount ? "selectionCount active" : "selectionCount"}>
        {t(language, "selectedImages").replace("{count}", String(selectedCount))}
      </span>
      {selectedCount ? (
        <Button icon={<X size={15} />} iconOnly title={t(language, "clearSelection")} onClick={onClear}>
          {t(language, "clearSelection")}
        </Button>
      ) : null}
      <div className="toolbarSpacer" />
      <Button icon={<SlidersHorizontal size={16} />} disabled={!selectedCount || busy} onClick={onBatchEdit}>
        {t(language, "batchEdit")}
      </Button>
      <Button
        icon={<FileDown size={16} />}
        disabled={(!selectedCount && !visibleCount) || busy}
        title={t(language, "exportListHint")}
        onClick={onExport}
      >
        {t(language, "exportList")}
      </Button>
    </div>
  );
}
