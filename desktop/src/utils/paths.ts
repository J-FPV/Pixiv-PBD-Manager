export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinLines(values: string[] | undefined): string {
  return (values || []).join("\n");
}

export function isPathInside(target: string, root: string): boolean {
  const norm = (value: string) => value.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  const t = norm(target);
  const r = norm(root);
  return t === r || t.startsWith(`${r}/`);
}

export function isUnsafeUserDataDir(value: string, roots: string[]): boolean {
  if (!value.trim()) {
    return false;
  }
  return roots.some((root) => root.trim() && isPathInside(value, root));
}
