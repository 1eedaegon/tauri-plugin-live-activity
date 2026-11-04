const COMMANDS: &[&str] = &[
    "get_capabilities",
    "check_permissions",
    "request_permissions",
    "start",
    "update",
    "end",
    "list",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
