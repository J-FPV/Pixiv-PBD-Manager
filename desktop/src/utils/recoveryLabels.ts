import { t } from "../i18n";
import type { Language } from "../types";
import type { BackupCategory } from "../types.recovery";

export const categoryLabel = (language: Language, category: BackupCategory) =>
  t(language, category === "artists" ? "backupArtists" : category === "annotations" ? "backupAnnotations" : category === "collections" ? "backupCollections" : "backupSettings");
export function operationLabel(language: Language, command: string) {
  if (command.startsWith("collections.")) return t(language, "backupCollections");
  switch (command) {
    case "artists.assign_folder": return t(language, "historyAssign");
    case "artists.rename": return t(language, "historyRename");
    case "artists.set_save_path": return t(language, "historySavePath");
    case "library.set_tags": case "library.update_metadata": return t(language, "historyImageEdit");
    case "settings.save": return t(language, "backupReasonReset");
    case "scan.apply": case "scan.run": return t(language, "backupReasonScan");
    case "artists.remove": return t(language, "backupReasonDelete");
    case "artists.add_tag": case "artists.set_tags": case "artists.rename_tag": case "artists.delete_tag": case "artists.assign_tag": return t(language, "backupReasonTags");
    case "artists.rebuild_work_index.apply": return t(language, "backupReasonIndex");
    case "artists.refresh_names": return t(language, "backupReasonNames");
    case "backup.restore": return t(language, "backupReasonRestore");
    case "manual": return t(language, "backupManual");
    case "daily": return t(language, "backupDaily");
    case "imported": return t(language, "backupImported");
    default: return t(language, "backupReasonEdit");
  }
}
export const historyLabel = (language: Language, status: string) => {
  const keys = { committed: "historyCommitted", undone: "historyUndone", discarded: "historyDiscarded",
    expired: "historyExpired", invalidated: "historyInvalidated", failed: "historyFailed", backup_only: "historyBackupOnly" } as const;
  return t(language, keys[status as keyof typeof keys] || "historyFailed");
};

export function recoveryValue(language: Language, value: unknown): string {
  if (value === null || value === undefined || value === "") return t(language, "backupEmptyValue");
  if (typeof value === "boolean") return t(language, value ? "backupYes" : "backupNo");
  if (Array.isArray(value)) return value.length ? value.map((item) => recoveryValue(language, item)).join(" · ") : t(language, "backupEmptyValue");
  if (typeof value !== "object") return String(value);
  const labels = { tags: "tags", rating: "rating", favorite: "favorite", markers: "backupMarkers",
    name: "artistName", save_paths: "savePath", language: "language", theme: "theme",
    download_roots: "downloadRoots", exclude_roots: "excludeRoots" } as const;
  return Object.entries(value).map(([key, item]) => `${key in labels ? t(language, labels[key as keyof typeof labels]) : key}: ${recoveryValue(language, item)}`).join("\n");
}
