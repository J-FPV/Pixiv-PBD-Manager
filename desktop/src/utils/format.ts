import { t } from "../i18n";
import type { Language } from "../types";

export function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  for (const unit of units) {
    if (size < 1024 || unit === "GB") {
      return unit === "B" ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`;
    }
    size /= 1024;
  }
  return `${value} B`;
}

export function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Coarse "time ago" from an ISO-8601 timestamp (the backend's utc_now()):
// just now (<1m) -> N min ago (<1h) -> N h ago (<1d) -> N d ago. Computed at
// render time; empty/unparseable falls back to "never" / the raw string.
export function formatRelativeTime(
  language: Language,
  iso: string | null | undefined,
  now: number = Date.now()
): string {
  if (!iso) {
    return t(language, "neverScanned");
  }
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return iso;
  }
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 60) {
    return t(language, "justNow");
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return t(language, "minutesAgo").replace("{count}", String(diffMin));
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return t(language, "hoursAgo").replace("{count}", String(diffHour));
  }
  const diffDay = Math.floor(diffHour / 24);
  return t(language, "daysAgo").replace("{count}", String(diffDay));
}

// Numeric timestamp for sorting the "last scan" column; empty/unparseable
// sorts as oldest (0).
export function lastSeenTimestamp(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? 0 : ts;
}
