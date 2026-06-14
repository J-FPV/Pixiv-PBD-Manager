//! Native `thumb://` URI-scheme handler: decode + resize + disk-cache image
//! thumbnails so the WebView can load them directly with `<img src>` instead of
//! spawning a Python process per grid tile. On Windows the scheme resolves to
//! `http://thumb.localhost/?path=<abs>&w=<px>&v=<mtime>`.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

const DEFAULT_SIZE: u32 = 256;
const MAX_SIZE: u32 = 1024;
const JPEG_QUALITY: u8 = 80;
// Cap concurrent decodes regardless of how many requests the WebView fires.
const MAX_CONCURRENT_DECODES: usize = 4;

/// A tiny counting semaphore (std has none) bounding simultaneous decodes.
struct Semaphore {
    permits: Mutex<usize>,
    available: Condvar,
}

impl Semaphore {
    fn acquire(&self) {
        let mut permits = self.permits.lock().unwrap();
        while *permits == 0 {
            permits = self.available.wait(permits).unwrap();
        }
        *permits -= 1;
    }

    fn release(&self) {
        *self.permits.lock().unwrap() += 1;
        self.available.notify_one();
    }
}

fn decode_gate() -> &'static Semaphore {
    static GATE: OnceLock<Semaphore> = OnceLock::new();
    GATE.get_or_init(|| Semaphore {
        permits: Mutex::new(MAX_CONCURRENT_DECODES),
        available: Condvar::new(),
    })
}

/// Entry point wired into the Tauri builder. Offloads the (blocking) work to a
/// thread and responds asynchronously so the UI thread is never blocked.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let cache_dir = ctx
        .app_handle()
        .path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join("thumbs"));
    let uri = request.uri().to_string();
    std::thread::spawn(move || {
        let response = match cache_dir {
            Some(dir) => build_response(&uri, &dir).unwrap_or_else(not_found),
            None => not_found(),
        };
        responder.respond(response);
    });
}

fn build_response(uri: &str, cache_dir: &Path) -> Option<Response<Vec<u8>>> {
    let (path, size) = parse_request(uri)?;
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let cache_file = cache_dir.join(format!("{}.jpg", cache_key(&path, meta.len(), mtime, size)));

    if let Ok(bytes) = std::fs::read(&cache_file) {
        return Some(ok_jpeg(bytes));
    }

    decode_gate().acquire();
    let rendered = render_thumbnail(&path, size);
    decode_gate().release();
    let bytes = rendered?;

    let _ = std::fs::create_dir_all(cache_dir);
    let _ = std::fs::write(&cache_file, &bytes);
    Some(ok_jpeg(bytes))
}

/// Parse `?path=<percent-encoded abs path>&w=<px>` out of the request URI.
fn parse_request(uri: &str) -> Option<(PathBuf, u32)> {
    let query = uri.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut path: Option<String> = None;
    let mut size = DEFAULT_SIZE;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        match key {
            "path" => path = Some(urlencoding::decode(value).ok()?.into_owned()),
            "w" => size = value.parse().unwrap_or(DEFAULT_SIZE).clamp(16, MAX_SIZE),
            _ => {}
        }
    }
    let path = path?;
    if path.is_empty() {
        return None;
    }
    Some((PathBuf::from(path), size))
}

fn render_thumbnail(path: &Path, size: u32) -> Option<Vec<u8>> {
    let thumb = image::open(path).ok()?.thumbnail(size, size);
    let mut buffer = Vec::new();
    JpegEncoder::new_with_quality(&mut Cursor::new(&mut buffer), JPEG_QUALITY)
        .encode_image(&DynamicImage::ImageRgb8(thumb.to_rgb8()))
        .ok()?;
    Some(buffer)
}

fn cache_key(path: &Path, size_bytes: u64, mtime_ns: u128, target: u32) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    size_bytes.hash(&mut hasher);
    mtime_ns.hash(&mut hasher);
    target.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn ok_jpeg(bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "max-age=604800")
        .body(bytes)
        .unwrap()
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap()
}
