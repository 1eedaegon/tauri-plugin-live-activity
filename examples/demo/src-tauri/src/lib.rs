// The demo is an app's code, and people copy it: what cannot be done is said on the log, and nothing unwraps.
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

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

/// The launch argument that has the page run its lifecycle test at once and save the report: a phone at hand has
/// no UI test that presses the button.
const SELF_TEST: &str = "--self-test";

/// Whether the app was launched with [`SELF_TEST`].
#[tauri::command]
fn self_test_requested() -> bool {
    std::env::args().any(|argument| argument == SELF_TEST)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_live_activity::init())
        // The device's position, for the location example.
        .plugin(tauri_plugin_geolocation::init())
        .invoke_handler(tauri::generate_handler![
            save_self_test_report,
            self_test_requested
        ])
        .build(tauri::generate_context!());
    let app = match built {
        Ok(app) => app,
        Err(error) => {
            // Nothing can be shown without the app: say why on the log, and end.
            eprintln!("Mochi demo: the app could not be built: {error}");
            std::process::exit(1);
        }
    };
    actions::register(&app);
    actions::start_from_rust_if_asked(&app, std::env::args());
    app.run(|_, _| {});
}
