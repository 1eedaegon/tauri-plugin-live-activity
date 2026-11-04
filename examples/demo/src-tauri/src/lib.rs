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
    tauri::Builder::default()
        .plugin(tauri_plugin_live_activity::init())
        .invoke_handler(tauri::generate_handler![save_self_test_report])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
