import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { t } from "../i18n";
import type { Language, ScanChange, ScanChangeKind, ScanPreviewPayload } from "../types";
import { Button } from "./Button";
import { ModalOverlay } from "./ModalOverlay";

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
  // Default-on for additions, default-off for mutations of existing data — that
  // preserves "rule A": never silently overwrite a manually-set name or path.
  const defaultSelected = (kind: ScanChangeKind) => kind === "new_artist" || kind === "add_work_ids";
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const change of preview.changes) {
      init[change.id] = defaultSelected(change.kind);
    }
    return init;
  });

  const toggle = (id: string) =>
    setSelected((current) => ({ ...current, [id]: !current[id] }));

  const setGroupSelected = (kind: ScanChangeKind, value: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      for (const change of preview.changes) {
        if (change.kind === kind) {
          next[change.id] = value;
        }
      }
      return next;
    });
  };

  const setAllSelected = (value: boolean) => {
    setSelected((current) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(current)) {
        next[key] = value;
      }
      return next;
    });
  };

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

  const accepted = preview.changes.filter((change) => selected[change.id]);
  const selectedCount = accepted.length;

  const renderDetail = (change: ScanChange) => {
    if (change.kind === "new_artist") {
      const savePath = change.save_paths[0] || "";
      return (
        <>
          <span className="scanChangeName">{change.name || "—"}</span>
          <span className="scanChangeDetail">
            {change.work_ids.length} {t(language, "scanWorksLabel")}
            {savePath ? ` · ${savePath}` : ""}
          </span>
        </>
      );
    }
    if (change.kind === "name_change") {
      return (
        <span className="scanChangeDetail warning">
          {t(language, "scanExistingName")}: "{change.old_name || "—"}" → {t(language, "scanNewName")}: "{change.new_name}"
        </span>
      );
    }
    if (change.kind === "add_save_paths") {
      const first = change.paths[0] || "";
      const extra = change.paths.length > 1 ? ` (+${change.paths.length - 1})` : "";
      return (
        <>
          <span className="scanChangeName">{change.name || "—"}</span>
          <span className="scanChangeDetail warning" title={change.paths.join("\n")}>
            {t(language, "scanNewlyAdded")} {first}{extra}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="scanChangeName">{change.name || "—"}</span>
        <span className="scanChangeDetail">
          {t(language, "scanNewlyAdded")} {change.work_ids.length} {t(language, "scanWorksLabel")} · {t(language, "scanExistingWorks")} {change.existing_count}
        </span>
      </>
    );
  };

  return (
    <ModalOverlay onClose={onCancel}>
      <div className="modal scanPreviewModal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, "scanPreviewTitle")}</h3>
        <p className="fieldHint">{t(language, "scanPreviewSummary")}</p>
        <div className="scanPreviewToolbar">
          <Button onClick={() => setAllSelected(true)}>{t(language, "scanSelectAll")}</Button>
          <Button onClick={() => setAllSelected(false)}>{t(language, "scanDeselectAll")}</Button>
          <span className="summary">
            {selectedCount} / {preview.changes.length}
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
                <div
                  key={change.id}
                  className="scanChangeRow"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(change.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(change.id);
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[change.id]}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggle(change.id)}
                  />
                  <span className="scanChangeId">{change.artist_id}</span>
                  <div className="scanChangeMain">{renderDetail(change)}</div>
                  <button
                    type="button"
                    className="button quiet scanOpenArtistButton"
                    title={t(language, "openArtistPage")}
                    aria-label={t(language, "openArtistPage")}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openArtist(change.artist_id);
                    }}
                  >
                    <ExternalLink size={14} />
                    <span className="srOnly">{t(language, "openArtistPage")}</span>
                  </button>
                </div>
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
