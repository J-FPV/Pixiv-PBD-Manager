import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Star, X } from "lucide-react";
import { runGuiApi } from "../../api";
import { t } from "../../i18n";
import { useAnnotationRecoveryList } from "../../hooks/useAnnotationRecoveryList";
import type { AnnotationRelinkResult, Language, LibraryImage } from "../../types";
import { Button } from "../Button";
import { ConfirmModal } from "../ConfirmModal";
import { ModalOverlay } from "../ModalOverlay";

export function AnnotationRecoveryModal({ language, images, onClose, onRecovered }: {
  language: Language; images: LibraryImage[]; onClose: () => void; onRecovered: () => Promise<void>;
}) {
  const { query, setQuery, page, setPage, data, loading, error, setError, refresh } = useAnnotationRecoveryList();
  const [selected, setSelected] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<AnnotationRelinkResult>();
  const source = data?.entries.find((entry) => entry.image_id === selected);
  const candidates = useMemo(() => {
    const keyword = targetQuery.trim().toLocaleLowerCase();
    const suggestions = new Set(source?.candidate_ids);
    return images.filter((image) => image.image_id && image.annotation_revision === 0 &&
      (!keyword || image.path.toLocaleLowerCase().includes(keyword)))
      .sort((a, b) => Number(suggestions.has(b.image_id)) - Number(suggestions.has(a.image_id)))
      .slice(0, 50);
  }, [images, targetQuery, source]);
  const target = candidates.find((image) => image.image_id === targetId);
  const recover = async (confirmed = false, hash?: string) => {
    if (!source || !target) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await runGuiApi<AnnotationRelinkResult>("library.annotations.relink", {
        image_id: source.image_id, annotation_revision: source.annotation_revision,
        target_id: target.image_id, confirm_unverified: confirmed, confirmed_sha256: hash
      });
      if (result.confirmation_required) setConfirmation(result);
      else {
        await onRecovered();
        setSelected(""); setTargetId(""); refresh();
        setMessage(t(language, "annotationRecovered"));
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };
  return <>
    <ModalOverlay onClose={close}>
      <section className="modal annotationRecoveryModal" role="dialog" aria-modal="true"
        aria-label={t(language, "annotationRecovery")}>
        <header className="annotationRecoveryHeader">
          <h3>{t(language, "annotationRecovery")}{data ? ` (${data.total})` : ""}</h3>
          <Button icon={<X size={18} />} iconOnly title={t(language, "close")} onClick={close} disabled={busy}>
            {t(language, "close")}</Button>
        </header>
        <div className="annotationRecoveryBody">
          <div className="annotationSources">
            <input aria-label={t(language, "annotationOldSearch")} placeholder={t(language, "annotationOldSearch")}
              value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            <div className="annotationSourceList" aria-busy={loading}>
              {loading ? <p className="muted">{t(language, "loadingLibrary")}</p> : data?.entries.length ?
                data.entries.map((entry) => <button type="button" key={entry.image_id} disabled={busy}
                  className={`annotationSource${entry.image_id === selected ? " selected" : ""}`}
                  aria-pressed={entry.image_id === selected}
                  onClick={() => { setSelected(entry.image_id); setTargetId(""); setConfirmation(undefined); }}>
                  <span>{entry.old_path}</span>
                  <small className="muted">{t(language, entry.reason === "missing" ? "annotationMissing" :
                    entry.reason === "changed" ? "annotationChanged" : "annotationUnverified")}</small>
                </button>) : <p className="muted">{t(language, "annotationEmpty")}</p>}
            </div>
            <div className="annotationPagination">
              <Button icon={<ChevronLeft size={16} />} iconOnly title={t(language, "previousPage")}
                disabled={busy || loading || page <= 1} onClick={() => setPage(page - 1)}>{t(language, "previousPage")}</Button>
              <span>{page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 50))}</span>
              <Button icon={<ChevronRight size={16} />} iconOnly title={t(language, "nextPage")}
                disabled={busy || loading || page * 50 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>{t(language, "nextPage")}</Button>
            </div>
          </div>
          <div className="annotationTargetPane">
            {source ? <>
              <p className="annotationPath">{source.old_path}</p>
              <p className="muted">{t(language, source.verified ? "annotationVerified" : "annotationUnverified")}</p>
              <div className="annotationValues">
                {source.favorite ? <Star size={16} fill="currentColor" /> : null}
                <span>{source.rating} / 5</span><span>{source.tags.join(", ")}</span>
                <span>{source.markers.map((marker) => t(language, marker === "high_value" ? "markerHighValue" :
                  marker === "used" ? "markerUsed" : "markerToSort")).join(", ")}</span>
              </div>
              {source.error ? <p className="annotationError">{source.error}</p> : null}
              <label htmlFor="annotationTargetSearch">{t(language, "annotationTarget")}</label>
              <input id="annotationTargetSearch" value={targetQuery} disabled={busy}
                placeholder={t(language, "annotationTargetSearch")}
                onChange={(event) => { setTargetQuery(event.target.value); setTargetId(""); }} />
              <select size={6} aria-label={t(language, "annotationTarget")} value={target?.image_id ?? ""}
                disabled={busy} onChange={(event) => setTargetId(event.target.value)}>
                {candidates.map((image) => <option key={image.image_id} value={image.image_id}>{image.path}</option>)}
              </select>
              {!candidates.length ? <p className="muted">{t(language, "annotationNoTargets")}</p> : null}
              {target ? <p className="annotationPath">{target.path}</p> : null}
            </> : <p className="muted">{t(language, "annotationChoose")}</p>}
          </div>
        </div>
        {error ? <p role="alert" className="annotationError">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <footer className="modalActions">
          <Button onClick={close} disabled={busy}>{t(language, "close")}</Button>
          <Button icon={<RotateCcw size={16} />} variant="primary" onClick={() => void recover()}
            disabled={busy || loading || !source || !target}>{t(language, "annotationRecover")}</Button>
        </footer>
      </section>
    </ModalOverlay>
    {confirmation ? <ConfirmModal language={language} onClose={() => setConfirmation(undefined)} state={{
      title: t(language, "annotationConfirmTitle"),
      body: `${t(language, confirmation.reason === "content_mismatch" ? "annotationConfirmMismatch" : "annotationConfirmUnknown")}\n\n${target?.path ?? ""}`,
      confirmLabel: t(language, "annotationRecover"), onConfirm: () => recover(true, confirmation.target_sha256)
    }} /> : null}
  </>;
}
