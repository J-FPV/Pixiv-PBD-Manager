import { useState } from "react";
import { Folder, Pencil, Plus, Trash2, WandSparkles, X } from "lucide-react";
import { t } from "../../i18n";
import type { CollectionsController } from "../../hooks/useCollections";
import type { Language, LibraryFilters, LibrarySort } from "../../types";
import type { ImageCollection } from "../../types.collections";
import { ModalOverlay } from "../ModalOverlay";
import { Button } from "../Button";

export function CollectionsPane({ language, controller: c, filters, sort, setFilters }: {
  language: Language; controller: CollectionsController; filters: LibraryFilters; sort: LibrarySort; setFilters: (filters: LibraryFilters) => void;
}) {
  const [dialog, setDialog] = useState<{ mode: "create" | "rename" | "delete"; kind: ImageCollection["kind"]; id?: string; revision?: string } | null>(null);
  const [name, setName] = useState("");
  const open = (mode: "rename" | "delete", item: ImageCollection) => { setName(item.name); setDialog({ mode, kind: item.kind, id: item.id, revision: item.revision }); };
  const submit = async () => {
    if (!dialog) return;
    const result = dialog.mode === "create" ? await c.create(dialog.kind, name, filters, sort)
      : await c.run(`collections.${dialog.mode === "delete" ? "delete" : "update"}`, { id: dialog.id, revision: dialog.revision, name });
    if (result) setDialog(null);
  };
  return <div className="collectionsPane">
    <button className={`collectionRow ${!c.chosen ? "active" : ""}`} onClick={() => void c.select("")}>{t(language, "collectionAll")}</button>
    {(["smart", "project"] as const).map((kind) => <section key={kind}>
      <div className="collectionHeading"><strong>{t(language, kind === "smart" ? "smartCollections" : "projectCollections")}</strong><button className="button iconOnly quiet" title={t(language, "collectionCreate")} onClick={() => { setName(""); setDialog({ mode: "create", kind }); }}><Plus size={15} /></button></div>
      {c.data.collections.filter((item) => item.kind === kind).map((item) => <div className="collectionLine" key={item.id}>
        <button className={`collectionRow ${c.selectedId === item.id ? "active" : ""}`} title={item.name} disabled={c.busy} onClick={() => void c.select(item.id)}>{kind === "smart" ? <WandSparkles size={14} /> : <Folder size={14} />}<span>{item.name}</span>{kind === "project" && <small>{item.member_count}</small>}</button>
        <button className="button iconOnly quiet" title={t(language, "collectionRename")} onClick={() => open("rename", item)}><Pencil size={13} /></button>
        <button className="button iconOnly quiet" title={t(language, "collectionDelete")} onClick={() => open("delete", item)}><Trash2 size={13} /></button>
      </div>)}
    </section>)}
    <div className="collectionConditions">
      <label><input type="checkbox" checked={Boolean(filters.not_used)} onChange={(event) => setFilters({ ...filters, not_used: event.target.checked })} />{t(language, "collectionNotUsed")}</label>
      <label><input type="checkbox" checked={Boolean(filters.added_within_days)} onChange={(event) => setFilters({ ...filters, added_within_days: event.target.checked ? 30 : null })} />{t(language, "collectionRecent")}</label>
      {filters.added_within_days && <label><input aria-label={t(language, "collectionDays")} type="number" min={1} max={36500} value={filters.added_within_days} onChange={(event) => setFilters({ ...filters, added_within_days: Math.max(1, Math.min(36500, Number(event.target.value) || 30)) })} />{t(language, "collectionDays")}</label>}
    </div>
    {c.chosen?.kind === "smart" && <Button disabled={c.busy} onClick={() => void c.update(filters, sort)}>{t(language, "collectionUpdate")}</Button>}
    {c.error && <p role="alert">{c.error}</p>}
    {dialog && <ModalOverlay onClose={() => setDialog(null)}><div className="modal" role="dialog" aria-label={t(language, dialog.mode === "delete" ? "collectionDelete" : "collectionName")}>
      <h3>{t(language, dialog.mode === "create" ? "collectionCreate" : dialog.mode === "rename" ? "collectionRename" : "collectionDelete")}</h3>
      {dialog.mode === "delete" ? <p>{t(language, "collectionDeleteConfirm")} {name}</p> : <label>{t(language, "collectionName")}<input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>}
      {c.error && <p role="alert">{c.error}</p>}
      <div className="modalActions"><Button icon={<X size={14} />} onClick={() => setDialog(null)}>{t(language, "cancel")}</Button><Button variant={dialog.mode === "delete" ? "danger" : "primary"} disabled={c.busy || !name.trim()} onClick={() => void submit()}>{t(language, "ok")}</Button></div>
    </div></ModalOverlay>}
  </div>;
}
