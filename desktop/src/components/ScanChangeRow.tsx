import { ExternalLink } from "lucide-react";
import { t } from "../i18n";
import type { Language, ScanChange } from "../types";

type RecognitionReasonKey =
  | "scanReasonFolderId"
  | "scanReasonFilenameId"
  | "scanReasonFolderName"
  | "scanReasonKnownPath"
  | "scanReasonExactName"
  | "scanReasonKnownWork"
  | "scanReasonOnlineWork"
  | "scanReasonFuzzyName"
  | "scanReasonPidFilename";

const RECOGNITION_RULES: [RecognitionReasonKey, (source: string) => boolean][] = [
  ["scanReasonFolderId", (source) => source.startsWith("folder:")],
  ["scanReasonFilenameId", (source) => source.startsWith("filename:")],
  ["scanReasonFolderName", (source) => source.includes("folder_name_only:")],
  ["scanReasonPidFilename", (source) => source.includes("folder_pid")],
  ["scanReasonKnownPath", (source) => source.includes("local_save_path")],
  ["scanReasonExactName", (source) => source.includes("local_exact_name")],
  ["scanReasonKnownWork", (source) => source.includes("local_work_id")],
  ["scanReasonOnlineWork", (source) => source.includes("resolved_by_work:")],
  ["scanReasonFuzzyName", (source) => source.includes("fuzzy_search:")]
];

function RecognitionReasons({ language, sources }: { language: Language; sources: string[] }) {
  const normalized = sources.map((source) => source.toLowerCase());
  const reasons = RECOGNITION_RULES.filter(([, matches]) => normalized.some(matches)).map(([key]) => key);
  if (!reasons.length) {
    return null;
  }
  return (
    <div className="scanRecognitionReasons" title={sources.join("\n")}>
      <span className="scanRecognitionLabel">{t(language, "scanRecognitionBasis")}</span>
      {reasons.map((key) => <span key={key} className="scanRecognitionChip">{t(language, key)}</span>)}
    </div>
  );
}

// The kind-specific body of a scan-change row (name, paths, work counts).
function ScanChangeDetail({ language, change }: { language: Language; change: ScanChange }) {
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
}

export function ScanChangeRow({
  language,
  change,
  checked,
  onToggle,
  onOpenArtist
}: {
  language: Language;
  change: ScanChange;
  checked: boolean;
  onToggle: (id: string) => void;
  onOpenArtist: (artistId: string) => void;
}) {
  return (
    <div
      className="scanChangeRow"
      role="button"
      tabIndex={0}
      onClick={() => onToggle(change.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(change.id);
        }
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggle(change.id)}
      />
      <span className="scanChangeId">{change.artist_id}</span>
      <div className="scanChangeMain">
        <ScanChangeDetail language={language} change={change} />
        <RecognitionReasons language={language} sources={change.match_sources || []} />
      </div>
      <button
        type="button"
        className="button quiet scanOpenArtistButton"
        title={t(language, "openArtistPage")}
        aria-label={t(language, "openArtistPage")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenArtist(change.artist_id);
        }}
      >
        <ExternalLink size={14} />
        <span className="srOnly">{t(language, "openArtistPage")}</span>
      </button>
    </div>
  );
}
