import type { Dispatch, SetStateAction } from "react";
import { browsePath, runGuiApi } from "../api";
import { t } from "../i18n";
import type {
  ApiEvent,
  AppSettings,
  CleanupMutationResult,
  CleanupSummary,
  ConfirmState,
  Language,
  LogEntry,
  SimilarEntry,
  SimilarGroup,
  SimilarResult
} from "../types";
import { formatBytes } from "../utils/format";
import { splitLines } from "../utils/paths";
import type { TaskRunner } from "./useTaskRunner";

export interface SimilarCleanupActions {
  quarantineEntries: (entries: SimilarEntry[]) => void;
  restoreCleanupItems: (operationId: string, itemIds: string[]) => void;
  deleteCleanupItems: (operationId: string, itemIds: string[]) => void;
  ignoreGroup: (group: SimilarGroup) => void;
  unignoreGroup: (signature: string) => void;
}

export interface SimilarCleanupDeps {
  language: Language;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  similarRoots: string;
  similarResult: SimilarResult | null;
  setSimilarResult: Dispatch<SetStateAction<SimilarResult | null>>;
  setCleanupSummary: Dispatch<SetStateAction<CleanupSummary>>;
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
  appendLog: (level: LogEntry["level"], message: string) => void;
  showToast: (message: string) => void;
  handleEvent: (event: ApiEvent) => void;
  runTask: TaskRunner["runTask"];
}

function applyCleanupResult(deps: SimilarCleanupDeps, result: CleanupMutationResult): void {
  deps.setCleanupSummary({
    state_path: result.state_path,
    operations: result.operations,
    ignored_groups: result.ignored_groups
  });
}

async function prepareQuarantine(deps: SimilarCleanupDeps, entries: SimilarEntry[]): Promise<void> {
  let quarantineDir = deps.settings.quarantine_dir || "";
  if (!quarantineDir) {
    quarantineDir = (await browsePath("folder")) || "";
    if (!quarantineDir) {
      deps.showToast(t(deps.language, "chooseQuarantine"));
      return;
    }
    deps.setSettings((current) => ({ ...current, quarantine_dir: quarantineDir }));
  }
  const reclaim = entries.reduce((total, entry) => total + entry.size_bytes, 0);
  const selectedPaths = new Set(entries.map((entry) => entry.path));
  const keptPaths = (deps.similarResult?.groups || [])
    .filter((group) => group.entries.some((entry) => selectedPaths.has(entry.path)))
    .flatMap((group) => group.entries.filter((entry) => !selectedPaths.has(entry.path)).map((entry) => entry.path));
  const preview = (paths: string[]) => {
    const shown = paths.slice(0, 6).join("\n");
    return paths.length > 6 ? `${shown}\n... +${paths.length - 6}` : shown;
  };
  deps.setConfirm({
    title: t(deps.language, "confirmCleanupTitle"),
    body:
      `${t(deps.language, "selectedFiles")}: ${entries.length}\n` +
      `${t(deps.language, "estimatedSpace")}: ${formatBytes(reclaim)}\n` +
      `${t(deps.language, "quarantineFolder")}: ${quarantineDir}\n\n` +
      (keptPaths.length ? `${t(deps.language, "cleanupWillKeep")} (${keptPaths.length})\n${preview(keptPaths)}\n\n` : "") +
      `${t(deps.language, "cleanupWillQuarantine")} (${entries.length})\n${preview(entries.map((entry) => entry.path))}`,
    confirmLabel: t(deps.language, "moveToQuarantine"),
    onConfirm: async () => {
      await deps.runTask("similar", t(deps.language, "moveToQuarantine"), async (signal, registerControls) => {
        const result = await runGuiApi<CleanupMutationResult>(
          "cleanup.quarantine",
          {
            ...deps.settings,
            quarantine_dir: quarantineDir,
            scan_roots: splitLines(deps.similarRoots),
            items: entries
          },
          deps.handleEvent,
          { signal, onStart: registerControls, gracefulCancel: true }
        );
        applyCleanupResult(deps, result);
        const moved = new Set(result.moved_paths || []);
        deps.setSimilarResult((current) =>
          current && moved.size
            ? {
                ...current,
                files_seen: Math.max(0, current.files_seen - moved.size),
                indexed: Math.max(0, current.indexed - moved.size),
                groups: current.groups.filter(
                  (group) => !group.entries.some((entry) => moved.has(entry.path))
                )
              }
            : current
        );
        if (result.cancelled) {
          throw new Error("cleanup cancelled");
        }
        deps.appendLog("info", `${t(deps.language, "cleanupComplete")}: ${moved.size}`);
        deps.showToast(t(deps.language, "cleanupComplete"));
      });
    }
  });
}

