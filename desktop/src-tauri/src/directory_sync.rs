use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
pub struct Batch {
    token: u64,
    generation: u64,
    paths: Vec<PathBuf>,
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
        if self.audit.elapsed() >= Duration::from_secs(900) {
            self.full = true;
        }
        let ready = self.last.elapsed() >= Duration::from_secs(1)
            || self.first.elapsed() >= Duration::from_secs(5);
        if !self.full && (self.pending.is_empty() || !ready) {
            return None;
        }
        self.token += 1;
        let batch = Batch {
            token: self.token,
            generation: self.generation,
            paths: self.pending.iter().cloned().collect(),
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
}

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

#[tauri::command]
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
    *state.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(generation)
}

#[tauri::command]
pub fn poll_directory_sync(
    state: tauri::State<'_, DirectorySync>,
    paused: bool,
) -> Result<SyncStatus, String> {
    let retry = {
        let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
        if queue.enabled && queue.reconnect.elapsed() >= Duration::from_secs(60) {
            queue.reconnect = Instant::now();
            let roots = queue.roots.clone();
            for root in roots {
                if !root.is_dir() && !queue.unavailable.contains(&root) {
                    queue.unavailable.push(root);
                }
            }
            queue.unavailable.clone()
        } else {
            vec![]
        }
    };
    if !retry.is_empty() {
        let mut slot = state.watcher.lock().map_err(|e| e.to_string())?;
        if slot.is_none() {
            let generation = state.queue.lock().map_err(|e| e.to_string())?.generation;
            match make_watcher(&state.queue, generation) {
                Ok(watcher) => *slot = Some(watcher),
                Err(error) => {
                    state.queue.lock().map_err(|e| e.to_string())?.error = error.to_string()
                }
            }
        }
        if let Some(watcher) = slot.as_mut() {
            for root in retry {
                let _ = watcher.unwatch(&root);
                if watcher.watch(&root, RecursiveMode::Recursive).is_ok() {
                    let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
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
        queue.pending.extend(batch.paths);
    }
    queue.pending.extend(retry_paths);
    for path in unavailable_paths {
        if !queue.unavailable.contains(&path) {
            queue.unavailable.push(path);
        }
    }
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
        assert_eq!(first.paths, vec![PathBuf::from("a")]);
        assert_eq!(queue.pending.len(), 1);
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
