//! Local ongoing activity presentation for Tauri 2.
//!
//! Initialize with `.plugin(tauri_plugin_live_activity::init())` and explicitly
//! grant mutation permissions in the host capability file. The plugin
//! implements iOS and Android; desktop mutations return `UNSUPPORTED_PLATFORM`.

use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(any(mobile, test))]
mod actions;
#[cfg(any(mobile, test))]
mod bridge;
#[cfg(all(test, desktop))]
mod command_tests;
mod commands;
mod config;
#[cfg(desktop)]
mod desktop;
#[cfg(all(test, desktop))]
mod desktop_ipc_tests;
mod error;
mod image;
mod layout;
#[cfg(mobile)]
mod mobile;
mod models;
mod validation;

pub use config::{AndroidConfig, Config, Receipts};
#[cfg(desktop)]
pub use desktop::LiveActivity;
pub use error::{Error, Result};
pub use image::{ImageInput, MAX_IMAGE_BYTES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH, check_image};
pub use layout::*;
#[cfg(mobile)]
pub use mobile::LiveActivity;
pub use models::*;
pub use validation::{Validate, validate_request};

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
            commands::write_image
        ])
        .setup(|app, _api| {
            #[cfg(mobile)]
            let backend = mobile::init(app, _api)?;
            #[cfg(desktop)]
            let backend = LiveActivity::<R>::default();
            app.manage(backend);
            Ok(())
        })
        .build()
}
