import type { ReviewItem } from "./types.review";
import type { UnmatchedFolder } from "./types";

export function mockReviewCommand(command: string, values: Record<string, unknown>) {
  const key = "pbd-mock-review";
  let items: ReviewItem[] = JSON.parse(sessionStorage.getItem(key) || "[]");
  if (command === "scan.review.list") {
    const legacy = (values.legacy_folders || []) as UnmatchedFolder[];
    if (!items.length) {
      items = legacy.map((row, index) => ({ ...row, status: "pending", candidates: [], queries: [], revision: String(index), updated_at: Date.now() / 1000, stale: true }));
      if (items.length) sessionStorage.setItem(`${key}-legacy`, "1");
    } else if (sessionStorage.getItem(`${key}-legacy`)) {
      items = items.filter((item) => legacy.some((row) => row.path === item.path));
    }
  }
  if (command === "scan.review.apply") items = items.filter((row) => row.path !== values.path);
  sessionStorage.setItem(key, JSON.stringify(items));
  if (command === "scan.review.detail") return items.find((row) => row.path === values.path);
  return { items };
}
