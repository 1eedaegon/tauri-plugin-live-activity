const COMMANDS: &[&str] = &[
    "get_capabilities",
    "check_permissions",
    "request_permissions",
    "start",
    "update",
    "end",
    "list",
    "start_layout",
    "update_layout",
    "end_layout",
    "list_layout",
    "write_image",
    "push_tokens",
    "openings",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        // iOS has no Swift of the plugin's own: the activitykit crate builds its Swift bridge into the app's Rust library.
        .android_path("android")
        .build();
}
