//! iOS: the default backend of the `liveactivity` crate, on a kit with the settings of the plugin configuration.
//! The kit is created early, at plugin setup, so that a tap that launched the app finds a subscriber.

use crate::{Config, Error, LiveActivity, Receipts, Result, service};
use liveactivity::{activitykit, ios::ActivityKitBackend};
use tauri::{AppHandle, Runtime, plugin::PluginApi};

pub(crate) fn init<R: Runtime>(
    app: &AppHandle<R>,
    api: PluginApi<R, Option<Config>>,
) -> Result<LiveActivity<R>> {
    let config = api.config().as_ref();
    let receipts = match config.and_then(|config| config.receipts) {
        Some(Receipts::Redacted) => activitykit::Receipts::Redacted,
        _ => activitykit::Receipts::Full,
    };
    let push_to_start = config
        .and_then(|config| config.push_to_start)
        .unwrap_or(false);
    // A kit that already runs with other settings answers `CONFLICT`.
    let kit = activitykit::ActivityKit::builder()
        .receipts(receipts)
        .push_to_start(push_to_start)
        .build()
        .map_err(|error| Error::new(error.code(), error.message()))?;
    service::connect(app, ActivityKitBackend::with_kit(kit))
}
