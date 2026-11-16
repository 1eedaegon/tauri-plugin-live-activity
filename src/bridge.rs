use crate::{Error, Result};
use liveactivity::{
    android::{AndroidFiles, LiveUpdateBackend},
    liveupdate,
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    future::Future,
    panic::{AssertUnwindSafe, catch_unwind},
    pin::Pin,
    task::{Context, Poll},
};

/// What `call` answers, or `None` when it panicked. Tauri reaches the plugin's Kotlin side through wry, which needs
/// one of the app's activities and panics while there is none: in a process that has outlived its last activity,
/// as one whose app prevents its exit, that is every call. A panic that unwinds is caught here; one that aborts
/// (`panic = "abort"`) ends the process whatever the plugin does.
///
/// It belongs right at the call into Tauri, which panics before anything reaches the Kotlin side. A guard further
/// out lets the panic pass through whatever holds a lock on the way: see [`ContainedBridge`].
pub(crate) fn contained<T>(call: impl FnOnce() -> T) -> Option<T> {
    catch_unwind(AssertUnwindSafe(call)).ok()
}

/// As [`contained`], for a call that waits: `None` when a poll of it panicked.
pub(crate) struct Contained<F>(Pin<Box<F>>);

impl<F: Future> Contained<F> {
    pub(crate) fn new(call: F) -> Self {
        Self(Box::pin(call))
    }
}

impl<F: Future> Future for Contained<F> {
    type Output = Option<F::Output>;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        match contained(|| self.0.as_mut().poll(context)) {
            Some(Poll::Ready(answer)) => Poll::Ready(Some(answer)),
            Some(Poll::Pending) => Poll::Pending,
            None => Poll::Ready(None),
        }
    }
}

/// What liveupdate's transport answers when the call to the Kotlin side fails.
pub(crate) fn adapter_failed() -> liveupdate::Error {
    liveupdate::Error::new(
        liveupdate::ErrorCode::NativeError,
        "The Android live update adapter failed.",
    )
}

/// liveupdate's transport `B` with [`contained`] under it: a call that panics has failed, as one that Tauri
/// answers with an error. The guard is here, under liveactivity's backend, and not around the backend's calls, so
/// that every caller of the backend has it: the backend catches no panic, so one that passed through would reach
/// whoever called the backend, and a call of the app's own Rust would unwind into the app. The thread that drains
/// would take such a panic as a drain that failed or as a time that cannot be read (`drain::run`). With
/// liveactivity 0.7.1 it also left the lock of the backend's layouts poisoned, and every drain and every call for
/// a layout answered `NATIVE_ERROR` from then on, as long as the process lived; 0.7.2 takes that lock again after
/// such a panic.
pub(crate) struct ContainedBridge<B>(B);

impl<B: liveupdate::Bridge> liveupdate::Bridge for ContainedBridge<B> {
    fn invoke(&self, command: &str, payload: &str) -> liveupdate::Result<String> {
        contained(|| self.0.invoke(command, payload)).unwrap_or_else(|| Err(adapter_failed()))
    }
}

/// liveactivity's Android backend as the plugin runs it.
pub(crate) type Engine<B> = LiveUpdateBackend<liveupdate::JsonDriver<ContainedBridge<B>>>;

/// The backend over `bridge`, the transport to the Kotlin side, with the plugin's `files`. The plugin has no other
/// way to it: the guard of [`ContainedBridge`] is under every backend it runs.
pub(crate) fn engine<B: liveupdate::Bridge + 'static>(bridge: B, files: AndroidFiles) -> Engine<B> {
    LiveUpdateBackend::over_bridge(ContainedBridge(bridge)).with_files(files)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    ok: bool,
    data: Option<Value>,
    error: Option<Error>,
}

