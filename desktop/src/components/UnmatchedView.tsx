import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { UserPlus, XCircle, ListFilter, RefreshCw, Search } from "lucide-react";
import { runGuiApi } from "../api";
import { UNMATCHED_COL_WIDTHS_KEY } from "../constants";
import { useColumnWidths } from "../hooks/useColumnWidths";
import type { ColumnDef } from "../hooks/useColumnWidths";
import { t } from "../i18n";
import type { AppSettings, Artist, Language, UnmatchedFolder } from "../types";
import type { ReviewItem } from "../types.review";
import { Button } from "./Button";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { ReviewEvidence } from "./ReviewEvidence";

const STATUS_KEYS = { no_clues: "reviewNoClues", pending: "reviewPending", query_failed: "reviewFailed", conflict: "reviewConflict", awaiting_confirmation: "reviewConfirm" } as const;
type Column = "path" | "status" | "count" | "actions";
const COLUMNS: ColumnDef<Column>[] = [{ key: "path", flex: true }, { key: "status", width: 185 }, { key: "count", width: 75 }, { key: "actions", width: 148 }];

export function UnmatchedView({ language, folders, settings, pendingExclude, excludeFolder, assignFolder, openPath, onArtists }: {
  language: Language; folders: UnmatchedFolder[]; settings: AppSettings; pendingExclude: Set<string>;
  excludeFolder: (path: string) => void; assignFolder: (path: string) => void; openPath: (path: string) => void;
  onArtists: (artists: Artist[]) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState<ReviewItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const deferredQuery = useDeferredValue(query.toLocaleLowerCase());
  const legacy = useRef(folders);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const result = await runGuiApi<{ items: ReviewItem[] }>("scan.review.list", { ...settings, legacy_folders: legacy.current });
    setItems(result.items); setLoading(false);
  }, [settings]);
  useEffect(() => {
    void load().catch((err) => { setError(String(err)); setLoading(false); });
    const refresh = (event: Event) => {
      const command = (event as CustomEvent).detail?.command as string;
      if (event.type === "pbd-library-sync" || ["artists.assign_folder", "scan.apply", "settings.save"].includes(command)) void load().catch((err) => setError(String(err)));
    };
    window.addEventListener("pbd-api-result", refresh);
    window.addEventListener("pbd-library-sync", refresh);
    return () => { window.removeEventListener("pbd-api-result", refresh); window.removeEventListener("pbd-library-sync", refresh); };
  }, [load]);
  const filtered = useMemo(() => items.filter((item) => (!status || item.status === status) && (!deferredQuery || `${item.path} ${item.candidates.map((c) => `${c.name} ${c.artist_id}`).join(" ")}`.toLocaleLowerCase().includes(deferredQuery))), [items, status, deferredQuery]);
  const virtualizer = useVirtualizer({ count: filtered.length, getScrollElement: () => parentRef.current, estimateSize: () => 48, overscan: 14 });
  const { gridTemplate, leftHandle, rightHandle, overlay } = useColumnWidths<Column>(UNMATCHED_COL_WIDTHS_KEY, COLUMNS);
  const show = async (path: string) => {
    setBusy(true); setError("");
    try { setDetail(await runGuiApi<ReviewItem>("scan.review.detail", { ...settings, path })); }
    catch (err) { setError(String(err)); } finally { setBusy(false); }
  };
  const act = async (command: "retry" | "sample" | "apply", paths?: string[]) => {
    setBusy(true); setError("");
    const abort = new AbortController();
    controller.current = command === "apply" ? null : abort;
    try {
      const result = await runGuiApi<{ artists?: Artist[] }>(`scan.review.${command}`, { ...settings, path: detail?.path, revision: detail?.revision, paths }, (event) => {
        if (event.type === "progress") { const p = event.payload as { current?: number; total?: number; pid?: string }; if (p.current !== undefined) setProgress(`${p.current} / ${p.total ?? ""} · ${p.pid ?? ""}`); }
      }, { signal: abort.signal, gracefulCancel: true });
      if (result.artists) onArtists(result.artists);
      await load();
      if (command === "apply") setDetail(null);
      else if (detail && !paths) setDetail(await runGuiApi<ReviewItem>("scan.review.detail", { ...settings, path: detail.path }));
    } catch (err) { setError(String(err)); } finally { setBusy(false); controller.current = null; setProgress(""); }
  };
  return <section className="panel reviewPanel">
    <div className="toolbar reviewToolbar">
      <label className="searchBox"><Search size={16} /><input aria-label={t(language, "search")} placeholder={t(language, "search")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select aria-label={t(language, "reviewAll")} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t(language, "reviewAll")}</option>{Object.entries(STATUS_KEYS).map(([key, label]) => <option key={key} value={key}>{t(language, label)}</option>)}</select>
      <Button icon={<RefreshCw size={16} />} disabled={busy || !settings.resolve_online || !items.some((item) => item.status === "query_failed")} onClick={() => void act("retry", items.filter((item) => item.status === "query_failed").map((item) => item.path))}>{t(language, "reviewRetry")}</Button>
      <span className="summary">{filtered.length} / {items.length}</span>
      {busy && <Button onClick={() => controller.current?.abort()}>{t(language, "cancel")}</Button>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="table unmatchedTable" style={{ "--cols": gridTemplate } as CSSProperties}>
      <div className="tableHeader">{COLUMNS.map(({ key }) => <span className="headerCell" key={key}><ColumnResizeHandle handle={leftHandle(key)} side="left" /><span>{t(language, key === "count" ? "unmatchedCount" : key === "status" ? "backupResult" : key)}</span><ColumnResizeHandle handle={rightHandle(key)} side="right" /></span>)}</div>
      <div className="virtualList" ref={parentRef}>
        {filtered.length ? <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{virtualizer.getVirtualItems().map((row) => {
          const item = filtered[row.index], disabled = busy || pendingExclude.has(item.path);
          return <div className="tableRow unmatchedRow reviewRow" key={item.path} style={{ transform: `translateY(${row.start}px)`, height: 48 }}>
            <span className="pathText clickablePath" title={item.path} onDoubleClick={() => openPath(item.path)}>{item.path}</span>
            <span className="reviewStatus" title={item.unavailable ? t(language, "reviewUnavailable") : item.stale ? t(language, "reviewStale") : undefined}>{t(language, STATUS_KEYS[item.status])}{(item.stale || item.unavailable) ? " *" : ""}</span>
            <span className="numeric">{item.count}</span>
            <span className="unmatchedActions">
              <Button iconOnly icon={<ListFilter size={16} />} title={t(language, "reviewDetails")} disabled={disabled} onClick={() => void show(item.path)}>{t(language, "reviewDetails")}</Button>
              <Button iconOnly icon={<UserPlus size={16} />} title={t(language, "assignArtist")} disabled={disabled} onClick={() => assignFolder(item.path)}>{t(language, "assignArtist")}</Button>
              <Button iconOnly icon={<XCircle size={16} />} title={t(language, "excludeFolder")} variant="danger" disabled={disabled} onClick={() => excludeFolder(item.path)}>{t(language, "excludeFolder")}</Button>
            </span>
          </div>;
        })}</div> : <div className="emptyState">{t(language, loading ? "reviewLoading" : "unmatchedHint")}</div>}
      </div>
    </div>{overlay}
    {detail && <ReviewEvidence key={detail.revision} item={detail} language={language} settings={settings} busy={busy} close={() => setDetail(null)} act={(command) => void act(command)} openPath={openPath} taskError={error} progress={progress} cancel={() => controller.current?.abort()} />}
  </section>;
}
