//! Local ongoing activity presentation for Tauri 2.
//!
//! Initialize with `.plugin(tauri_plugin_live_activity::init())` and explicitly
//! grant mutation permissions in the host capability file. The plugin
//! implements iOS, on the `activitykit` crate, and Android; desktop mutations
//! return `UNSUPPORTED_PLATFORM`.

use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(any(mobile, test))]
mod actions;
#[cfg(target_os = "android")]
mod android;
#[cfg(any(target_os = "android", test))]
mod android_liveupdate;
#[cfg(any(target_os = "ios", test))]
mod apple;
#[cfg(any(target_os = "android", test))]
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
#[cfg(target_os = "ios")]
mod ios;
mod layout;
mod models;
#[cfg(test)]
mod types_tests;
mod validation;

#[cfg(target_os = "android")]
pub use android::LiveActivity;
pub use config::{AndroidConfig, Config, Receipts};
#[cfg(desktop)]
pub use desktop::LiveActivity;
pub use error::{Error, Result};
pub use image::{ImageInput, MAX_IMAGE_BYTES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH, check_image};
#[cfg(target_os = "ios")]
pub use ios::LiveActivity;
pub use layout::*;
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
            #[cfg(target_os = "android")]
            let backend = android::init(app, _api)?;
            #[cfg(target_os = "ios")]
            let backend = ios::init(app, _api)?;
            #[cfg(desktop)]
            let backend = LiveActivity::<R>::default();
            app.manage(backend);
            Ok(())
        })
        .build()
}
