// URL for the native `thumb://` scheme (served at http://thumb.localhost on
// Windows by the Rust handler in src-tauri/src/thumbs.rs). The WebView loads and
// caches these directly, so the grid never spawns a per-image backend process.
// `v` (the file mtime) busts the WebView cache when a file changes after a rescan.
export function thumbUrl(path: string, mtimeNs: number, size = 256): string {
  // encodeURIComponent (not URLSearchParams) so spaces become %20, not "+",
  // which the Rust urlencoding decoder reads back as a literal "+".
  return `http://thumb.localhost/?path=${encodeURIComponent(path)}&w=${size}&v=${mtimeNs}`;
}
