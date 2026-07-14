// URL for the native `thumb://` scheme (served at http://thumb.localhost on
// Windows by the Rust handler in src-tauri/src/thumbs.rs). The WebView loads and
// caches these directly, so the grid never spawns a per-image backend process.
// `v` (the file mtime) busts the WebView cache when a file changes after a rescan.
export function thumbUrl(path: string, mtimeNs: number, size = 256): string {
  if (import.meta.env.DEV && import.meta.env.VITE_GUI_API_MODE === "mock") {
    const accent = path.includes("p1") ? "%234f86c6" : "%2318a779";
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'%3E%3Crect width='100%25' height='100%25' fill='%2317212b'/%3E%3Ccircle cx='50%25' cy='45%25' r='30%25' fill='${accent}'/%3E%3C/svg%3E`;
  }
  // encodeURIComponent (not URLSearchParams) so spaces become %20, not "+",
  // which the Rust urlencoding decoder reads back as a literal "+".
  return `http://thumb.localhost/?path=${encodeURIComponent(path)}&w=${size}&v=${mtimeNs}`;
}
