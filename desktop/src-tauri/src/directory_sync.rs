use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
pub struct Batch {
    token: u64,
    generation: u64,
    paths: Vec<String>,
    full: bool,
}

struct Queue {
    roots: Vec<PathBuf>,
    excludes: Vec<PathBuf>,
    pending: BTreeSet<PathBuf>,
    flight: Option<Batch>,
    full: bool,
    enabled: bool,
    generation: u64,
    token: u64,
    first: Instant,
    last: Instant,
    audit: Instant,
    reconnect: Instant,
    unavailable: Vec<PathBuf>,
    error: String,
}

impl Default for Queue {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            roots: vec![],
            excludes: vec![],
            pending: BTreeSet::new(),
            flight: None,
            full: false,
            enabled: false,
            generation: 0,
            token: 0,
            first: now,
            last: now,
            audit: now,
            reconnect: now,
            unavailable: vec![],
            error: String::new(),
        }
    }
}

impl Queue {
    fn event(&mut self, result: notify::Result<Event>) {
        if !self.enabled {
            return;
        }
        let now = Instant::now();
        if self.pending.is_empty() {
            self.first = now;
        }
        match result {
            Ok(event) if matches!(event.kind, EventKind::Access(_)) => return,
            Ok(event) => {
                if event.need_rescan() {
                    self.full = true;
                }
                for path in event.paths {
                    if self.roots.iter().any(|root| path.starts_with(root))
                        && !self
                            .excludes
                            .iter()
                            .any(|exclude| path.starts_with(exclude))
                    {
                        self.pending.insert(path);
                    }
                }
                if self.pending.len() > 8192 {
                    self.pending.clear();
                    self.full = true;
                }
            }
            Err(error) => {
                self.error = error.to_string();
                self.full = true;
                self.unavailable = self.roots.clone();
            }
        }
        self.last = now;
    }

    fn claim(&mut self, paused: bool) -> Option<Batch> {
        if !self.enabled || paused || self.flight.is_some() {
            return None;
        }
        if self.audit.elapsed() >= AUDIT_INTERVAL {
            self.full = true;
        }
        let ready = self.last.elapsed() >= Duration::from_secs(1)
            || self.first.elapsed() >= Duration::from_secs(5);
        if !self.full && (self.pending.is_empty() || !ready) {
            return None;
        }
        // Paths reach Python as JSON text. A name that is not valid Unicode (an
        // unpaired UTF-16 surrogate on Windows) would fail serialization after
        // the batch is claimed and wedge the queue; rescan its folder instead.
        let paths: BTreeSet<&str> = self
            .pending
            .iter()
            .filter_map(|path| path.ancestors().find_map(Path::to_str))
            .collect();
        self.token += 1;
        let batch = Batch {
            token: self.token,
            generation: self.generation,
            paths: paths.into_iter().map(str::to_owned).collect(),
            full: self.full,
        };
        self.pending.clear();
        if self.full {
            self.audit = Instant::now();
        }
        self.full = false;
        self.flight = Some(batch.clone());
        Some(batch)
    }

    // Python reports the scope it could not walk. Re-arm the configured roots
    // that contain it; a scope folder must never become a watched root.
    fn report_unavailable(&mut self, paths: &[PathBuf]) {
        let roots: Vec<PathBuf> = self
            .roots
            .iter()
            .filter(|root| paths.iter().any(|path| path.starts_with(root)))
            .cloned()
            .collect();
        for root in roots {
            if !self.unavailable.contains(&root) {
                self.unavailable.push(root);
            }
        }
    }
}

const AUDIT_INTERVAL: Duration = Duration::from_secs(900);

