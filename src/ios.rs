//! iOS: the plugin's commands on the activitykit crate, which builds its Swift bridge into the app's Rust library. The
//! plugin has no Swift of its own; the logic it adds is `crate::apple`, generic over the [`Kit`] implemented here.

use crate::{
    Config, Error, Receipts, Result,
    actions::{self, ACTION_EVENT, Actions},
    apple::{self, Apple, Authorization, EndSpec, Handle, Kit, StartSpec, UpdateSpec},
    layout::{
        ActionEvent, LayoutActivityRecord, LayoutEndInput, LayoutStartInput, LayoutUpdateInput,
    },
    models::*,
};
use activitykit::{Activity, ActivityKit, End, Event, Start, State, Update, Values};
use std::{
    future::Future,
    marker::PhantomData,
    sync::Arc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Runtime, plugin::PluginApi};

fn time(millis: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(millis)
}

fn millis(at: SystemTime) -> Option<u64> {
    u64::try_from(at.duration_since(UNIX_EPOCH).ok()?.as_millis()).ok()
}

impl Kit for ActivityKit {
    type Handle = Activity;

    fn authorization(&self) -> Authorization {
        let authorization = ActivityKit::authorization(self);
        Authorization {
            supported: authorization.supported,
            enabled: authorization.enabled,
            buttons: authorization.buttons,
        }
    }

    fn start(&self, spec: StartSpec) -> impl Future<Output = activitykit::Result<Activity>> + Send {
        let mut start = Start::new(spec.layout, spec.values).key(spec.key);
        if let Some(at) = spec.stale_at {
            start = start.stale_at(time(at));
        }
        self.start_with(start)
    }

    fn activities(&self) -> impl Future<Output = activitykit::Result<Vec<Activity>>> + Send {
        ActivityKit::activities(self)
    }

    fn write_image(&self, name: &str, png: &[u8]) -> activitykit::Result<()> {
        ActivityKit::write_image(self, name, png)
    }
}

impl Handle for Activity {
    fn id(&self) -> &str {
        Activity::id(self)
    }

    fn key(&self) -> &str {
        Activity::key(self)
    }

    fn state(&self) -> State {
        Activity::state(self)
    }

    fn values(&self) -> Values {
        Activity::values(self)
    }

    fn revision(&self) -> Option<u64> {
        Activity::revision(self)
    }

    fn stale_at(&self) -> Option<u64> {
        Activity::stale_at(self).and_then(millis)
    }

    fn degraded_features(&self) -> Vec<String> {
        Activity::degraded_features(self)
    }

    fn update(&self, spec: UpdateSpec) -> impl Future<Output = activitykit::Result<()>> + Send {
        let mut update = Update::new(spec.values);
        if let Some(at) = spec.stale_at {
            update = update.stale_at(time(at));
        }
        if let Some(at) = spec.timestamp {
            update = update.timestamp(time(at));
        }
        self.update_with(update)
    }

    fn end(&self, spec: EndSpec) -> impl Future<Output = activitykit::Result<()>> + Send {
        let mut end = match spec.policy {
            EndPolicy::Immediate {} => End::immediately(),
            EndPolicy::Default {} => End::default(),
            EndPolicy::After { at } => End::after(time(at)),
        };
        if let Some(values) = spec.values {
            end = end.values(values);
        }
        if let Some(at) = spec.stale_at {
            end = end.stale_at(time(at));
        }
        if let Some(at) = spec.timestamp {
            end = end.timestamp(time(at));
        }
        Activity::end(self, end)
    }
}

