// URL for the native `thumb://` scheme (served at http://thumb.localhost on
// Windows by the Rust handler in src-tauri/src/thumbs.rs). The WebView loads and
// caches these directly, so the grid never spawns a per-image backend process.
// `v` (the file mtime) busts the WebView cache when a file changes after a rescan.
export function thumbUrl(path: string, mtimeNs: number, size = 256): string {
  const params = new URLSearchParams({ path, w: String(size), v: String(mtimeNs) });
  return `http://thumb.localhost/?${params.toString()}`;
}
