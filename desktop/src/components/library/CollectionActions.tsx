import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Grip, Plus, Minus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useFileDrag } from "../../hooks/useFileDrag";
import { useLibraryFilter } from "../../hooks/useLibraryFilter";
import { useCollectionAvailability } from "../../hooks/useCollectionAvailability";
import { EMPTY_LIBRARY_FILTERS } from "../../constants";
import { sortLibraryImages } from "../../utils/librarySort";
import type { CollectionsController } from "../../hooks/useCollections";
import type { Language, LibraryImage, LibrarySort } from "../../types";
import { t } from "../../i18n";
import { Button } from "../Button";

const EMPTY_IMAGES: LibraryImage[] = [];
export function CollectionActions({ language, controller: c, selected, images, sort }: {
  language: Language; controller: CollectionsController; selected: LibraryImage[]; images: LibraryImage[]; sort: LibrarySort;
}) {
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [paging, setPaging] = useState({ id: "", page: 0 });
  const [dragging, setDragging] = useState(false);
  const filters = useMemo(() => ({ ...EMPTY_LIBRARY_FILTERS, ...c.chosen?.filters }), [c.chosen?.filters]);
  const { visibleImages: smartImages } = useLibraryFilter(c.chosen?.kind === "smart" ? images : EMPTY_IMAGES, filters, language);
  const smart = useCollectionAvailability(c.chosen?.kind === "smart" ? c.chosen.id : undefined, smartImages);
  const members = c.chosen?.kind === "smart" ? smart.members : c.chosen?.members;
  const paths = useMemo(() => {
    const available = new Set(members?.filter((member) => member.available).map((member) => member.path));
    if (c.chosen?.kind === "smart") return sortLibraryImages(smartImages.filter((image) => available.has(image.path)), c.chosen.sort, language).map((image) => image.path);
    const ordered = sortLibraryImages(images.filter((image) => available.has(image.path)), sort, language).map((image) => image.path);
    for (const path of ordered) available.delete(path);
    return [...ordered, ...[...available].sort()];
  }, [c.chosen, members, smartImages, images, sort, language]);
  const unavailable = members?.filter((member) => !member.available) || [];
  const page = paging.id === c.chosen?.id ? Math.min(paging.page, Math.max(0, Math.ceil(unavailable.length / 20) - 1)) : 0;
  const setPage = (page: number) => setPaging({ id: c.chosen?.id || "", page });
  const drag = useFileDrag(() => {
    if (dragging || !paths.length) return;
    if (paths.length > 1000) { setError(t(language, "collectionLimit")); return; }
    setDragging(true); setError("");
    void invoke("drag_original_files", { paths }).catch((err) => setError(String(err))).finally(() => setDragging(false));
  }, () => { if (paths.length > 1000) setError(t(language, "collectionLimit")); });
  return <div className="collectionActions">
    <div className="collectionActionBar">
      {c.progress && <><span>{c.progress}</span><Button iconOnly icon={<X size={14} />} title={t(language, "cancel")} onClick={c.cancel}>{t(language, "cancel")}</Button></>}
      <select aria-label={t(language, "collectionAdd")} value={target} onChange={(event) => setTarget(event.target.value)}><option value="">{t(language, "projectCollections")}</option>{c.data.collections.filter((item) => item.kind === "project").map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <Button icon={<Plus size={14} />} disabled={c.busy || !target || !selected.length} onClick={() => void c.add(target, selected)}>{t(language, "collectionAdd")}</Button>
      {c.chosen?.kind === "project" && <Button icon={<Minus size={14} />} disabled={c.busy || !selected.length} onClick={() => void c.remove(selected)}>{t(language, "collectionRemove")}</Button>}
      {c.chosen && <><button className="button collectionDrag" disabled={dragging || !paths.length} title={paths.length > 1000 ? t(language, "collectionLimit") : t(language, "collectionDrag")} {...drag}><Grip size={16} />{t(language, "collectionDrag")}</button><span>{t(language, "collectionAvailable")}: {paths.length} · {t(language, "collectionExcluded")}: {unavailable.length}</span></>}
    </div>
    {smart.loading && <span>{t(language, "reviewLoading")}</span>}{(error || smart.error) && <p role="alert">{error || smart.error}</p>}
    {c.chosen?.kind === "project" && !!unavailable.length && <details className="collectionMissing"><summary>{t(language, "collectionUnavailableMembers")} ({unavailable.length})</summary>
      {unavailable.slice(page * 20, (page + 1) * 20).map((member) => <div key={`${member.store_id}:${member.image_id}`}><span title={member.path}>{member.path}</span><span>{t(language, member.status === "quarantined" ? "collectionQuarantined" : member.status === "pending" ? "collectionPending" : member.status === "unavailable" ? "collectionUnavailable" : "collectionMissing")}</span><Button iconOnly icon={<Minus size={14} />} title={t(language, "collectionRemove")} onClick={() => void c.run("collections.members.remove", { id: c.chosen?.id, members: [member] })}>{t(language, "collectionRemove")}</Button></div>)}
      {unavailable.length > 20 && <div><Button iconOnly icon={<ChevronLeft size={16} />} title={t(language, "previousPage")} disabled={!page} onClick={() => setPage(page - 1)}>{t(language, "previousPage")}</Button><span>{page + 1} / {Math.ceil(unavailable.length / 20)}</span><Button iconOnly icon={<ChevronRight size={16} />} title={t(language, "nextPage")} disabled={(page + 1) * 20 >= unavailable.length} onClick={() => setPage(page + 1)}>{t(language, "nextPage")}</Button></div>}
    </details>}
  </div>;
}