#[derive(Default)]
pub struct DirectorySync {
    queue: Arc<Mutex<Queue>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

fn make_watcher(queue: &Arc<Mutex<Queue>>, generation: u64) -> notify::Result<RecommendedWatcher> {
    let queue = Arc::clone(queue);
    RecommendedWatcher::new(
        move |event| {
            if let Ok(mut queue) = queue.lock() {
                if queue.generation == generation {
                    queue.event(event);
                }
            }
        },
        notify::Config::default().with_follow_symlinks(false),
    )
}

#[derive(Serialize)]
pub struct SyncStatus {
    generation: u64,
    enabled: bool,
    pending: usize,
    unavailable: Vec<PathBuf>,
    error: String,
    batch: Option<Batch>,
}

// `async` runs these on the async runtime's threads, not the UI thread:
// watch() and is_dir() on an offline network root block for the SMB timeout.
#[tauri::command(async)]
pub fn configure_directory_sync(
    state: tauri::State<'_, DirectorySync>,
    roots: Vec<PathBuf>,
    excludes: Vec<PathBuf>,
    enabled: bool,
) -> Result<u64, String> {
    if roots
        .iter()
        .chain(excludes.iter())
        .any(|path| !path.is_absolute())
    {
        return Err("Sync paths must be absolute".into());
    }
    let generation;
    {
        let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
        queue.generation += 1;
        generation = queue.generation;
        *queue = Queue {
            roots: roots.clone(),
            excludes,
            enabled,
            generation,
            full: enabled,
            ..Queue::default()
        };
    }
    // Dropping/replacing a watcher must not hold the callback's queue lock.
    let old = state.watcher.lock().map_err(|e| e.to_string())?.take();
    drop(old);
    if !enabled {
        return Ok(generation);
    }
    let result = make_watcher(&state.queue, generation);
    let mut watcher = match result {
        Ok(watcher) => watcher,
        Err(error) => {
            let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
            queue.error = error.to_string();
            queue.unavailable = roots;
            return Ok(generation);
        }
    };
    for root in roots {
        if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
            let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
            queue.error = error.to_string();
            queue.unavailable.push(root);
        }
    }
    // A newer configure may have finished first; its watcher must win.
    let mut slot = state.watcher.lock().map_err(|e| e.to_string())?;
    if state.queue.lock().map_err(|e| e.to_string())?.generation == generation {
        *slot = Some(watcher);
    }
    Ok(generation)
}

#[tauri::command(async)]
pub fn poll_directory_sync(
    state: tauri::State<'_, DirectorySync>,
    paused: bool,
) -> Result<SyncStatus, String> {
    let (generation, roots) = {
        let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
        let due = queue.enabled && queue.reconnect.elapsed() >= Duration::from_secs(60);
        if due {
            queue.reconnect = Instant::now();
        }
        (
            queue.generation,
            if due { queue.roots.clone() } else { vec![] },
        )
    };
    // Probe without the queue lock so a slow network root never stalls the
    // watcher callback or acknowledge.
    let offline: Vec<PathBuf> = roots
        .iter()
        .filter(|root| !root.is_dir())
        .cloned()
        .collect();
    let retry = if roots.is_empty() {
        vec![]
    } else {
        let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
        if queue.generation != generation {
            vec![]
        } else {
            for root in offline {
                if !queue.unavailable.contains(&root) {
                    queue.unavailable.push(root);
                }
            }
            // On Windows notify drops a watch silently after a network error or
            // overflow. Re-arm every root right before the periodic audit, whose
            // full walk covers anything the dropped watch missed.
            if queue.audit.elapsed() >= AUDIT_INTERVAL {
                queue.roots.clone()
            } else {
                queue.unavailable.clone()
            }
        }
    };
    if !retry.is_empty() {
        let mut slot = state.watcher.lock().map_err(|e| e.to_string())?;
        // A configure that ran meanwhile owns the watcher; leave it alone.
        let current = state.queue.lock().map_err(|e| e.to_string())?.generation == generation;
        if current && slot.is_none() {
            match make_watcher(&state.queue, generation) {
                Ok(watcher) => *slot = Some(watcher),
                Err(error) => {
                    state.queue.lock().map_err(|e| e.to_string())?.error = error.to_string()
                }
            }
        }
        if let Some(watcher) = slot.as_mut().filter(|_| current) {
            for root in retry {
                let _ = watcher.unwatch(&root);
                if watcher.watch(&root, RecursiveMode::Recursive).is_ok() {
                    let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
                    if queue.generation != generation {
                        break;
                    }
                    queue.unavailable.retain(|path| path != &root);
                    queue.pending.insert(root);
                    queue.first = Instant::now();
                    if queue.unavailable.is_empty() {
                        queue.error.clear();
                    }
                }
            }
        }
    }
    let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
    let batch = queue.claim(paused);
    Ok(SyncStatus {
        generation: queue.generation,
        enabled: queue.enabled,
        pending: queue.pending.len(),
        unavailable: queue.unavailable.clone(),
        error: queue.error.clone(),
        batch,
    })
}

