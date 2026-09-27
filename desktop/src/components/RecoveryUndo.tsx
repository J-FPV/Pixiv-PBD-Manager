import { Undo2, X } from "lucide-react";
import { t } from "../i18n";
import type { Language } from "../types";
import { useRecoveryContext } from "../hooks/RecoveryContext";
import { operationLabel } from "../utils/recoveryLabels";

export function RecoveryUndo({ language }: { language: Language }) {
  const recovery = useRecoveryContext();
  if (!recovery) return null;
  const entry = recovery.history.entries.find((row) => row.id === recovery.history.latest_id);
  return <button type="button" disabled={!entry || recovery.busy || recovery.taskBusy} onClick={() => void recovery.undo()}>
    <Undo2 size={15} /><span>{t(language, "recoveryUndo")}{entry ? `: ${operationLabel(language, entry.command)}` : ""}</span>
  </button>;
}
export function RecoveryNotice({ language }: { language: Language }) {
  const recovery = useRecoveryContext();
  if (!recovery) return null;
  return <>
    {recovery.backups.warning || recovery.error ? <div className="recoveryWarning" role="alert">
      <span>{recovery.error || recovery.backups.warning}</span>
      {recovery.error ? <button type="button" title={t(language, "close")} onClick={() => recovery.setError("")}><X size={16} /></button> : null}
    </div> : null}
    {recovery.quickUndo ? <div className="recoveryToast" role="status">
      <span>{t(language, "recoveryEdited")}</span><RecoveryUndo language={language} />
      <button type="button" title={t(language, "recoveryDismiss")} onClick={() => recovery.setQuickUndo(null)}><X size={16} /></button>
    </div> : null}
  </>;
}