/// Creates activitykit's kit early, at plugin setup: a tap that launched the app waits for it. One thread reads its
/// events from then on and hands every tap to the handlers of `on_action` and then to JavaScript.
pub(crate) fn init<R: Runtime>(
    app: &AppHandle<R>,
    api: PluginApi<R, Option<Config>>,
) -> Result<LiveActivity<R>> {
    let redacted =
        api.config().as_ref().and_then(|config| config.receipts) == Some(Receipts::Redacted);
    let kit = ActivityKit::new();
    let apple = Arc::new(Apple::new(kit.clone(), redacted));
    let app = app.clone();
    let actions = actions::spawn(move |event| {
        let _ = app.emit(ACTION_EVENT, event);
    })?;
    let events = kit.events();
    let (listener, taps) = (apple.clone(), actions.clone());
    thread::Builder::new()
        .name("live-activity-events".into())
        .spawn(move || {
            while let Ok(event) = events.recv_blocking() {
                match event {
                    Event::Action {
                        activity, action, ..
                    } => {
                        listener.remember(&activity);
                        taps.tap(apple::action_event(&activity, action));
                    }
                    Event::Started { activity, .. } | Event::State { activity, .. } => {
                        listener.remember(&activity)
                    }
                    _ => {}
                }
            }
        })
        .map_err(|_| Error::native())?;
    Ok(LiveActivity {
        apple,
        actions,
        runtime: PhantomData,
    })
}

pub struct LiveActivity<R: Runtime> {
    pub(crate) apple: Arc<Apple<ActivityKit>>,
    actions: Actions,
    runtime: PhantomData<fn() -> R>,
}

/// Each method blocks its thread until activitykit has answered, which it does from the main thread: never call one
/// on the main thread. The commands await the same calls without blocking.
impl<R: Runtime> LiveActivity<R> {
    pub fn get_capabilities(&self) -> Result<Capabilities> {
        Ok(self.apple.capabilities())
    }
    pub fn check_permissions(&self) -> Result<Permissions> {
        Ok(self.apple.permissions(false))
    }
    pub fn request_permissions(&self, kind: PermissionKind) -> Result<Permissions> {
        self.apple.request_permissions(kind)
    }
    pub fn start(&self, input: StartInput) -> Result<ActivityRecord> {
        apple::block_on(self.apple.start_template(input))
    }
    pub fn update(&self, input: UpdateInput) -> Result<ActivityRecord> {
        apple::block_on(self.apple.update_template(input))
    }
    pub fn end(&self, input: EndInput) -> Result<ActivityRecord> {
        apple::block_on(self.apple.end_template(input))
    }
    pub fn list(&self) -> Result<Vec<ActivityRecord>> {
        apple::block_on(self.apple.list_templates())
    }
    pub fn start_layout(&self, input: LayoutStartInput) -> Result<LayoutActivityRecord> {
        apple::block_on(self.apple.start_layout(input))
    }
    pub fn update_layout(&self, input: LayoutUpdateInput) -> Result<LayoutActivityRecord> {
        apple::block_on(self.apple.update_layout(input))
    }
    pub fn end_layout(&self, input: LayoutEndInput) -> Result<LayoutActivityRecord> {
        apple::block_on(self.apple.end_layout(input))
    }
    pub fn list_layout(&self) -> Result<Vec<LayoutActivityRecord>> {
        apple::block_on(self.apple.list_layout())
    }

    /// Writes a PNG that `image` nodes with the source `{ "file": name }` show, replacing an earlier one of that name,
    /// into `activitykit/images` of the App Group that the widget extension names under `ActivityKitAppGroup`
    /// (`setup --app-group`), else `CONFIGURATION_REQUIRED`. The widget reads it whenever it draws: write the new
    /// picture first, then send the update. See [`check_image`](crate::check_image) for the limits.
    pub fn write_image(&self, name: &str, png: &[u8]) -> Result<()> {
        self.apple.write_image(name, png)
    }

    /// Calls `handler` for every tap on a button node, on a thread of the plugin and never on the main thread, so the
    /// handler may call the plugin. Handlers stay for the life of the plugin. Taps that arrive before the first
    /// handler wait for it.
    ///
    /// Register handlers on the built `App`, before `App::run`, or in the setup of a plugin, and not in
    /// `Builder::setup`: when the system launches the app in the background for a tap, `Builder::setup` may never
    /// run. activitykit lets the tap's intent return once the plugin has taken the tap, at most 4 seconds after it.
    pub fn on_action(&self, handler: impl Fn(ActionEvent) + Send + Sync + 'static) {
        self.actions.subscribe(handler);
    }
}
