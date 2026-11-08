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
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
