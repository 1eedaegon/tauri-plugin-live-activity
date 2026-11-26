//! TP-RUST-7: the plugin on a backend of the app's own, or with layers over the platform's backend.

use super::desktop_ipc_tests::{invoke, webview_of};
use crate::layers::Layered;
use crate::{BackendLayer, Builder, Event, LiveActivityExt};
use liveactivity::testkit::{MemoryBackend, conformance};
use liveactivity::{
    ActivityRecord, BackendContext, BackendFuture, Capabilities, EndInput, Error,
    LayoutActivityRecord, LayoutEndInput, LayoutStartInput, LayoutUpdateInput, LiveActivityBackend,
    PermissionKind, Permissions, PushTokens, Result, StartInput, UpdateInput, block_on,
};
use serde_json::{Value, json};
use std::fmt::Debug;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use tauri::test::{mock_builder, mock_context, noop_assets};

fn start() -> Value {
    json!({"activityKey":"job:1","schemaVersion":1,"template":"progress","fallback":"notification",
        "snapshot":{"revision":0,"title":"Job","status":"Running","progress":0.5}})
}

/// A request of the contract from its JSON.
fn input<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).unwrap()
}

fn start_layout() -> Value {
    json!({"activityKey":"job:2","schemaVersion":2,"fallback":"notification",
        "layout":{"lockScreen":{"type":"text","bind":"title"}},
        "snapshot":{"revision":0,"values":{"title":"Job"}}})
}

/// A layer that changes nothing: every call goes to the backend under it.
struct Nothing;

impl BackendLayer for Nothing {}

/// A backend that only notes which of its methods were called, with what, and refuses each.
#[derive(Default)]
struct Recorder {
    calls: Mutex<Vec<(&'static str, String)>>,
}

impl Recorder {
    fn note<'a, T: 'a>(&self, call: &'static str, with: impl Debug) -> BackendFuture<'a, T> {
        self.calls.lock().unwrap().push((call, format!("{with:?}")));
        Box::pin(async { Err(Error::unsupported_feature("only noted")) })
    }
}

impl LiveActivityBackend for Recorder {
    fn attach(&self, _events: BackendContext) -> Result<()> {
        self.calls.lock().unwrap().push(("attach", String::new()));
        Ok(())
    }
    fn capabilities(&self) -> BackendFuture<'_, Capabilities> {
        self.note("capabilities", ())
    }
    fn permissions(&self) -> BackendFuture<'_, Permissions> {
        self.note("permissions", ())
    }
    fn start(&self, input: StartInput) -> BackendFuture<'_, ActivityRecord> {
        self.note("start", input)
    }
    fn update(&self, input: UpdateInput) -> BackendFuture<'_, ActivityRecord> {
        self.note("update", input)
    }
    fn end(&self, input: EndInput) -> BackendFuture<'_, ActivityRecord> {
        self.note("end", input)
    }
    fn list(&self) -> BackendFuture<'_, Vec<ActivityRecord>> {
        self.note("list", ())
    }
    fn request_permissions(&self, kind: PermissionKind) -> BackendFuture<'_, Permissions> {
        self.note("request_permissions", kind)
    }
    fn start_layout(&self, input: LayoutStartInput) -> BackendFuture<'_, LayoutActivityRecord> {
        self.note("start_layout", input)
    }
    fn update_layout(&self, input: LayoutUpdateInput) -> BackendFuture<'_, LayoutActivityRecord> {
        self.note("update_layout", input)
    }
    fn end_layout(&self, input: LayoutEndInput) -> BackendFuture<'_, LayoutActivityRecord> {
        self.note("end_layout", input)
    }
    fn list_layout(&self) -> BackendFuture<'_, Vec<LayoutActivityRecord>> {
        self.note("list_layout", ())
    }
    fn write_image(&self, name: String, png: Vec<u8>) -> BackendFuture<'_, ()> {
        self.note("write_image", (name, png))
    }
    fn push_tokens(&self) -> BackendFuture<'_, PushTokens> {
        self.note("push_tokens", ())
    }
    fn sync_events(&self) -> BackendFuture<'_, ()> {
        self.note("sync_events", ())
    }
    fn open_promotion_settings(&self) -> BackendFuture<'_, ()> {
        self.note("open_promotion_settings", ())
    }
}

