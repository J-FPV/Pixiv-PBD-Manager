use std::collections::HashSet;
use std::path::PathBuf;

fn validate_files(paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() || paths.len() > 1000 {
        return Err("Select between 1 and 1000 images to drag.".into());
    }
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for path in paths {
        if !path.is_absolute() || !path.is_file() {
            return Err(format!(
                "Original file is missing or inaccessible: {}",
                path.display()
            ));
        }
        if seen.insert(path.clone()) {
            files.push(path);
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn drag_original_files(window: tauri::Window, paths: Vec<PathBuf>) -> Result<(), String> {
    let files = tauri::async_runtime::spawn_blocking(move || validate_files(paths))
        .await
        .map_err(|error| error.to_string())??;
    let (tx, rx) = std::sync::mpsc::channel();
    // OLE needs the UI thread's STA apartment. Only the waiting receiver runs
    // on a worker; DoDragDrop itself pumps the native mouse/message loop.
    window
        .run_on_main_thread(move || {
            let _ = tx.send(start_drag(&files));
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|error| error.to_string())?)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(not(windows))]
fn start_drag(_files: &[PathBuf]) -> Result<(), String> {
    Err("Dragging original files is currently supported on Windows only.".into())
}

#[cfg(windows)]
fn start_drag(files: &[PathBuf]) -> Result<(), String> {
    native::start(files).map_err(|error| error.to_string())
}

#[cfg(windows)]
mod native {
    use std::{os::windows::ffi::OsStrExt, path::PathBuf};
    use windows::core::{implement, BOOL, HRESULT, PCWSTR};
    use windows::Win32::Foundation::{
        DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, S_OK,
    };
    use windows::Win32::System::Com::{CoTaskMemFree, IDataObject};
    use windows::Win32::System::Ole::{
        DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize, DROPEFFECT,
        DROPEFFECT_COPY,
    };
    use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows::Win32::UI::Shell::{
        BHID_DataObject, Common::ITEMIDLIST, SHCreateShellItemArrayFromIDLists, SHParseDisplayName,
    };

    pub(super) struct OleApartment;
    impl OleApartment {
        pub(super) fn initialize() -> windows::core::Result<Self> {
            unsafe {
                OleInitialize(None)?;
            }
            Ok(Self)
        }
    }
    impl Drop for OleApartment {
        fn drop(&mut self) {
            unsafe {
                OleUninitialize();
            }
        }
    }

    struct ShellId(*mut ITEMIDLIST);
    impl Drop for ShellId {
        fn drop(&mut self) {
            unsafe {
                CoTaskMemFree(Some(self.0.cast()));
            }
        }
    }

    #[implement(IDropSource)]
    struct FileDropSource;

    impl IDropSource_Impl for FileDropSource_Impl {
        fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
            if escape.as_bool() {
                DRAGDROP_S_CANCEL
            } else if keys & MK_LBUTTON == MODIFIERKEYS_FLAGS(0) {
                DRAGDROP_S_DROP
            } else {
                S_OK
            }
        }

        fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    pub(super) fn file_data_object(files: &[PathBuf]) -> windows::core::Result<IDataObject> {
        let mut ids = Vec::with_capacity(files.len());
        for path in files {
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let mut id = ShellId(std::ptr::null_mut());
            unsafe {
                SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut id.0, 0, None)?;
            }
            ids.push(id);
        }
        let pointers: Vec<*const ITEMIDLIST> = ids.iter().map(|id| id.0.cast_const()).collect();
        unsafe {
            let items = SHCreateShellItemArrayFromIDLists(&pointers)?;
            items.BindToHandler(None, &BHID_DataObject)
        }
    }

    pub(super) fn start(files: &[PathBuf]) -> windows::core::Result<()> {
        let _ole = OleApartment::initialize()?;
        let data = file_data_object(files)?;
        // File validation or a slow network share may outlast the gesture.
        // A mouse-up before OLE starts must cancel, not drop at a later position.
        if unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } >= 0 {
            return Ok(());
        }
        let source: IDropSource = FileDropSource.into();
        let mut effect = DROPEFFECT::default();
        // The shell supplies CF_HDROP (original Unicode file paths). Never offer
        // MOVE, even when Shift is held, and never alter the source files.
        unsafe { DoDragDrop(&data, &source, DROPEFFECT_COPY, &mut effect).ok() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_relative_and_missing_files() {
        assert!(validate_files(vec![]).is_err());
        assert!(validate_files(vec![PathBuf::from("relative.jpg")]).is_err());
        assert!(
            validate_files(vec![std::env::temp_dir().join("missing-pbd-original.jpg")]).is_err()
        );
        assert!(validate_files(vec![std::env::temp_dir()]).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn shell_payload_contains_original_unicode_paths_not_image_bytes() {
        use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
        use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
        use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
        let root = std::env::temp_dir().join(format!("pbd-drag-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let files = vec![
            root.join("original-\u{539f}\u{56fe}.png"),
            root.join("second image.jpg"),
        ];
        for path in &files {
            std::fs::write(path, b"original-test-content").unwrap();
        }
        let _ole = native::OleApartment::initialize().unwrap();
        let data = native::file_data_object(&files).unwrap();
        let format = FORMATETC {
            cfFormat: CF_HDROP.0,
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
            ..Default::default()
        };
        unsafe {
            let mut medium = data.GetData(&format).unwrap();
            let drop = HDROP(medium.u.hGlobal.0);
            assert_eq!(DragQueryFileW(drop, u32::MAX, None), 2);
            for (index, file) in files.iter().enumerate() {
                let length = DragQueryFileW(drop, index as u32, None);
                let mut buffer = vec![0; length as usize + 1];
                DragQueryFileW(drop, index as u32, Some(&mut buffer));
                assert_eq!(
                    PathBuf::from(String::from_utf16(&buffer[..length as usize]).unwrap()),
                    *file
                );
            }
            ReleaseStgMedium(&mut medium);
        }
        assert_eq!(
            validate_files(vec![files[0].clone(), files[0].clone()])
                .unwrap()
                .len(),
            1
        );
        for path in files {
            assert_eq!(std::fs::read(&path).unwrap(), b"original-test-content");
        }
        drop(data);
        std::fs::remove_dir_all(root).unwrap();
    }
}
