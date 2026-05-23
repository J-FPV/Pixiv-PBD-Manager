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
