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
// Cap how many requests can wait. When the grid is scrolled fast the WebView
// fires far more than we can decode; we keep the newest and drop the oldest
// (most likely scrolled off-screen) so the visible tiles aren't starved.
const MAX_PENDING: usize = 256;

/// One queued thumbnail request: the parsed URI, where to cache, and the channel
/// back to the WebView.
struct Job {
    uri: String,
    cache_dir: PathBuf,
    responder: UriSchemeResponder,
}

/// A LIFO work queue drained by a fixed pool of worker threads. LIFO (newest
/// first) is the key: while scrolling, the tiles currently on screen are the
/// most recent requests, so they render before the backlog of tiles the user
/// already scrolled past.
struct Scheduler {
    queue: Mutex<Vec<Job>>,
    ready: Condvar,
}

fn worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 8)
}

fn scheduler() -> &'static Scheduler {
    static SCHED: OnceLock<Scheduler> = OnceLock::new();
    let sched = SCHED.get_or_init(|| Scheduler {
        queue: Mutex::new(Vec::new()),
        ready: Condvar::new(),
    });
    // Spawn the worker pool exactly once, on first use.
    static WORKERS: OnceLock<()> = OnceLock::new();
    WORKERS.get_or_init(|| {
        for _ in 0..worker_count() {
            std::thread::spawn(move || worker_loop(sched));
        }
    });
    sched
}

fn worker_loop(sched: &'static Scheduler) {
    loop {
        let job = {
            let mut queue = sched.queue.lock().unwrap();
            while queue.is_empty() {
                queue = sched.ready.wait(queue).unwrap();
            }
            queue.pop().unwrap() // newest request first
        };
        let response = build_response(&job.uri, &job.cache_dir).unwrap_or_else(not_found);
        job.responder.respond(response);
    }
}

/// Entry point wired into the Tauri builder. Enqueues the (blocking) work for the
/// worker pool and returns immediately so the UI thread is never blocked.
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
    let cache_dir = match cache_dir {
        Some(dir) => dir,
        None => return responder.respond(not_found()),
    };
    let job = Job {
        uri: request.uri().to_string(),
        cache_dir,
        responder,
    };
    let sched = scheduler();
    let mut queue = sched.queue.lock().unwrap();
    // Drop the oldest pending request if the backlog is full. Its <img> has very
    // likely scrolled off-screen; if not, the WebView re-requests when the tile
    // settles. not_found() lets the frontend retry rather than hang blank.
    if queue.len() >= MAX_PENDING {
        let stale = queue.remove(0);
        stale.responder.respond(not_found());
    }
    queue.push(job);
    drop(queue);
    sched.ready.notify_one();
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

    let bytes = render_thumbnail(&path, size)?;

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
