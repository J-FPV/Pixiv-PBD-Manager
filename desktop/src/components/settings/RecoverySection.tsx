import { useEffect, useState } from "react";
import { Archive, Download, FolderOpen, RefreshCw, RotateCcw, Trash2, Upload, Undo2 } from "lucide-react";
import { browsePath, runGuiApi } from "../../api";
import { t } from "../../i18n";
import type { ConfirmState, Language } from "../../types";
import type { BackupCategory, BackupEntry, RestorePreview } from "../../types.recovery";
import { useRecoveryContext } from "../../hooks/RecoveryContext";
import { categoryLabel, historyLabel, operationLabel, recoveryValue } from "../../utils/recoveryLabels";
import { ConfirmModal } from "../ConfirmModal";
import { ModalOverlay } from "../ModalOverlay";

function BackupRows({ language, restore, confirm }: {
  language: Language; restore: (entry: BackupEntry) => void; confirm: (state: ConfirmState) => void;
}) {
  const recovery = useRecoveryContext()!;
  const exportBackup = (entry: BackupEntry) => confirm({ title: t(language, "backupExport"), body: t(language, "backupPrivacy"),
    confirmLabel: t(language, "backupExport"), onConfirm: async () => {
      const path = await browsePath("save");
      if (path) await recovery.run("backup.export", { id: entry.id, path });
    } });
  return <div className="recoveryTableScroll"><table className="recoveryTable">
    <thead><tr><th>{t(language, "backupRecovery")}</th><th>{t(language, "backupChanged")}</th><th>{t(language, "backupResult")}</th><th /></tr></thead>
    <tbody>{recovery.backups.backups.map((entry) => <tr key={entry.id}>
      <td><strong>{operationLabel(language, entry.reason)}</strong><div className="muted">{new Date(entry.created).toLocaleString()}</div></td>
      <td>{entry.categories.map((category) => categoryLabel(language, category)).join(" · ")}<div className="muted">{(entry.size / 1024).toFixed(1)} KiB</div></td>
      <td>{t(language, entry.available ? "backupReady" : "backupUnavailable")}</td>
      <td><div className="recoveryRowActions">
        <button className="button" title={t(language, "backupPreview")} disabled={recovery.busy || !entry.available} onClick={() => restore(entry)}><RotateCcw size={16} /></button>
        <button className="button" title={t(language, "backupExport")} disabled={recovery.busy || !entry.available} onClick={() => exportBackup(entry)}><Download size={16} /></button>
        <button className="button danger" title={t(language, "delete")} disabled={recovery.busy} onClick={() => confirm({
          title: t(language, "delete"), body: t(language, "backupDeleteConfirm"), confirmLabel: t(language, "delete"),
          onConfirm: async () => { await recovery.run("backup.delete", { id: entry.id }); }
        })}><Trash2 size={16} /></button>
      </div></td>
    </tr>)}</tbody>
  </table>{!recovery.backups.backups.length ? <p className="muted">{t(language, "backupEmpty")}</p> : null}</div>;
}

function HistoryRows({ language, confirm }: { language: Language; confirm: (state: ConfirmState) => void }) {
  const recovery = useRecoveryContext()!;
  return <section className="recoveryHistory"><h3>{t(language, "recoveryHistory")}</h3>
    <div className="recoveryTableScroll"><table className="recoveryTable"><tbody>
      {recovery.history.entries.map((entry) => <tr key={entry.id}>
        <td><strong>{operationLabel(language, entry.command)} ({entry.count})</strong><div className="muted">{new Date(entry.created).toLocaleString()}</div></td>
        <td>{historyLabel(language, entry.state)}</td>
        <td><div className="recoveryRowActions">
          <button className="button" disabled={entry.id !== recovery.history.latest_id || recovery.busy || recovery.taskBusy}
            title={t(language, "recoveryUndo")} onClick={() => void recovery.undo(entry.id)}><Undo2 size={16} /></button>
          <button className="button" disabled={entry.id !== recovery.history.latest_id || recovery.busy}
            title={t(language, "recoveryDiscard")} onClick={() => confirm({ title: t(language, "recoveryDiscard"),
              body: t(language, "recoveryDiscardConfirm"), confirmLabel: t(language, "recoveryDiscard"),
              onConfirm: async () => { await recovery.run("history.discard", { id: entry.id }); }
            })}><Trash2 size={16} /></button>
        </div></td>
      </tr>)}
    </tbody></table></div>
    {!recovery.history.entries.length ? <p className="muted">{t(language, "recoveryHistoryEmpty")}</p> : null}
  </section>;
}

