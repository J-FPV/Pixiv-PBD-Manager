import { AlertTriangle, ArrowLeft, CheckCircle2, CircleX, RefreshCw, Stethoscope } from "lucide-react";
import { t } from "../../i18n";
import type { DoctorCheck, DoctorReport, Language } from "../../types";
import { Button } from "../Button";

function checkTitle(language: Language, id: DoctorCheck["id"]): string {
  const keys = {
    database: "doctorDatabase",
    save_paths: "doctorSavePaths",
    path_overlap: "doctorPathOverlap",
    browser_data: "doctorBrowserData",
    quarantine: "doctorQuarantine",
    library_index: "doctorLibraryIndex"
  } as const;
  return t(language, keys[id]);
}

function format(template: string, check: DoctorCheck): string {
  return template
    .replace("{count}", String(check.count ?? 0))
    .replace("{hours}", String(Math.max(0, Math.round((check.age_seconds ?? 0) / 3600))));
}

function checkMessage(language: Language, check: DoctorCheck): string {
  const keys = {
    database_missing: "doctorDatabaseMissing",
    database_invalid: "doctorDatabaseInvalid",
    database_ok: "doctorDatabaseOk",
    save_paths_missing: "doctorSavePathsMissing",
    save_paths_ok: "doctorSavePathsOk",
    path_overlap_found: "doctorPathOverlapFound",
    path_overlap_ok: "doctorPathOverlapOk",
    browser_data_default: "doctorBrowserDefault",
    browser_data_invalid: "doctorBrowserInvalid",
    browser_data_unsafe: "doctorBrowserUnsafe",
    browser_data_ok: "doctorBrowserOk",
    quarantine_missing: "doctorQuarantineMissing",
    quarantine_invalid: "doctorQuarantineInvalid",
    quarantine_unsafe: "doctorQuarantineUnsafe",
    quarantine_not_writable: "doctorQuarantineNotWritable",
    quarantine_ok: "doctorQuarantineOk",
    index_missing: "doctorIndexMissing",
    index_stale: "doctorIndexStale",
    index_ok: "doctorIndexOk"
  } as const;
  const key = keys[check.code as keyof typeof keys];
  return key ? format(t(language, key), check) : check.detail || check.code;
}

function StatusIcon({ status }: { status: DoctorCheck["status"] }) {
  if (status === "ok") return <CheckCircle2 size={20} />;
  if (status === "warning") return <AlertTriangle size={20} />;
  return <CircleX size={20} />;
}

export function LibraryDoctorView({
  language,
  report,
  busy,
  onBack,
  onRun,
  revealFile
}: {
  language: Language;
  report: DoctorReport | null;
  busy: boolean;
  onBack: () => void;
  onRun: () => void;
  revealFile: (path: string) => void;
}) {
  return (
    <section className="panel libraryDoctorPanel">
      <div className="libraryDoctorHeader">
        <Button icon={<ArrowLeft size={16} />} onClick={onBack}>{t(language, "backToLibrary")}</Button>
        <div>
          <h2><Stethoscope size={21} /> {t(language, "libraryDoctor")}</h2>
          <p>{t(language, "libraryDoctorHint")}</p>
        </div>
        <Button icon={<RefreshCw size={16} />} variant="primary" disabled={busy} onClick={onRun}>
          {busy ? t(language, "running") : t(language, report ? "rerunDoctor" : "runDoctor")}
        </Button>
      </div>
      {report ? (
        <>
          <div className="doctorSummary">
            <span className="ok"><CheckCircle2 size={16} />{t(language, "doctorPassed")}: {report.summary.ok}</span>
            <span className="warning"><AlertTriangle size={16} />{t(language, "doctorWarnings")}: {report.summary.warnings}</span>
            <span className="error"><CircleX size={16} />{t(language, "doctorErrors")}: {report.summary.errors}</span>
            <time>{new Date(report.generated_at).toLocaleString()}</time>
          </div>
          <div className="doctorChecks">
            {report.checks.map((check) => (
              <article className={`doctorCheck ${check.status}`} key={check.id}>
                <span className="doctorCheckIcon"><StatusIcon status={check.status} /></span>
                <div className="doctorCheckBody">
                  <strong>{checkTitle(language, check.id)}</strong>
                  <p>{checkMessage(language, check)}</p>
                  {check.detail ? <small>{check.detail}</small> : null}
                  {check.path ? (
                    <button className="doctorPath clickablePath" onDoubleClick={() => check.path && revealFile(check.path)}>
                      {check.path}
                    </button>
                  ) : null}
                  {check.paths?.map((path) => (
                    <button
                      className="doctorPath clickablePath"
                      key={path}
                      onDoubleClick={() => {
                        const parts = path.split(": ");
                        revealFile(parts[parts.length - 1] || path);
                      }}
                    >
                      {path}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="emptyState"><p>{t(language, "doctorNotRun")}</p></div>
      )}
    </section>
  );
}
