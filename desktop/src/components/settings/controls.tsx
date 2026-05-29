import { FolderOpen } from "lucide-react";
import { browsePath } from "../../api";
import type { PathPickKind } from "../../api";
import { t } from "../../i18n";
import type { Language } from "../../types";

// Picks a path of `kind` and forwards the result to `apply`. Shared by the
// General and Browser sections for their path inputs.
export function BrowseButton({
  language,
  kind,
  apply
}: {
  language: Language;
  kind: PathPickKind;
  apply: (value: string) => void;
}) {
  const pick = async () => {
    const picked = await browsePath(kind);
    if (picked) {
      apply(picked);
    }
  };
  return (
    <button type="button" className="button browseButton" onClick={() => void pick()}>
      {t(language, "browse")}
    </button>
  );
}

// Opens `path` in the OS file browser; disabled when the path is blank.
export function LocationButton({
  language,
  path,
  openPath
}: {
  language: Language;
  path: string;
  openPath: (path: string) => void;
}) {
  return (
    <button type="button" className="button browseButton" disabled={!path.trim()} onClick={() => openPath(path)}>
      <FolderOpen size={16} />
      {t(language, "openLocation")}
    </button>
  );
}
