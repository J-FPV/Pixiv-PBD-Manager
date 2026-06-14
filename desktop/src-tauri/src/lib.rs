mod thumbs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("thumb", |ctx, request, responder| {
            thumbs::handle(ctx, request, responder);
        })
        .run(tauri::generate_context!())
        .expect("error while running Pixiv PBD Manager desktop app");
}
