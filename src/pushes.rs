//! The events of pushes on their way from activitykit to JavaScript: a push token of an activity, the app's
//! push-to-start token, and content a push delivered. The plugin's events thread emits each as it comes, without
//! waiting for the handlers of `on_action` or for JavaScript; the taps keep their own way through those handlers
//! (`crate::actions`). A Tauri event reaches only the listeners there are when it goes out, and a token may come
//! before the page listens, at launch above all: the plugin keeps the newest tokens ([`TokenBook`]) for `pushTokens`,
//! which `onPushToken` and `onPushToStartToken` read right after subscribing. Android has no pushes, and nothing of
//! this comes there.

use crate::layout::LayoutActivityRecord;
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "ios", test))]
use std::sync::{Arc, Mutex, PoisonError};
#[cfg(any(target_os = "ios", test))]
use tauri::{Emitter, Runtime};

/// The Tauri event that carries a [`PushTokenEvent`]. Rust listeners run on the plugin's events thread, inline: one
/// that blocks delays the taps and the events behind it.
pub const PUSH_TOKEN_EVENT: &str = "live-activity://push-token";
/// The Tauri event that carries a [`PushToStartTokenEvent`]; see [`PUSH_TOKEN_EVENT`] for Rust listeners.
pub const PUSH_TO_START_TOKEN_EVENT: &str = "live-activity://push-to-start-token";
/// The Tauri event that carries an [`UpdatedEvent`]; see [`PUSH_TOKEN_EVENT`] for Rust listeners.
pub const UPDATED_EVENT: &str = "live-activity://updated";
/// How many activities' tokens the plugin keeps, the newest.
pub const TOKENS_KEPT: usize = 32;

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

/// Content a push delivered: the activity's record with it, above every revision the app sent or accepted. The
/// record is the activity's state when the plugin reads the event: two pushes close together may both report the
/// later content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedEvent {
    pub record: LayoutActivityRecord,
}

/// The tokens the plugin holds since launch: the newest of each of the last [`TOKENS_KEPT`] activities that got one,
/// and the app's push-to-start token, as their events reported them. What `pushTokens` answers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushTokens {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push_to_start: Option<String>,
    /// In the order the activities' first tokens came.
    pub activities: Vec<PushTokenEvent>,
}

/// The plugin's record of the tokens, written by the events thread before each event goes out; clones share it.
#[cfg(any(target_os = "ios", test))]
#[derive(Clone, Default)]
pub(crate) struct TokenBook(Arc<Mutex<PushTokens>>);

#[cfg(any(target_os = "ios", test))]
impl TokenBook {
    /// Takes what `event` brings: a token replaces the activity's, a push-to-start token the app's.
    pub(crate) fn note(&self, event: &PushEvent) {
        let mut tokens = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        match event {
            PushEvent::Token(token) => {
                let activities = &mut tokens.activities;
                match activities
                    .iter_mut()
                    .find(|held| held.activity_id == token.activity_id)
                {
                    Some(held) => *held = token.clone(),
                    None => {
                        if activities.len() == TOKENS_KEPT {
                            activities.remove(0);
                        }
                        activities.push(token.clone());
                    }
                }
            }
            PushEvent::PushToStartToken(token) => tokens.push_to_start = Some(token.token.clone()),
            PushEvent::Updated(_) => {}
        }
    }

    pub(crate) fn tokens(&self) -> PushTokens {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
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
