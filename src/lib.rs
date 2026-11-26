//! iOS Live Activities and Android Live Updates for Tauri 2.
//!
//! A Tauri 2 app with this plugin starts, updates and ends ActivityKit Live Activities on iOS 16.1 and later, on the
//! Lock Screen and in the Dynamic Island, and shows the same request on Android as an ongoing notification from
//! Android 8.0 (API 26), promoted to a Live Update on Android 16 (API 36) where the system allows it. Layouts are
//! written in TSX, TypeScript or Rust. In short: iOS 16.1+ and Android 8+; desktop mutations return
//! `UNSUPPORTED_PLATFORM`.
//!
//! Initialize with `.plugin(tauri_plugin_live_activity::init())` and explicitly grant mutation permissions in the
//! host capability file. `npx tauri-plugin-live-activity setup` grants them, raises the Android minimum to API 26 and
//! adds the widget extension that draws the activity to the Xcode project.
//!
//! The plugin is an adapter of the `liveactivity` crate, the liveactivity-rs bridge: the contract, its checks and
//! the iOS and Android backends are that crate's, and the plugin adds Tauri's commands, events, configuration and
//! Android's permission dialog. [`Builder`] puts layers over the platform's backend, such as a renderer or a log, or
//! a backend of the app's own in its place: a backend implements the bridge's [`LiveActivityBackend`] interface, and
//! a layer [`BackendLayer`], whose methods get the backend under it.
//!
//! ```text
//! tauri-plugin-live-activity   Tauri commands, events, permissions, setup
//!   └─ liveactivity            the liveactivity-rs bridge: one request contract, its checks, the lifecycle
//!        ├─ iOS 16.1+     ──►  activitykit (activitykit-rs): ActivityKit through its Swift bridge
//!        └─ Android 8.0+  ──►  liveupdate (liveupdate-rs): an ongoing notification, a Live Update on Android 16+
//! ```
//!
//! Supported versions, examples and questions: <https://1eedaegon.github.io/tauri-plugin-live-activity/>.

// TP-BUILD-2: a value that is not there is an error to answer, and no reason to end the app's process. Tests may
// unwrap: a test that panics has failed.
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

use tauri::{Manager, Runtime, plugin::TauriPlugin};

mod actions;
#[cfg(target_os = "android")]
mod android;
#[cfg(any(target_os = "android", test))]
mod bridge;
mod builder;
#[cfg(all(test, desktop))]
mod builder_tests;
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
mod layers;
/// Android: the app's activities for a service of its own that runs without Tauri.
#[cfg(target_os = "android")]
pub mod native;
mod openings;
mod service;
#[cfg(test)]
mod types_tests;

pub use builder::Builder;
pub use config::{AndroidConfig, Config, Receipts};
pub use events::{
    ACTION_EVENT, HANDLED_EVENT, OPENED_EVENT, PERMISSIONS_EVENT, PUSH_TO_START_TOKEN_EVENT,
    PUSH_TOKEN_EVENT, STARTED_EVENT, STATE_EVENT, UNKNOWN_EVENT, UPDATED_EVENT,
};
pub use layers::BackendLayer;
/// The activitykit crate that the plugin builds with, for what a layout is built of beside the contract's types:
/// the node functions of `activitykit::layout` (`text`, `vstack`, `button`, …) and `values!`. Its types are
/// `#[non_exhaustive]`: a node is built with those functions, not as a literal.
pub use liveactivity::activitykit;
/// The contract: the requests, records, layout types, errors and checks.
pub use liveactivity::contract::*;
/// The liveupdate crate that the plugin builds with, for what the parts of an Android content take beside the
/// contract's types: its `Timer` for a `TimerStyle`, whose name the contract gives to the template's timer.
pub use liveactivity::liveupdate;
/// What a backend of the app's own or a [`BackendLayer`] implements and gets: the bridge's backend interface, and the
/// events that a backend sends through the context that `attach` gives it.
pub use liveactivity::{BackendContext, BackendFuture, Event, EventSink, LiveActivityBackend};
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

/// Register commands and the platform backend: `Builder::new().build()`. `plugins.live-activity` in the Tauri
/// configuration is optional; see [`Config`]. [`Builder`] takes a backend of the app's own or layers over it.
pub fn init<R: Runtime>() -> TauriPlugin<R, Option<Config>> {
    Builder::new().build()
}
