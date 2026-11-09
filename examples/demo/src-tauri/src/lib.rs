mod actions;
mod report;

use tauri::Manager;

// Demo-only test output: the caller cannot choose a filesystem path.
#[tauri::command]
fn save_self_test_report(
    app: tauri::AppHandle,
    report: serde_json::Value,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Demo data directory unavailable")?;
    let encoded = serde_json::to_string_pretty(&report).map_err(|_| "Invalid self-test report")?;
    report::persist_report(&directory, &encoded)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_live_activity::init())
        .invoke_handler(tauri::generate_handler![save_self_test_report])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    actions::register(&app);
    actions::start_from_rust_if_asked(&app, std::env::args());
    app.run(|_, _| {});
}
