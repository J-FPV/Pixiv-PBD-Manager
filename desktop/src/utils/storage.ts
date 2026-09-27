export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function persistJson(key: string, value: unknown): void {
  try {
    const next = value === null || value === undefined ? null : JSON.stringify(value);
    if (localStorage.getItem(key) === next) return;
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, next as string);
    }
    window.dispatchEvent(new CustomEvent("pbd-preferences-changed", { detail: key }));
  } catch {
    // Local storage can be full when a very large similar-image report is cached.
  }
}