/// Makes every call of the backend interface on `layered` once, each with a request of its own.
fn every_call(layered: &dyn LiveActivityBackend) {
    let _ = block_on(layered.capabilities());
    let _ = block_on(layered.permissions());
    let _ = block_on(layered.start(input(start())));
    let _ = block_on(layered.update(input(
        json!({"id":"update-1","snapshot":{"revision":1,"title":"Job","status":"Done","progress":1.0}}),
    )));
    let _ = block_on(layered.end(input(json!({"id":"end-1","policy":{"kind":"immediate"}}))));
    let _ = block_on(layered.list());
    let _ = block_on(layered.request_permissions(input(json!("notifications"))));
    let _ = block_on(layered.start_layout(input(start_layout())));
    let _ = block_on(layered.update_layout(input(
        json!({"id":"update-2","snapshot":{"revision":1,"values":{"title":"Done"}}}),
    )));
    let _ =
        block_on(layered.end_layout(input(json!({"id":"end-2","policy":{"kind":"immediate"}}))));
    let _ = block_on(layered.list_layout());
    let _ = block_on(layered.write_image("paw.png".into(), vec![7]));
    let _ = block_on(layered.push_tokens());
    let _ = block_on(layered.sync_events());
    let _ = block_on(layered.open_promotion_settings());
}

/// A layer over a recorder, as a backend, with what the messages of a test call it.
type Over = (
    &'static str,
    Box<dyn Fn(Arc<Recorder>) -> Arc<dyn LiveActivityBackend>>,
);

// TP-RUST-7, TP-ANDROID-25
#[test]
fn a_layer_that_overrides_nothing_passes_every_call_to_the_backend_under_it() {
    // The layer itself, and the layer behind an `Arc`, whose methods forward to it.
    let layers: [Over; 2] = [
        (
            "the layer",
            Box::new(|recorder| Arc::new(Layered::new(Nothing, recorder))),
        ),
        (
            "its Arc",
            Box::new(|recorder| Arc::new(Layered::new(Arc::new(Nothing), recorder))),
        ),
    ];
    for (layer, layered) in layers {
        let recorder = Arc::new(Recorder::default());
        // The builder of the service attaches the backend it is given, before any command.
        let _live = liveactivity::LiveActivity::builder()
            .backend(layered(recorder.clone()))
            .build()
            .unwrap();
        every_call(layered(recorder.clone()).as_ref());
        let calls = recorder.calls.lock().unwrap();
        let names: Vec<&str> = calls.iter().map(|(call, _)| *call).collect();
        assert_eq!(
            names,
            [
                "attach",
                "capabilities",
                "permissions",
                "start",
                "update",
                "end",
                "list",
                "request_permissions",
                "start_layout",
                "update_layout",
                "end_layout",
                "list_layout",
                "write_image",
                "push_tokens",
                "sync_events",
                "open_promotion_settings",
            ],
            "{layer}"
        );
        // Each call came with what it was given.
        for (call, given) in [
            ("start", "job:1"),
            ("update", "update-1"),
            ("end", "end-1"),
            ("request_permissions", "Notifications"),
            ("start_layout", "job:2"),
            ("update_layout", "update-2"),
            ("end_layout", "end-2"),
            ("write_image", "(\"paw.png\", [7])"),
        ] {
            let (_, with) = calls.iter().find(|(name, _)| *name == call).unwrap();
            assert!(with.contains(given), "{layer}, {call}: {with}");
        }
    }
}

// TP-RUST-7
#[test]
fn a_backend_under_a_layer_that_overrides_nothing_keeps_the_contract() {
    let live = liveactivity::LiveActivity::builder()
        .backend(Layered::new(Nothing, Arc::new(MemoryBackend::new())))
        .build()
        .unwrap();
    block_on(conformance(&live)).assert_passed();
}

// TP-RUST-7
#[test]
fn a_backend_of_the_app_takes_the_commands_in_place_of_the_platform_one() {
    let webview = webview_of(
        Builder::new().backend(MemoryBackend::new()).build(),
        &["start", "list"],
    );
    let record = invoke(&webview, "start", json!({ "input": start() })).unwrap();
    assert_eq!(record["activityKey"], "job:1");
    let listed = invoke(&webview, "list", json!({})).unwrap();
    assert_eq!(listed[0]["id"], record["id"]);
    // A method that `LiveActivityBackend` defaults to an error reaches the app's backend as well: the answer is the
    // recorder's own, not the default's.
    let recorder = Arc::new(Recorder::default());
    let webview = webview_of(
        Builder::new().backend(recorder.clone()).build(),
        &["start_layout"],
    );
    let refused = invoke(&webview, "start_layout", json!({ "input": start_layout() })).unwrap_err();
    assert_eq!(refused["message"], "only noted");
    assert!(
        recorder
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|(call, _)| *call == "start_layout")
    );
}

// TP-RUST-7
#[test]
fn the_platforms_backend_is_built_only_when_no_backend_of_the_app_takes_its_place() {
    let built = AtomicUsize::new(0);
    let platform = || {
        built.fetch_add(1, Ordering::SeqCst);
        Ok(MemoryBackend::new())
    };
    Builder::new()
        .backend(MemoryBackend::new())
        .chosen()
        .over(platform)
        .unwrap();
    assert_eq!(built.load(Ordering::SeqCst), 0);
    Builder::new()
        .layer(Nothing)
        .chosen()
        .over(platform)
        .unwrap();
    assert_eq!(built.load(Ordering::SeqCst), 1);
    // A platform's backend that cannot be built, such as a kit that runs with other settings, fails the setup.
    let refused = Builder::new()
        .chosen()
        .over(|| Err::<MemoryBackend, _>(Error::native()));
    assert!(refused.is_err());
}

