//! The events of the contract on Tauri's event API. The backend reports them one at a time on one thread:
//! liveactivity's events thread on iOS, the plugin's draining thread on Android. Tauri runs the app's Rust listeners
//! inline in an emit, on that thread: one that blocks delays the taps and the events behind it.

use crate::actions::Actions;
use liveactivity::Event;
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    sync::mpsc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};

/// The Tauri event that carries an [`ActionEvent`](crate::ActionEvent) to JavaScript.
pub const ACTION_EVENT: &str = "live-activity://action";
/// The Tauri event that carries a [`PushTokenEvent`](crate::PushTokenEvent).
pub const PUSH_TOKEN_EVENT: &str = "live-activity://push-token";
/// The Tauri event that carries a [`PushToStartTokenEvent`](crate::PushToStartTokenEvent).
pub const PUSH_TO_START_TOKEN_EVENT: &str = "live-activity://push-to-start-token";
/// The Tauri event that carries an [`UpdatedEvent`](crate::UpdatedEvent).
pub const UPDATED_EVENT: &str = "live-activity://updated";
/// The Tauri event that carries a [`StartedEvent`](crate::StartedEvent): a layout activity began, one the app
/// started or one a push started (iOS).
pub const STARTED_EVENT: &str = "live-activity://started";
/// The Tauri event that carries a [`StateEvent`](crate::StateEvent): a new lifecycle state of an activity. iOS
/// reports every change while the app runs; Android reports that the person dismissed the notification of a layout
/// activity.
pub const STATE_EVENT: &str = "live-activity://state";
/// The Tauri event that carries the [`Permissions`](crate::Permissions) after the person changed them in
/// Settings (iOS).
pub const PERMISSIONS_EVENT: &str = "live-activity://permissions";

/// How long a tap waits for the handlers of `on_action`: what iOS gives a tap's intent.
const HANDLERS: Duration = Duration::from_secs(4);

/// The sink of the backend's events. A tap goes to the handlers of `on_action` and then to JavaScript, and the sink
/// returns once they are done, because on iOS the tap's intent is held until then; every other event goes to
/// JavaScript. A Rust listener of the app that panics in an emit is caught here, so that it ends neither the thread
/// that reports the events nor the taps behind it. Tauri itself delivers no event to the app's Rust listeners after
/// such a panic, which poisons its registry of them; the web views, which it sends to first, go on receiving.
pub(crate) fn sink<R: Runtime>(
    app: AppHandle<R>,
    actions: Actions,
) -> impl Fn(Event) + Send + Sync + 'static {
    sink_within(app, actions, HANDLERS)
}

/// [`sink`] with the time that a tap waits for its handlers given, which a test shortens.
pub(crate) fn sink_within<R: Runtime>(
    app: AppHandle<R>,
    actions: Actions,
    handlers: Duration,
) -> impl Fn(Event) + Send + Sync + 'static {
    move |event| {
        let _ = catch_unwind(AssertUnwindSafe(|| match event {
            Event::Action(tap) => {
                // The dispatcher drops `held` once the handlers have run and the tap was emitted.
                let (held, released) = mpsc::channel::<()>();
                actions.tap(tap, held);
                let _ = released.recv_timeout(handlers);
            }
            Event::PushToken(token) => {
                let _ = app.emit(PUSH_TOKEN_EVENT, token);
            }
            Event::PushToStartToken(token) => {
                let _ = app.emit(PUSH_TO_START_TOKEN_EVENT, token);
            }
            Event::Updated(updated) => {
                let _ = app.emit(UPDATED_EVENT, updated);
            }
            Event::Started(started) => {
                let _ = app.emit(STARTED_EVENT, started);
            }
            Event::State(state) => {
                let _ = app.emit(STATE_EVENT, state);
            }
            Event::Permissions(permissions) => {
                let _ = app.emit(PERMISSIONS_EVENT, permissions);
            }
            _ => {}
        }));
    }
}
