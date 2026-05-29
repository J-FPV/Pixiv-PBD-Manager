import { t } from "../i18n";
import type { Language, ScanChange, ScanChangeKind, ScanPreviewPayload } from "../types";
import { useScanSelection } from "../hooks/useScanSelection";
import { Button } from "./Button";
import { ModalOverlay } from "./ModalOverlay";
import { ScanChangeRow } from "./ScanChangeRow";

export function ScanPreviewModal({
  language,
  preview,
  onApply,
  onCancel,
  openArtist
}: {
  language: Language;
  preview: ScanPreviewPayload;
  onApply: (operations: ScanChange[]) => void;
  onCancel: () => void;
  openArtist: (artistId: string) => void;
}) {
  const { selected, toggle, setGroupSelected, setAllSelected, accepted } = useScanSelection(preview.changes);

  const titleFor = (kind: ScanChangeKind) => {
    switch (kind) {
      case "new_artist":
        return t(language, "scanGroupNewArtist");
      case "name_change":
        return t(language, "scanGroupNameChange");
      case "add_save_paths":
        return t(language, "scanGroupAddSavePaths");
      case "add_work_ids":
        return t(language, "scanGroupAddWorkIds");
    }
  };

  const groupKinds: ScanChangeKind[] = ["new_artist", "add_work_ids", "name_change", "add_save_paths"];
  const groups = groupKinds
    .map((kind) => ({ kind, items: preview.changes.filter((change) => change.kind === kind) }))
    .filter((group) => group.items.length > 0);

  return (
    <ModalOverlay onClose={onCancel}>
      <div className="modal scanPreviewModal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, "scanPreviewTitle")}</h3>
        <p className="fieldHint">{t(language, "scanPreviewSummary")}</p>
        <div className="scanPreviewToolbar">
          <Button onClick={() => setAllSelected(true)}>{t(language, "scanSelectAll")}</Button>
          <Button onClick={() => setAllSelected(false)}>{t(language, "scanDeselectAll")}</Button>
          <span className="summary">
            {accepted.length} / {preview.changes.length}
          </span>
        </div>
        <div className="scanPreviewList">
          {groups.map((group) => (
            <div key={group.kind} className="scanGroup">
              <div className="scanGroupHeader">
                <span className="scanGroupTitle">
                  {titleFor(group.kind)} ({group.items.length})
                </span>
                <button type="button" className="button quiet" onClick={() => setGroupSelected(group.kind, true)}>
                  {t(language, "scanGroupSelectAll")}
                </button>
                <button type="button" className="button quiet" onClick={() => setGroupSelected(group.kind, false)}>
                  {t(language, "scanGroupDeselectAll")}
                </button>
              </div>
              {group.items.map((change) => (
                <ScanChangeRow
                  key={change.id}
                  language={language}
                  change={change}
                  checked={!!selected[change.id]}
                  onToggle={toggle}
                  onOpenArtist={openArtist}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="modalActions">
          <Button onClick={onCancel}>{t(language, "cancel")}</Button>
          <Button variant="primary" onClick={() => onApply(accepted)} disabled={accepted.length === 0}>
            {t(language, "scanApply")} ({accepted.length})
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
