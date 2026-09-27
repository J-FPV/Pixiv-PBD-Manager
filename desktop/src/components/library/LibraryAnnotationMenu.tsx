import { useEffect, useRef, useState } from "react";
import { History, MoreHorizontal, ShieldCheck } from "lucide-react";
import { t } from "../../i18n";
import type { AnnotationStatus, Language } from "../../types";
import { RecoveryUndo } from "../RecoveryUndo";

export function LibraryAnnotationMenu({ language, status, busy, onRecover, onProtect }: {
  language: Language; status: AnnotationStatus | null; busy: boolean;
  onRecover: () => void; onProtect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const statusText = status ? Object.entries(status).reduce((text, [key, value]) =>
    text.replace(`{${key}}`, String(value)), t(language, "annotationStatus")) : "";
  return <div className="toolbarMenuWrap" ref={menu} onKeyDown={(event) => {
    if (event.key === "Escape") setOpen(false);
  }}>
    <button type="button" className="button toolbarMenuButton" aria-expanded={open} onClick={() => setOpen(!open)}>
      <MoreHorizontal size={16} />
      {t(language, "moreActions")}{status?.unlinked ? ` (${status.unlinked})` : ""}
    </button>
    {open ? <div className="toolbarDropdown alignRight">
      <RecoveryUndo language={language} />
      {status ? <div className="annotationStatus muted">{statusText}</div> : null}
      <button type="button" onClick={() => { setOpen(false); onRecover(); }}>
        <History size={15} />{t(language, "annotationRecovery")}{status ? ` (${status.unlinked})` : ""}
      </button>
      <button type="button" disabled={busy || !status || !(status.pending || status.errors)}
        onClick={() => { setOpen(false); onProtect(); }}>
        <ShieldCheck size={15} />{t(language, "resumeProtection")}
      </button>
    </div> : null}
  </div>;
}
