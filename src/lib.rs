//! Local ongoing activity presentation for Tauri 2.
//!
//! Initialize with `.plugin(tauri_plugin_live_activity::init())` and explicitly
//! grant mutation permissions in the host capability file. The plugin is an adapter of the
//! `liveactivity` crate: the contract, its checks and the iOS and Android backends are that crate's, and the
//! plugin adds Tauri's commands, events, configuration and Android's permission dialog. Desktop mutations
//! return `UNSUPPORTED_PLATFORM`.

// TP-BUILD-2: a value that is not there is an error to answer, and no reason to end the app's process. Tests may
// unwrap: a test that panics has failed.
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

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
#[cfg(any(target_os = "android", test))]
mod drain;
mod events;
mod exact_alarms;
#[cfg(any(target_os = "android", test))]
mod files;
#[cfg(target_os = "ios")]
mod ios;
/// Android: the app's activities for a service of its own that runs without Tauri.
#[cfg(target_os = "android")]
pub mod native;
mod openings;
mod service;
#[cfg(test)]
mod types_tests;

pub use config::{AndroidConfig, Config, Receipts};
pub use events::{
    ACTION_EVENT, HANDLED_EVENT, OPENED_EVENT, PERMISSIONS_EVENT, PUSH_TO_START_TOKEN_EVENT,
    PUSH_TOKEN_EVENT, STARTED_EVENT, STATE_EVENT, UNKNOWN_EVENT, UPDATED_EVENT,
};
/// The activitykit crate that the plugin builds with, for what a layout is built of beside the contract's types:
/// the node functions of `activitykit::layout` (`text`, `vstack`, `button`, …) and `values!`. Its types are
/// `#[non_exhaustive]`: a node is built with those functions, not as a literal.
pub use liveactivity::activitykit;
/// The contract: the requests, records, layout types, errors and checks.
pub use liveactivity::contract::*;
/// The liveupdate crate that the plugin builds with, for what the parts of an Android content take beside the
/// contract's types: its `Timer` for a `TimerStyle`, whose name the contract gives to the template's timer.
pub use liveactivity::liveupdate;
pub use openings::OPENINGS_KEPT;
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
            commands::open_exact_alarm_settings,
            commands::start,
            commands::update,
            commands::end,
            commands::list,
            commands::start_layout,
            commands::update_layout,
            commands::end_layout,
            commands::list_layout,
            commands::write_image,
            commands::push_tokens,
            commands::openings
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let plugin = android::init(app, _api)?;
            #[cfg(target_os = "ios")]
            let plugin = ios::init(app, _api)?;
            #[cfg(desktop)]
            let plugin = service::connect(
                app,
                liveactivity::UnsupportedBackend,
                exact_alarms::NoSetting(Error::unsupported),
            )?;
            app.manage(plugin);
            Ok(())
        })
        .build()
}
