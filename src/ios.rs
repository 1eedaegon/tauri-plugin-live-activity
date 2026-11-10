//! iOS: the plugin's commands on the activitykit crate, which builds its Swift bridge into the app's Rust library. The
//! plugin has no Swift of its own; the logic it adds is `crate::apple`, generic over the [`Kit`] implemented here, and
//! `apple::glue` maps the requests and runs the taps. This file only hands activitykit's types to them, and no test
//! runs it: the coverage gate leaves it out, and the simulator suite (`tests/ios/run.sh`) drives it.

use crate::{
    Config, Result,
    actions::{ACTION_EVENT, Actions},
    apple::{
        self, Apple, Authorization, EndSpec, Handle, Kit, KitEvent, StartSpec, UpdateSpec, glue,
    },
    layout::{
        ActionEvent, LayoutActivityRecord, LayoutEndInput, LayoutStartInput, LayoutUpdateInput,
    },
    models::*,
    pushes::{PushTokens, TokenBook},
};
use activitykit::{Acknowledgement, Activity, ActivityKit, Event, State, Values};
use std::{future::Future, marker::PhantomData, sync::Arc};
use tauri::{AppHandle, Emitter, Runtime, plugin::PluginApi};

impl Kit for ActivityKit {
    type Handle = Activity;
    type Ack = Acknowledgement;

    fn events(&self) -> Box<dyn Iterator<Item = KitEvent<Activity, Acknowledgement>> + Send> {
        let events = self.events();
        Box::new(glue::events_of(
            move || events.recv_blocking().ok(),
            |event| match event {
                Event::Action {
                    activity,
                    action,
                    acknowledgement,
                    ..
                } => Some(KitEvent::Tap(
                    apple::action_event(&activity, action),
                    acknowledgement,
                )),
                Event::PushToken {
                    activity, token, ..
                } => Some(KitEvent::PushToken {
                    activity,
                    token: token.to_string(),
                }),
                Event::PushToStartToken { token, .. } => Some(KitEvent::PushToStartToken {
                    token: token.to_string(),
                }),
                Event::Updated { activity, .. } => Some(KitEvent::Updated(activity)),
                _ => None,
            },
        ))
    }

    fn authorization(&self) -> Authorization {
        let authorization = ActivityKit::authorization(self);
        Authorization {
            supported: authorization.supported,
            enabled: authorization.enabled,
            buttons: authorization.buttons,
            frequent_pushes: authorization.frequent_pushes,
        }
    }

    async fn start(&self, spec: StartSpec) -> activitykit::Result<Activity> {
        self.start_with(glue::start_of(spec)?).await
    }

    fn activity(
        &self,
        id: &str,
    ) -> impl Future<Output = activitykit::Result<Option<Activity>>> + Send {
        ActivityKit::activity(self, id)
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
        Activity::stale_at(self).and_then(glue::millis)
    }

    fn timestamp(&self) -> Option<u64> {
        Activity::timestamp(self).and_then(glue::millis)
    }

    fn degraded_features(&self) -> Vec<String> {
        Activity::degraded_features(self)
    }

    fn update(&self, spec: UpdateSpec) -> impl Future<Output = activitykit::Result<()>> + Send {
        self.update_with(glue::update_of(spec))
    }

    fn end(&self, spec: EndSpec) -> impl Future<Output = activitykit::Result<()>> + Send {
        Activity::end(self, glue::end_of(spec))
    }
}

/// Creates activitykit's kit early, at plugin setup, with the settings of the plugin configuration, so that a tap that
/// launched the app finds it; `apple::glue::setup` does the rest.
pub(crate) fn init<R: Runtime>(
    app: &AppHandle<R>,
    api: PluginApi<R, Option<Config>>,
) -> Result<LiveActivity<R>> {
    let app = app.clone();
    let pushes = app.clone();
    let (apple, actions, tokens) = glue::setup(
        glue::builder(api.config().as_ref()).build(),
        move |event| {
            let _ = app.emit(ACTION_EVENT, event);
        },
        move |event| {
            let _ = event.emit(&pushes);
        },
    )?;
    Ok(LiveActivity {
        apple,
        actions,
        tokens,
        runtime: PhantomData,
    })
}

pub struct LiveActivity<R: Runtime> {
    pub(crate) apple: Arc<Apple<ActivityKit>>,
    actions: Actions,
    tokens: TokenBook,
    runtime: PhantomData<fn() -> R>,
}

/// Each method blocks its thread until activitykit has answered, which it does from the main thread: on the main thread
/// a method answers `NATIVE_ERROR` at once instead. The commands await the same calls without blocking.
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
        apple::wait(self.apple.start_template(input))
    }
    pub fn update(&self, input: UpdateInput) -> Result<ActivityRecord> {
        apple::wait(self.apple.update_template(input))
    }
    pub fn end(&self, input: EndInput) -> Result<ActivityRecord> {
        apple::wait(self.apple.end_template(input))
    }
    pub fn list(&self) -> Result<Vec<ActivityRecord>> {
        apple::wait(self.apple.list_templates())
    }
    pub fn start_layout(&self, input: LayoutStartInput) -> Result<LayoutActivityRecord> {
        apple::wait(self.apple.start_layout(input))
    }
    pub fn update_layout(&self, input: LayoutUpdateInput) -> Result<LayoutActivityRecord> {
        apple::wait(self.apple.update_layout(input))
    }
    pub fn end_layout(&self, input: LayoutEndInput) -> Result<LayoutActivityRecord> {
        apple::wait(self.apple.end_layout(input))
    }
    pub fn list_layout(&self) -> Result<Vec<LayoutActivityRecord>> {
        apple::wait(self.apple.list_layout())
    }

    /// The push tokens the plugin holds since launch: the newest of each of the last [`TOKENS_KEPT`](crate::TOKENS_KEPT)
    /// activities that got one, and the app's push-to-start token. The events report each token as it comes; this is
    /// for a reader that came later, as a page that subscribes after launch.
    pub fn push_tokens(&self) -> Result<PushTokens> {
        Ok(self.tokens.tokens())
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
    /// run. The tap's intent, and so an app that the system launched for it, waits until the handlers registered at
    /// the time of the tap have run and the tap has gone to JavaScript, for at most 4 seconds. JavaScript listeners are
    /// not awaited.
    pub fn on_action(&self, handler: impl Fn(ActionEvent) + Send + Sync + 'static) {
        self.actions.subscribe(handler);
    }
}
