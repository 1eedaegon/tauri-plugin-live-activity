//! Local ongoing activity presentation for Tauri 2.
//!
//! Initialize with `.plugin(tauri_plugin_live_activity::init())` and explicitly
//! grant mutation permissions in the host capability file. The plugin is an adapter of the
//! `liveactivity` crate: the contract, its checks and the iOS and Android backends are that crate's, and the
//! plugin adds Tauri's commands, events, configuration and Android's permission dialog. Desktop mutations
//! return `UNSUPPORTED_PLATFORM`.

use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

mod actions;
#[cfg(target_os = "android")]
mod android;
#[cfg(any(target_os = "android", test))]
mod bridge;
#[cfg(all(test, desktop))]
mod command_tests;
mod commands;
mod config;
#[cfg(all(test, desktop))]
mod desktop_ipc_tests;
mod events;
#[cfg(target_os = "ios")]
mod ios;
mod service;
#[cfg(test)]
mod types_tests;

pub use config::{AndroidConfig, Config, Receipts};
pub use events::{
    ACTION_EVENT, PERMISSIONS_EVENT, PUSH_TO_START_TOKEN_EVENT, PUSH_TOKEN_EVENT, STARTED_EVENT,
    STATE_EVENT, UPDATED_EVENT,
};
/// The contract: the requests, records, layout types, errors and checks.
pub use liveactivity::contract::*;
pub use service::LiveActivity;

/// Access the registered plugin from a Tauri application or window.
pub trait LiveActivityExt<R: Runtime> {
    fn live_activity(&self) -> &LiveActivity<R>;
}

impl<R: Runtime, T: Manager<R>> LiveActivityExt<R> for T {
    fn live_activity(&self) -> &LiveActivity<R> {
        self.state::<LiveActivity<R>>().inner()
    }
}

/// Register commands and the platform backend. `plugins.live-activity` in the Tauri
/// configuration is optional; see [`Config`].
pub fn init<R: Runtime>() -> TauriPlugin<R, Option<Config>> {
    Builder::<R, Option<Config>>::new("live-activity")
        .invoke_handler(tauri::generate_handler![
            commands::get_capabilities,
            commands::check_permissions,
            commands::request_permissions,
            commands::start,
            commands::update,
            commands::end,
            commands::list,
            commands::start_layout,
            commands::update_layout,
            commands::end_layout,
            commands::list_layout,
            commands::write_image,
            commands::push_tokens
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let plugin = android::init(app, _api)?;
            #[cfg(target_os = "ios")]
            let plugin = ios::init(app, _api)?;
            #[cfg(desktop)]
            let plugin = service::connect(app, liveactivity::UnsupportedBackend, None)?;
            app.manage(plugin);
            Ok(())
        })
        .build()
}