#[tauri::command]
pub fn acknowledge_directory_sync(
    state: tauri::State<'_, DirectorySync>,
    generation: u64,
    token: u64,
    success: bool,
    retry_paths: Vec<PathBuf>,
    unavailable_paths: Vec<PathBuf>,
) -> Result<(), String> {
    let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
    if queue.generation != generation
        || queue.flight.as_ref().map(|batch| batch.token) != Some(token)
    {
        return Ok(());
    }
    let batch = queue.flight.take().unwrap();
    if !success {
        queue.full |= batch.full;
        queue
            .pending
            .extend(batch.paths.into_iter().map(PathBuf::from));
    }
    queue.pending.extend(retry_paths);
    queue.report_unavailable(&unavailable_paths);
    queue.first = Instant::now();
    queue.last = queue.first;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn batches_wait_bound_delay_and_keep_next_generation() {
        let mut queue = Queue {
            enabled: true,
            ..Queue::default()
        };
        queue.pending.insert(PathBuf::from("a"));
        assert!(queue.claim(false).is_none());
        queue.first = Instant::now() - Duration::from_secs(6);
        let first = queue.claim(false).unwrap();
        queue.pending.insert(PathBuf::from("b"));
        assert!(queue.claim(false).is_none());
        assert_eq!(first.paths, vec!["a".to_string()]);
        assert_eq!(queue.pending.len(), 1);
    }
    #[test]
    fn unavailable_scopes_map_to_their_root() {
        let mut queue = Queue {
            roots: vec![PathBuf::from("/library")],
            ..Queue::default()
        };
        queue.report_unavailable(&[PathBuf::from("/library/a/b"), PathBuf::from("/elsewhere")]);
        queue.report_unavailable(&[PathBuf::from("/library")]);
        assert_eq!(queue.unavailable, vec![PathBuf::from("/library")]);
    }
    #[test]
    fn unrepresentable_names_fall_back_to_their_folder() {
        #[cfg(windows)]
        let name = {
            use std::os::windows::ffi::OsStringExt;
            std::ffi::OsString::from_wide(&[0xD800])
        };
        #[cfg(unix)]
        let name = {
            use std::os::unix::ffi::OsStrExt;
            std::ffi::OsStr::from_bytes(&[0xFF]).to_owned()
        };
        let mut queue = Queue {
            enabled: true,
            full: true,
            ..Queue::default()
        };
        queue.pending.insert(PathBuf::from("/library/a").join(name));
        let batch = queue.claim(false).unwrap();
        assert_eq!(batch.paths, vec!["/library/a".to_string()]);
        assert!(serde_json::to_string(&batch).is_ok());
    }
    #[test]
    fn paused_audits_remain_pending() {
        let mut queue = Queue {
            enabled: true,
            full: true,
            ..Queue::default()
        };
        assert!(queue.claim(true).is_none());
        assert!(queue.claim(false).unwrap().full);
    }
    #[test]
    fn native_recursive_notification_sees_deep_file() {
        use std::{fs, sync::mpsc, time::SystemTime};
        let temporary = std::env::temp_dir();
        let root = temporary.join(format!(
            "pbd-notify-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let deep = root.join("a").join("b");
        fs::create_dir_all(&deep).unwrap();
        let (send, receive) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(send).unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();
        let image = deep.join("original.png");
        fs::write(&image, b"test").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = false;
        while Instant::now() < deadline {
            if let Ok(Ok(event)) = receive.recv_timeout(Duration::from_millis(250)) {
                if event.paths.iter().any(|path| path == &image) {
                    seen = true;
                    break;
                }
            }
        }
        drop(watcher);
        assert!(root.starts_with(&temporary) && root != temporary);
        fs::remove_dir_all(&root).unwrap();
        assert!(seen, "native watcher missed a deep file creation");
    }
}