/// Counts the starts it passes on; every other call it leaves to the default.
#[derive(Default)]
struct Starts(AtomicUsize);

impl BackendLayer for Starts {
    fn start<'a>(
        &'a self,
        input: StartInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ActivityRecord> {
        self.0.fetch_add(1, Ordering::SeqCst);
        next.start(input)
    }
}

// TP-RUST-7
#[test]
fn a_layer_sees_only_the_calls_it_overrides_and_the_others_reach_the_backend() {
    // The app keeps a handle to the layer, through which it reads the count.
    let starts = Arc::new(Starts::default());
    let plugin = Builder::new()
        .backend(MemoryBackend::new())
        .layer(starts.clone())
        .build();
    let webview = webview_of(plugin, &["start", "update", "list"]);
    let record = invoke(&webview, "start", json!({ "input": start() })).unwrap();
    let update = json!({"input": {"id": record["id"], "snapshot":
        {"revision":1,"title":"Job","status":"Done","progress":1.0}}});
    let updated = invoke(&webview, "update", update).unwrap();
    assert_eq!(updated["snapshot"]["status"], "Done");
    assert_eq!(
        invoke(&webview, "list", json!({}))
            .unwrap()
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    assert_eq!(starts.0.load(Ordering::SeqCst), 1);
}

/// Notes its name on each list before it passes the call on.
struct Named(&'static str, Arc<Mutex<Vec<&'static str>>>);

impl BackendLayer for Named {
    fn list<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Vec<ActivityRecord>> {
        self.1.lock().unwrap().push(self.0);
        next.list()
    }
}

// TP-RUST-7
#[test]
fn a_later_layer_gets_the_calls_first_whatever_the_place_of_the_backend() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let plugin = Builder::default()
        .layer(Named("inner", order.clone()))
        .backend(MemoryBackend::new())
        .layer(Named("outer", order.clone()))
        .build();
    let webview = webview_of(plugin, &["list"]);
    invoke(&webview, "list", json!({})).unwrap();
    assert_eq!(*order.lock().unwrap(), ["outer", "inner"]);
}

// TP-RUST-7
#[test]
fn a_tap_on_the_backend_under_a_layer_reaches_the_apps_action_handlers() {
    let memory = Arc::new(MemoryBackend::new());
    let plugin = Builder::new()
        .backend(memory.clone())
        .layer(Nothing)
        .build();
    let app = mock_builder()
        .plugin(plugin)
        .build(mock_context(noop_assets()))
        .unwrap();
    let api = app.handle().live_activity();
    let (sent, taps) = mpsc::channel();
    api.on_action(move |event| {
        let _ = sent.send(event.action_id);
    });
    let record = api.start(serde_json::from_value(start()).unwrap()).unwrap();
    memory.tap(&record.id, "done").unwrap();
    assert_eq!(taps.recv_timeout(Duration::from_secs(5)).unwrap(), "done");
}

/// Counts the taps that the backend under it sends, and hands every event on.
#[derive(Default)]
struct Taps(Arc<AtomicUsize>);

impl BackendLayer for Taps {
    fn attach(&self, events: BackendContext, next: &dyn LiveActivityBackend) -> Result<()> {
        let taps = self.0.clone();
        next.attach(BackendContext::new(move |event: Event| {
            if matches!(event, Event::Action(_)) {
                taps.fetch_add(1, Ordering::SeqCst);
            }
            events.emit(event);
        }))
    }
}

// TP-RUST-7
#[test]
fn a_layer_that_watches_the_events_sees_each_tap_and_hands_it_on_to_the_app() {
    let memory = Arc::new(MemoryBackend::new());
    let watching = Taps::default();
    let counted = watching.0.clone();
    // The outer layer's `attach` passes the context on to the watching one, which wraps it for the backend.
    let plugin = Builder::new()
        .backend(memory.clone())
        .layer(watching)
        .layer(Nothing)
        .build();
    let app = mock_builder()
        .plugin(plugin)
        .build(mock_context(noop_assets()))
        .unwrap();
    let api = app.handle().live_activity();
    let (sent, taps) = mpsc::channel();
    api.on_action(move |event| {
        let _ = sent.send(event.action_id);
    });
    let record = api.start(serde_json::from_value(start()).unwrap()).unwrap();
    memory.tap(&record.id, "done").unwrap();
    assert_eq!(taps.recv_timeout(Duration::from_secs(5)).unwrap(), "done");
    assert_eq!(counted.load(Ordering::SeqCst), 1);
}