function RestoreDialog({ language, entry, close }: { language: Language; entry: BackupEntry; close: () => void }) {
  const recovery = useRecoveryContext()!;
  const [categories, setCategories] = useState<BackupCategory[]>(entry.categories);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const restore = async () => {
    await recovery.run("backup.restore", { id: entry.id, categories, token: preview?.token }, true);
  };
  return <ModalOverlay onClose={() => { if (!recovery.busy) close(); }}>
    <div className="modal recoveryRestoreModal" onClick={(event) => event.stopPropagation()}>
      <h3>{t(language, "backupPreview")}</h3>
      <div className="recoveryCategories">{entry.categories.map((category) => <label key={category}>
        <input type="checkbox" checked={categories.includes(category)} disabled={recovery.busy} onChange={(event) => {
          setCategories(event.target.checked ? [...categories, category] : categories.filter((item) => item !== category)); setPreview(null);
        }} />{categoryLabel(language, category)}
      </label>)}</div>
      {preview ? <div className="recoveryPreviewBody">
        <p>{new Date(preview.created).toLocaleString()}</p>
        {preview.changes.map((item) => <p key={item.category}>
          <strong>{categoryLabel(language, item.category)}</strong>: {t(language, "backupChanged")} {item.changed}
          {item.unlinked ? ` · ${t(language, "backupUnlinked")} ${item.unlinked}` : ""}
          {item.damaged ? ` · ${t(language, "recoveryDamaged")}` : ""}
        </p>)}
        {preview.invalid_paths.length ? <details><summary>{t(language, "backupInvalidPaths")} ({preview.invalid_paths.length})</summary>
          {preview.invalid_paths.map((path) => <div className="pathText" key={path}>{path}</div>)}
        </details> : null}
        {preview.details?.length ? <details><summary>{t(language, "backupDetails")} ({preview.details.length})</summary>
          {preview.details.map((item, index) => <div className="recoveryDifference" key={index}>
            <strong>{categoryLabel(language, item.category)} · {item.label}</strong>
            <div className="recoveryComparison">
              <div><span className="muted">{t(language, "backupBefore")}</span><pre>{recoveryValue(language, item.before)}</pre></div>
              <div><span className="muted">{t(language, "backupAfter")}</span><pre>{recoveryValue(language, item.after)}</pre></div>
            </div>
          </div>)}
        </details> : null}
        <p className="hint">{t(language, "backupConfirm")}</p>
      </div> : null}
      {recovery.error ? <p className="recoveryInlineError" role="alert">{recovery.error}</p> : null}
      <div className="modalActions">
        <button className="button" onClick={recovery.busy ? recovery.cancel : close}>{t(language, recovery.busy ? "backupCancel" : "cancel")}</button>
        {preview ? <button className="button danger" disabled={recovery.busy || recovery.taskBusy} onClick={() => setConfirm({
          title: t(language, "restore"), body: t(language, "backupConfirm"), confirmLabel: t(language, "restore"), onConfirm: restore
        })}>{t(language, "restore")}</button> : <button className="button primary" disabled={recovery.busy || !categories.length}
          onClick={async () => setPreview(await recovery.run<RestorePreview>("backup.preview", { id: entry.id, categories }))}>{t(language, "backupPreview")}</button>}
      </div>
      {confirm ? <ConfirmModal language={language} state={confirm} onClose={() => setConfirm(null)} /> : null}
    </div>
  </ModalOverlay>;
}

export function RecoverySection({ language }: { language: Language }) {
  const recovery = useRecoveryContext();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [restore, setRestore] = useState<BackupEntry | null>(null);
  useEffect(() => { void recovery?.refresh().catch((error) => recovery.setError(String(error))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!recovery) return null;
  return <section className="recoverySection">
    <h3>{t(language, "backupRecovery")}</h3>
    <div className="recoveryToolbar">
      <button className="button primary" disabled={recovery.busy || recovery.taskBusy} onClick={() => void recovery.run("backup.create")}><Archive size={16} />{t(language, "backupNow")}</button>
      <button className="button" disabled={recovery.busy} onClick={async () => {
        const path = await browsePath("file"); if (path) await recovery.run("backup.import", { path });
      }}><Upload size={16} />{t(language, "backupImport")}</button>
      <button className="button" disabled={!recovery.backups.directory} title={t(language, "openFolder")}
        onClick={() => void runGuiApi("file.reveal", { path: recovery.backups.directory }).catch((error) => recovery.setError(String(error)))}><FolderOpen size={16} /></button>
      <button className="button" disabled={recovery.busy} title={t(language, "refresh")}
        onClick={() => void recovery.refresh().catch((error) => recovery.setError(String(error)))}><RefreshCw size={16} /></button>
    </div>
    {recovery.busy ? <div className="recoveryToolbar"><span role="status">{t(language, "recoveryRunning")}</span>
      <button className="button" onClick={recovery.cancel}>{t(language, "backupCancel")}</button></div> : null}
    <BackupRows language={language} restore={setRestore} confirm={setConfirm} />
    <HistoryRows language={language} confirm={setConfirm} />
    {confirm ? <ConfirmModal language={language} state={confirm} onClose={() => setConfirm(null)} /> : null}
    {restore ? <RestoreDialog language={language} entry={restore} close={() => setRestore(null)} /> : null}
  </section>;
}