pub(crate) fn decode<T: DeserializeOwned>(value: Value) -> Result<T> {
    let reply: Reply = serde_json::from_value(value).map_err(|_| Error::native())?;
    match (reply.ok, reply.data, reply.error) {
        (true, Some(data), None) => serde_json::from_value(data).map_err(|_| Error::native()),
        (false, None, Some(error)) => Err(error),
        _ => Err(Error::native()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use liveactivity::{BackendContext, LiveActivityBackend, wait};
    use serde_json::json;
    use std::{
        future::{self, Future},
        pin::pin,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        task::{Context, Poll, Waker},
    };

    /// liveupdate's Kotlin side as far as a drain, the question for the next time and a list of layouts ask it: a
    /// store with nothing in it. While the app has `no_activity`, the call panics as Tauri's does.
    struct Kotlin {
        no_activity: Arc<AtomicBool>,
    }

    impl liveupdate::Bridge for Kotlin {
        fn invoke(&self, command: &str, _payload: &str) -> liveupdate::Result<String> {
            assert!(
                !self.no_activity.load(Ordering::SeqCst),
                "no available activity"
            );
            let data = match command {
                "events" => r#"{"events":[],"dropped":0}"#,
                _ => "[]",
            };
            Ok(format!(r#"{{"status":"ok","data":{data}}}"#))
        }
    }

    // TP-ANDROID-19
    #[test]
    fn a_call_that_panics_under_the_backend_leaves_the_backend_whole() {
        let no_activity = Arc::new(AtomicBool::new(false));
        let folder =
            std::env::temp_dir().join(format!("live-activity-bridge-{}", std::process::id()));
        let kotlin = Kotlin {
            no_activity: no_activity.clone(),
        };
        let engine = engine(kotlin, AndroidFiles::new("Mochi", &folder));
        engine.attach(BackendContext::new(|_| {})).unwrap();
        assert_eq!(engine.pump_events().unwrap(), 0);
        assert!(wait(engine.list_layout()).unwrap().is_empty());
        // No activity: what the thread asks and what a page asks fail, and none of them panics.
        no_activity.store(true, Ordering::SeqCst);
        assert_eq!(engine.pump_events().unwrap_err().code, "NATIVE_ERROR");
        assert!(engine.next_check().is_err());
        assert_eq!(wait(engine.list_layout()).unwrap_err().code, "NATIVE_ERROR");
        // An activity again: the backend is as it was, and nothing panicked on the way. A panic that had passed
        // through the backend would have reached the caller here, as it would the thread that drains.
        no_activity.store(false, Ordering::SeqCst);
        assert_eq!(engine.pump_events().unwrap(), 0);
        assert!(wait(engine.list_layout()).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(folder);
    }

    // TP-ANDROID-19
    #[test]
    fn a_call_that_panics_is_one_without_an_answer() {
        assert_eq!(contained(|| 7), Some(7));
        let panicked: Option<u8> = contained(|| panic!("no available activity"));
        assert_eq!(panicked, None);
        // What the caller makes of it is the plugin's error, as of a reply that cannot be read.
        let answer: Result<u8> =
            contained(|| panic!("no available activity")).ok_or_else(Error::native);
        assert_eq!(answer.unwrap_err().code, "NATIVE_ERROR");
    }

    // TP-ANDROID-19
    #[test]
    fn a_call_that_waits_and_panics_is_one_without_an_answer() {
        let mut context = Context::from_waker(Waker::noop());
        // An answer that is there, and one that comes at a later poll.
        assert_eq!(
            pin!(Contained::new(future::ready(7))).poll(&mut context),
            Poll::Ready(Some(7))
        );
        let mut polls = 0;
        let mut later = pin!(Contained::new(future::poll_fn(|_| {
            polls += 1;
            if polls < 2 {
                Poll::Pending
            } else {
                Poll::Ready(polls)
            }
        })));
        assert_eq!(later.as_mut().poll(&mut context), Poll::Pending);
        assert_eq!(later.as_mut().poll(&mut context), Poll::Ready(Some(2)));
        // A panic at the first poll, where Tauri reaches for the activity, and one at a later poll.
        let at_once = Contained::new(future::poll_fn(|_| -> Poll<u8> {
            panic!("no available activity")
        }));
        assert_eq!(pin!(at_once).poll(&mut context), Poll::Ready(None));
        let mut polls = 0;
        let mut later = pin!(Contained::new(future::poll_fn(|_| -> Poll<u8> {
            polls += 1;
            assert!(polls < 2, "no available activity");
            Poll::Pending
        })));
        assert_eq!(later.as_mut().poll(&mut context), Poll::Pending);
        assert_eq!(later.as_mut().poll(&mut context), Poll::Ready(None));
    }

    // TP-ANDROID-12
    #[test]
    fn unwraps_success_and_preserves_stable_native_errors() {
        assert_eq!(
            decode::<Vec<u8>>(json!({"ok":true,"data":[1,2]})).unwrap(),
            [1, 2]
        );
        let error = decode::<Value>(
            json!({"ok":false,"error":{"code":"PERMISSION_DENIED","message":"Disabled"}}),
        )
        .unwrap_err();
        assert_eq!(error.code, "PERMISSION_DENIED");
    }

    // TP-ANDROID-12
    #[test]
    fn malformed_native_replies_fail_closed() {
        for value in [
            json!(null),
            json!({"ok":true}),
            json!({"ok":false}),
            json!({"ok":true,"data":1,"error":{"code":"X","message":"X"}}),
            json!({"ok":false,"data":1}),
            json!({"ok":true,"data":1,"extra":true}),
            json!({"ok":true,"data":"private-value"}),
        ] {
            let error = decode::<u64>(value).unwrap_err();
            assert_eq!(error.code, "NATIVE_ERROR");
            assert!(!error.message.contains("private-value"));
        }
    }

    // TP-ANDROID-12, TP-ANDROID-13
    #[test]
    fn what_the_kotlin_side_answers_reads_into_the_contracts_permissions_and_liveupdates_reply() {
        use crate::{PermissionState, Permissions};
        // The permissions as `permissionsOf` writes them, with each state that Android's dialog leaves.
        for (word, state) in [
            ("granted", PermissionState::Granted),
            ("prompt", PermissionState::Prompt),
            ("settingsRequired", PermissionState::SettingsRequired),
            ("unknown", PermissionState::Unknown),
        ] {
            let permissions: Permissions = decode(json!({"ok":true,"data":{
                "notifications":word,"liveActivities":"notApplicable",
                "promotion":"settingsRequired","frequentPushes":"notApplicable"}}))
            .unwrap();
            assert_eq!(permissions.notifications, state);
            assert_eq!(permissions.live_activities, PermissionState::NotApplicable);
            assert_eq!(permissions.promotion, PermissionState::SettingsRequired);
            assert_eq!(permissions.frequent_pushes, PermissionState::NotApplicable);
        }
        // liveupdate's own reply travels as text, which liveupdate's driver reads.
        let reply: String =
            decode(json!({"ok":true,"data":"{\"status\":\"ok\",\"data\":null}"})).unwrap();
        assert_eq!(reply, r#"{"status":"ok","data":null}"#);
    }
}
