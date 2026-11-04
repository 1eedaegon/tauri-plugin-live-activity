//! Local ongoing activity presentation for Tauri 2.
//!
//! Initialize with `.plugin(tauri_plugin_live_activity::init())` and explicitly
//! grant mutation permissions in the host capability file. The first alpha
//! implements iOS and Android; desktop mutations return `UNSUPPORTED_PLATFORM`.

use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(any(mobile, test))]
mod bridge;
#[cfg(all(test, desktop))]
mod command_tests;
mod commands;
#[cfg(desktop)]
mod desktop;
#[cfg(all(test, desktop))]
mod desktop_ipc_tests;
mod error;
#[cfg(mobile)]
mod mobile;
mod models;
mod validation;

#[cfg(desktop)]
pub use desktop::LiveActivity;
pub use error::{Error, Result};
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

/// Register commands and the platform backend.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("live-activity")
        .invoke_handler(tauri::generate_handler![
            commands::get_capabilities,
            commands::check_permissions,
            commands::request_permissions,
            commands::start,
            commands::update,
            commands::end,
            commands::list
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
