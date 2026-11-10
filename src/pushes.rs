//! The events of pushes on their way from activitykit to JavaScript: a push token of an activity, the app's
//! push-to-start token, and content a push delivered. The plugin's events thread emits each as it comes, without
//! waiting for anything; the taps keep their own way through the handlers of `on_action` (`crate::actions`).
//! Android has no pushes, and nothing of this comes there.

use crate::layout::LayoutActivityRecord;
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "ios", test))]
use tauri::{Emitter, Runtime};

/// The Tauri event that carries a [`PushTokenEvent`].
#[cfg(any(target_os = "ios", test))]
pub(crate) const PUSH_TOKEN_EVENT: &str = "live-activity://push-token";
/// The Tauri event that carries a [`PushToStartTokenEvent`].
#[cfg(any(target_os = "ios", test))]
pub(crate) const PUSH_TO_START_TOKEN_EVENT: &str = "live-activity://push-to-start-token";
/// The Tauri event that carries an [`UpdatedEvent`].
#[cfg(any(target_os = "ios", test))]
pub(crate) const UPDATED_EVENT: &str = "live-activity://updated";

/// A push token of an activity that asked for one (`push: "token"`), new or changed: what the server sends to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushTokenEvent {
    pub activity_id: String,
    /// Absent when the plugin no longer knows that activity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_key: Option<String>,
    /// Lowercase hex, as APNs takes it.
    pub token: String,
}

/// The app's push-to-start token, new or changed (`pushToStart` in the plugin configuration, iOS 17.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushToStartTokenEvent {
    /// Lowercase hex, as APNs takes it.
    pub token: String,
}

/// Content a push delivered: the activity's record with it, above every revision the app sent or accepted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedEvent {
    pub record: LayoutActivityRecord,
}

/// One event of the pushes, with the Tauri event that carries it.
#[cfg(any(target_os = "ios", test))]
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PushEvent {
    Token(PushTokenEvent),
    PushToStartToken(PushToStartTokenEvent),
    Updated(UpdatedEvent),
}

#[cfg(any(target_os = "ios", test))]
impl PushEvent {
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::Token(_) => PUSH_TOKEN_EVENT,
            Self::PushToStartToken(_) => PUSH_TO_START_TOKEN_EVENT,
            Self::Updated(_) => UPDATED_EVENT,
        }
    }

    /// Sends the event to every JavaScript listener of its name.
    pub(crate) fn emit<R: Runtime>(&self, app: &impl Emitter<R>) -> tauri::Result<()> {
        match self {
            Self::Token(event) => app.emit(self.name(), event),
            Self::PushToStartToken(event) => app.emit(self.name(), event),
            Self::Updated(event) => app.emit(self.name(), event),
        }
    }
}
