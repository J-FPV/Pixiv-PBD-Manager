export function clampTextareaHeight(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(56, Math.min(480, Math.round(parsed)));
}