function restoreCleanupItems(deps: SimilarCleanupDeps, operationId: string, itemIds: string[]): void {
  if (!itemIds.length) {
    return;
  }
  void deps.runTask("similar", t(deps.language, "restore"), async (signal, registerControls) => {
    const result = await runGuiApi<CleanupMutationResult>(
      "cleanup.restore",
      { operation_id: operationId, item_ids: itemIds },
      deps.handleEvent,
      { signal, onStart: registerControls, gracefulCancel: true }
    );
    applyCleanupResult(deps, result);
    if (result.cancelled) {
      throw new Error("restore cancelled");
    }
    deps.showToast(t(deps.language, "restoreComplete"));
  });
}

function deleteCleanupItems(deps: SimilarCleanupDeps, operationId: string, itemIds: string[]): void {
  if (!itemIds.length) {
    return;
  }
  deps.setConfirm({
    title: t(deps.language, "confirmDeleteCleanupTitle"),
    body: t(deps.language, "confirmDeleteCleanupBody"),
    confirmLabel: t(deps.language, "deletePermanently"),
    onConfirm: async () => {
      await deps.runTask("similar", t(deps.language, "deletePermanently"), async (signal, registerControls) => {
        const result = await runGuiApi<CleanupMutationResult>(
          "cleanup.delete",
          { operation_id: operationId, item_ids: itemIds },
          deps.handleEvent,
          { signal, onStart: registerControls, gracefulCancel: true }
        );
        applyCleanupResult(deps, result);
        if (result.cancelled) {
          throw new Error("delete cancelled");
        }
        deps.showToast(t(deps.language, "deletedComplete"));
      });
    }
  });
}

function setGroupIgnored(deps: SimilarCleanupDeps, group: SimilarGroup, ignored: boolean): void {
  const command = ignored ? "cleanup.ignore" : "cleanup.unignore";
  const payload = ignored
    ? { signature: group.signature, kind: group.kind, entry_count: group.entries.length }
    : { signature: group.signature };
  void runGuiApi<CleanupSummary>(command, payload, deps.handleEvent)
    .then(deps.setCleanupSummary)
    .catch((error) => deps.appendLog("error", error instanceof Error ? error.message : String(error)));
}

function unignoreSignature(deps: SimilarCleanupDeps, signature: string): void {
  void runGuiApi<CleanupSummary>("cleanup.unignore", { signature }, deps.handleEvent)
    .then(deps.setCleanupSummary)
    .catch((error) => deps.appendLog("error", error instanceof Error ? error.message : String(error)));
}

export function createSimilarCleanupActions(deps: SimilarCleanupDeps): SimilarCleanupActions {
  return {
    quarantineEntries: (entries) => {
      if (!entries.length) {
        deps.showToast(t(deps.language, "cleanupNoSelection"));
        return;
      }
      void prepareQuarantine(deps, entries);
    },
    restoreCleanupItems: (operationId, itemIds) => restoreCleanupItems(deps, operationId, itemIds),
    deleteCleanupItems: (operationId, itemIds) => deleteCleanupItems(deps, operationId, itemIds),
    ignoreGroup: (group) => setGroupIgnored(deps, group, true),
    unignoreGroup: (signature) => unignoreSignature(deps, signature)
  };
}
