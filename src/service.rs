use crate::{
    ActionEvent, ActivityRecord, Capabilities, EndInput, LayoutActivityRecord, LayoutEndInput,
    LayoutStartInput, LayoutUpdateInput, OpenedEvent, PermissionKind, Permissions, PushTokens,
    Result, StartInput, UpdateInput,
    actions::{self, Actions},
    events::{self, ACTION_EVENT},
    exact_alarms::ExactAlarms,
    openings::Openings,
};
use liveactivity::{LiveActivityBackend, wait};
use std::{marker::PhantomData, sync::Arc};
use tauri::{AppHandle, Emitter, Runtime};

/// The plugin on `backend`: its taps go to the handlers of `on_action` and to JavaScript, its other events to
/// JavaScript, and its openings wait as well until they are taken. `exact_alarms` is the side of the platform that
/// opens the setting for exact alarms.
pub(crate) fn connect<R: Runtime>(
    app: &AppHandle<R>,
    backend: impl LiveActivityBackend,
    exact_alarms: impl ExactAlarms,
) -> Result<LiveActivity<R>> {
    let emitter = app.clone();
    let actions = actions::spawn(move |event| {
        let _ = emitter.emit(ACTION_EVENT, event);
    })?;
    let openings = Arc::<Openings>::default();
    let live = liveactivity::LiveActivity::builder()
        .backend(backend)
        .event_sink(events::sink(app.clone(), actions.clone(), openings.clone()))
        .build()?;
    Ok(LiveActivity {
        live,
        actions,
        openings,
        exact_alarms: Arc::new(exact_alarms),
        runtime: PhantomData,
    })
}

/// Opens the setting for exact alarms through `exact_alarms` and answers the capabilities of `live` as they are
/// when the person is back. An error of the side that opens the setting is the answer, and nothing more is asked.
pub(crate) async fn open_exact_alarm_settings(
    live: liveactivity::LiveActivity,
    exact_alarms: Arc<dyn ExactAlarms>,
) -> Result<Capabilities> {
    exact_alarms.open_settings().await?;
    live.capabilities().await
}

/// The plugin's Rust API. Each method blocks its thread until the backend has answered. On iOS the answer comes
/// from the main thread: on the main thread a method answers `NATIVE_ERROR` at once instead. The commands await
/// the same calls without blocking.
pub struct LiveActivity<R: Runtime> {
    pub(crate) live: liveactivity::LiveActivity,
    actions: Actions,
    pub(crate) openings: Arc<Openings>,
    pub(crate) exact_alarms: Arc<dyn ExactAlarms>,
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

    /// Opens Android's setting where the person allows the app exact alarms ("Alarms & reminders"), which a
    /// scheduled start needs to begin at its time, and answers when they are back, with the capabilities as they
    /// are then: `android_presentation.exact_start` says whether the app may set an exact alarm. Where one may be
    /// set already, before Android 12 or with the permission, it opens nothing and answers the capabilities at
    /// once.
    ///
    /// Android shows the setting for an app whose own manifest declares `SCHEDULE_EXACT_ALARM`: without the
    /// declaration the call answers `CONFIGURATION_REQUIRED`. It answers `NOT_FOREGROUND` while the app is not on
    /// screen, and `UNSUPPORTED_FEATURE` on a device without the setting and on iOS, which begins a scheduled
    /// start itself. Desktop answers `UNSUPPORTED_PLATFORM`.
    ///
    /// The call waits for the person, who may take minutes, so choose its thread with care. On Android's own
    /// main thread, which Rust is on only inside a callback of the Kotlin side, it never returns: that thread has
    /// to show the setting. On the thread of Tauri's event loop it holds every event of the app for as long. In a
    /// handler of [`on_action`](Self::on_action) it holds the taps that follow, which share the handlers' thread.
    /// A thread of its own, or the command, which a page awaits, has neither trouble.
    pub fn open_exact_alarm_settings(&self) -> Result<Capabilities> {
        wait(open_exact_alarm_settings(
            self.live.clone(),
            Arc::clone(&self.exact_alarms),
        ))
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

    /// Takes the openings of the app from an activity's notification that nobody has taken yet (Android), oldest
    /// first: each is handed over once. [`OPENED_EVENT`](crate::OPENED_EVENT) reports an opening as it comes, but
    /// the one that launched the app comes before the app's listeners and its page are there, and no record holds
    /// an opening. So the plugin keeps each until it is taken, the newest [`OPENINGS_KEPT`](crate::OPENINGS_KEPT).
    /// The page's `onOpened` asks for them when it subscribes and at every event; an app that handles openings in
    /// Rust takes them here instead, at its start and when the event comes. What Rust takes is gone for the page.
    pub fn take_openings(&self) -> Vec<OpenedEvent> {
        self.openings.take()
    }

    /// Calls `handler` for every tap on a button or a toggle node, on a thread of the plugin and never on the main
    /// thread, so the handler may call the plugin. Handlers stay for the life of the plugin. Taps that arrive before
    /// the first handler wait for it.
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
