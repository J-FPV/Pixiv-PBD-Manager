import { ExternalLink, FolderOpen, Plus, RefreshCw, Check } from "lucide-react";
import { useState } from "react";
import { runGuiApi } from "../api";
import { t } from "../i18n";
import type { AppSettings, Language } from "../types";
import type { ReviewItem } from "../types.review";
import { Button } from "./Button";
import { ModalOverlay } from "./ModalOverlay";
import { SimilarThumbnail } from "./SimilarThumbnail";
import { ImagePreviewModal } from "./ImagePreviewModal";

export function ReviewEvidence({ item, language, settings, busy, close, act, openPath, taskError, progress, cancel }: {
  item: ReviewItem; language: Language; settings: AppSettings; busy: boolean; close: () => void;
  act: (command: "retry" | "sample" | "apply") => void; openPath: (path: string) => void;
  taskError: string; progress: string; cancel: () => void;
}) {
  const [preview, setPreview] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const candidates = [...new Map(item.candidates.map((candidate) => [candidate.artist_id, candidate])).values()];
  const queries = new Map(item.queries.map((query) => [query.pid, query]));
  const pids = [...new Set([...queries.keys(), ...Object.keys(item.samples || {}).slice(0, 5)])];
  const open = (url: string) => void runGuiApi("browser.open", { ...settings, urls: [url] }).catch((err) => setError(String(err)));
  const source = (value: string) => t(language, value.includes("local_save_path") ? "reviewLocalPath" : value.includes("local_work_id") ? "reviewLocalPid"
    : value.includes("local_exact_name") ? "reviewLocalName" : value.includes("fuzzy") ? "reviewSearch"
      : value.includes("online") || value.includes("resolved_by_work") ? "reviewOnline" : "reviewFolder");
  return <>
    <ModalOverlay onClose={close}><div className="modal reviewModal" role="dialog" aria-label={t(language, "reviewDetails")}>
      <h3>{t(language, "reviewDetails")}</h3>
      <div className="reviewPath">{item.path}</div>
      <div className="reviewBody">
        {item.status === "conflict" && <p role="alert">{t(language, "reviewMixed")}</p>}
        {item.stale && <p>{t(language, "reviewStale")}</p>}{item.unavailable && <p>{t(language, "reviewUnavailable")}</p>}
        {(error || taskError) && <p role="alert">{error || taskError}</p>}
        {candidates.map((candidate) => <div className="reviewCandidate" key={candidate.artist_id}>
          <Button icon={<ExternalLink size={16} />} onClick={() => open(`https://www.pixiv.net/users/${candidate.artist_id}`)}>{candidate.name || candidate.artist_id} ({candidate.artist_id})</Button>
          <span>{source(candidate.source)}</span>
        </div>)}
        <p>{t(language, "reviewUpdated")}: {new Date(item.updated_at * 1000).toLocaleString()}</p>
        <h4>{t(language, "reviewQueries")}</h4>
        <p>{t(language, "reviewBudget").replace("{count}", String(queries.size))}</p>
        {pids.map((pid) => {
          const query = queries.get(pid), path = item.samples?.[pid];
          return <div className="reviewSample" key={pid}>
            {path && <SimilarThumbnail language={language} path={path} onPreview={setPreview} />}
            <div><Button icon={<ExternalLink size={14} />} onClick={() => open(`https://www.pixiv.net/artworks/${pid}`)}>{pid}</Button>
              <p>{t(language, query?.status === "resolved" ? "reviewResolved" : query?.status === "failed" ? "reviewFailed" : query?.status === "empty" ? "reviewEmpty" : "reviewPending")}{query?.name ? `: ${query.name} (${query.artist_id})` : ""}</p>
              {query?.error && <p>{query.error}</p>}
              {path && <Button icon={<FolderOpen size={14} />} onClick={() => openPath(path)}>{t(language, "openLocation")}</Button>}
            </div>
          </div>;
        })}
        {!pids.length && <p>{t(language, "reviewNoSamples")}</p>}
        {!pids.length && item.sample_paths?.map((path) => <div className="reviewSample" key={path}>
          <SimilarThumbnail language={language} path={path} onPreview={setPreview} />
          <Button icon={<FolderOpen size={14} />} onClick={() => openPath(path)}>{t(language, "openLocation")}</Button>
        </div>)}
      </div>
      {confirm && <p role="alert">{t(language, "reviewApplyConfirm")} {candidates[0]?.name} ({candidates[0]?.artist_id})</p>}
      <div className="modalActions reviewActions">
        {progress && <span role="status">{progress}</span>}
        {busy && <Button onClick={cancel}>{t(language, "cancel")}</Button>}
        <Button icon={<RefreshCw size={16} />} disabled={busy} onClick={() => act("retry")}>{t(language, "reviewRefresh")}</Button>
        <Button icon={<Plus size={16} />} disabled={busy || queries.size >= 30 || !settings.resolve_online} onClick={() => act("sample")}>{t(language, "reviewSample")}</Button>
        <Button icon={<Check size={16} />} variant="primary" disabled={busy || item.stale || item.unavailable || item.status !== "awaiting_confirmation"} onClick={() => confirm ? act("apply") : setConfirm(true)}>{t(language, confirm ? "ok" : "reviewApply")}</Button>
        <Button onClick={close}>{t(language, "close")}</Button>
      </div>
    </div></ModalOverlay>
    {preview && <ImagePreviewModal language={language} path={preview} entries={[]} onClose={() => setPreview("")} revealFile={openPath} />}
  </>;
}
