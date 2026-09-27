import { MOCK_LIBRARY_IMAGES } from "./mockData";
import type { BackupEntry, HistoryEntry } from "./types.recovery";
import type { LibraryImage } from "./types";

const backups: BackupEntry[] = [{ id: "sample-backup", created: "2026-09-27T10:00:00Z", kind: "daily", reason: "daily",
  size: 94208, categories: ["artists", "annotations", "settings"], available: true }];
const history: (HistoryEntry & { before: LibraryImage[] })[] = [];
export function recordMockEdit(before: LibraryImage[]) {
  const entry = { id: crypto.randomUUID(), created: new Date().toISOString(), command: "library.update_metadata",
    category: "annotations" as const, state: "committed", count: before.length, before };
  history.unshift(entry);
  return { id: entry.id, command: entry.command };
}
export function mockRecoveryCommand(command: string, payload: Record<string, unknown>) {
  switch (command) {
    case "backup.list": return { backups: [...backups], directory: "C:\\PixivPbdManager\\backups", warning: "" };
    case "history.list": return { entries: history.map(({ before: _before, ...entry }) => entry), latest_id: history.find((entry) => entry.state === "committed")?.id || null };
    case "backup.create": {
      const entry = { ...backups[0], id: crypto.randomUUID(), created: new Date().toISOString(), kind: "manual", reason: "manual" };
      backups.unshift(entry); return { id: entry.id };
    }
    case "backup.preview": return { token: "mock-preview", categories: payload.categories, created: backups[0].created, invalid_paths: [],
      details: (payload.categories as string[]).includes("annotations") ? [{ category: "annotations", label: "101000001_p1.jpg",
        before: { rating: 2, tags: ["landscape"] }, after: { rating: 5, tags: ["landscape", "reference"] } }] : [],
      changes: (payload.categories as string[]).map((category) => ({ category, changed: category === "annotations" ? 12 : 2, unlinked: category === "annotations" ? 1 : 0 })) };
    case "backup.restore": return { restored: payload.categories, restart_required: true };
    case "backup.delete": backups.splice(backups.findIndex((entry) => entry.id === payload.id), 1); return { deleted: true };
    case "history.undo": {
      const entry = history.find((row) => row.id === payload.id)!;
      entry.before.forEach((saved) => {
        const current = MOCK_LIBRARY_IMAGES.find((image) => image.image_id === saved.image_id)!;
        Object.assign(current, { ...saved, annotation_revision: current.annotation_revision + 1 });
      });
      entry.state = "undone"; return { undone: entry.id };
    }
    case "history.discard": history.find((row) => row.id === payload.id)!.state = "discarded"; return { discarded: payload.id };
    default: return { id: "mock-import" };
  }
}
