use crate::{
    ActionEvent, ActivityRecord, Capabilities, EndInput, LayoutActivityRecord, LayoutEndInput,
    LayoutStartInput, LayoutUpdateInput, PermissionKind, Permissions, PushTokens, Result,
    StartInput, UpdateInput,
    actions::{self, Actions},
    events::{self, ACTION_EVENT},
};
use liveactivity::{LiveActivityBackend, wait};
use std::{marker::PhantomData, sync::mpsc};
use tauri::{AppHandle, Emitter, Runtime};

/// The plugin on `backend`: its taps go to the handlers of `on_action` and to JavaScript, its push events to
/// JavaScript.
pub(crate) fn connect<R: Runtime>(
    app: &AppHandle<R>,
    backend: impl LiveActivityBackend,
    keep: Option<mpsc::Sender<()>>,
) -> Result<LiveActivity<R>> {
    let emitter = app.clone();
    let actions = actions::spawn(move |event| {
        let _ = emitter.emit(ACTION_EVENT, event);
    })?;
    let live = liveactivity::LiveActivity::builder()
        .backend(backend)
        .event_sink(events::sink(app.clone(), actions.clone()))
        .build()?;
    Ok(LiveActivity {
        live,
        actions,
        _keep: keep,
        runtime: PhantomData,
    })
}

/// The plugin's Rust API. Each method blocks its thread until the backend has answered. On iOS the answer comes
/// from the main thread: on the main thread a method answers `NATIVE_ERROR` at once instead. The commands await
/// the same calls without blocking.
pub struct LiveActivity<R: Runtime> {
    pub(crate) live: liveactivity::LiveActivity,
    actions: Actions,
    /// Android: keeps the thread that drains the taps waiting; it ends when the plugin does.
    _keep: Option<mpsc::Sender<()>>,
    runtime: PhantomData<fn() -> R>,
}

impl<R: Runtime> LiveActivity<R> {
    pub fn get_capabilities(&self) -> Result<Capabilities> {
        wait(self.live.capabilities())
    }
    pub fn check_permissions(&self) -> Result<Permissions> {
        wait(self.live.permissions())
    }
    pub fn request_permissions(&self, kind: PermissionKind) -> Result<Permissions> {
        wait(self.live.request_permissions(kind))
    }
    pub fn start(&self, input: StartInput) -> Result<ActivityRecord> {
        wait(self.live.start(input))
    }
    pub fn update(&self, input: UpdateInput) -> Result<ActivityRecord> {
        wait(self.live.update(input))
    }
    pub fn end(&self, input: EndInput) -> Result<ActivityRecord> {
        wait(self.live.end(input))
    }
    pub fn list(&self) -> Result<Vec<ActivityRecord>> {
        wait(self.live.list())
    }
    pub fn start_layout(&self, input: LayoutStartInput) -> Result<LayoutActivityRecord> {
        wait(self.live.start_layout(input))
    }
    pub fn update_layout(&self, input: LayoutUpdateInput) -> Result<LayoutActivityRecord> {
        wait(self.live.update_layout(input))
    }
    pub fn end_layout(&self, input: LayoutEndInput) -> Result<LayoutActivityRecord> {
        wait(self.live.end_layout(input))
    }
    pub fn list_layout(&self) -> Result<Vec<LayoutActivityRecord>> {
        wait(self.live.list_layout())
    }

    /// The push tokens the plugin holds since launch: the newest of each of the last [`TOKENS_KEPT`](crate::TOKENS_KEPT)
    /// activities that got one, and the app's push-to-start token. The events report each token as it comes; this is
    /// for a reader that came later, as a page that subscribes after launch. Android and desktop hold none.
    pub fn push_tokens(&self) -> Result<PushTokens> {
        wait(self.live.push_tokens())
    }

    /// Writes a PNG that `image` nodes with the source `{ "file": name }` show, replacing an earlier one of that
    /// name. See [`check_image`](crate::check_image) for the limits. On iOS it goes into `activitykit/images` of the
    /// App Group that the widget extension names (`setup --app-group`), else `CONFIGURATION_REQUIRED`; on Android
    /// to the app's private files, where the first such image of a layout becomes the notification's large icon.
    /// Desktop checks the PNG and returns `UNSUPPORTED_PLATFORM`.
    pub fn write_image(&self, name: &str, png: &[u8]) -> Result<()> {
        wait(self.live.write_image(name, png))
    }

    /// Calls `handler` for every tap on a button node, on a thread of the plugin and never on the main thread, so the
    /// handler may call the plugin. Handlers stay for the life of the plugin. Taps that arrive before the first
    /// handler wait for it.
    ///
    /// Register handlers on the built `App`, before `App::run`, or in the setup of a plugin, and not in
    /// `Builder::setup`: when the system launches the app in the background for a tap, `Builder::setup` may never
    /// run. On iOS the tap's intent, and so an app that the system launched for it, waits until the handlers
    /// registered at the time of the tap have run and the tap has gone to JavaScript, for at most 4 seconds. On
    /// Android liveupdate's receiver stores each tap, also while the app does not run, and the plugin drains them as
    /// they come and when it starts. JavaScript listeners are not awaited. Desktop shows no activity, so no handler
    /// is ever called.
    pub fn on_action(&self, handler: impl Fn(ActionEvent) + Send + Sync + 'static) {
        self.actions.subscribe(handler);
    }
}
