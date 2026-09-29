mod thumbs;
mod file_drag;
mod directory_sync;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(directory_sync::DirectorySync::default())
        .invoke_handler(tauri::generate_handler![file_drag::drag_original_files, directory_sync::configure_directory_sync,
            directory_sync::poll_directory_sync, directory_sync::acknowledge_directory_sync])
        .register_asynchronous_uri_scheme_protocol("thumb", |ctx, request, responder| {
            thumbs::handle(ctx, request, responder);
        })
        .run(tauri::generate_context!())
        .expect("error while running Pixiv PBD Manager desktop app");
}
