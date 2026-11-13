use crate::{Backend, FeatureSupport, PermissionState, commands};
use serde_json::{Value, json};
use tauri::test::{mock_builder, mock_context, noop_assets};

fn start_input() -> Value {
    json!({"activityKey":"job:1","schemaVersion":1,"template":"progress","fallback":"notification",
        "snapshot":{"revision":0,"title":"Job","status":"Running","progress":0.5}})
}

// TP-DESKTOP-1
#[test]
fn desktop_queries_report_unavailable_and_mutations_fail_explicitly() {
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    tauri::async_runtime::block_on(async {
        let capabilities = commands::get_capabilities(handle.clone()).await.unwrap();
        assert_eq!(capabilities.backend, Backend::Unsupported);
        assert_eq!(capabilities.start, FeatureSupport::Unsupported);
        assert_eq!(
            capabilities.native_live_activity,
            FeatureSupport::Unsupported
        );
        assert_eq!(capabilities.max_payload_bytes, 0);
        let permissions = commands::check_permissions(handle.clone()).await.unwrap();
        assert_eq!(permissions.notifications, PermissionState::NotApplicable);
        for result in [
            commands::start(handle.clone(), start_input()).await,
            commands::update(
                handle.clone(),
                json!({"id":"id","snapshot":start_input()["snapshot"]}),
            )
            .await,
            commands::end(
                handle.clone(),
                json!({"id":"id","policy":{"kind":"immediate"}}),
            )
            .await,
        ] {
            assert_eq!(result.unwrap_err().code, "UNSUPPORTED_PLATFORM");
        }
        assert_eq!(
            commands::list(handle.clone()).await.unwrap_err().code,
            "UNSUPPORTED_PLATFORM"
        );
        assert_eq!(
            commands::request_permissions(handle.clone(), json!("notifications"))
                .await
                .unwrap_err()
                .code,
            "UNSUPPORTED_PLATFORM"
        );
    });
}

// TP-DESKTOP-1, TP-IOS-11
#[test]
fn command_boundaries_reject_invalid_requests_before_dispatch() {
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    tauri::async_runtime::block_on(async {
        for result in [
            commands::start(handle.clone(), json!({})).await,
            commands::update(handle.clone(), json!({})).await,
            commands::end(handle.clone(), json!({})).await,
        ] {
            assert_eq!(result.unwrap_err().code, "INVALID_INPUT");
        }
        assert_eq!(
            commands::request_permissions(handle, json!("unknown"))
                .await
                .unwrap_err()
                .code,
            "INVALID_INPUT"
        );
    });
}

// TP-PERM-1
#[test]
fn ipc_denies_ungranted_mutations_and_remote_content() {
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        utils::acl::ExecutionContext,
        webview::InvokeRequest,
    };
    let mut context = mock_context(noop_assets());
    context.runtime_authority_mut().__allow_command(
        "plugin:live-activity|get_capabilities".into(),
        ExecutionContext::Local,
    );
    let app = mock_builder().plugin(crate::init()).build(context).unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let request = |command: &str, url: &str, body: Value| InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
    };
    let read = tauri::test::get_ipc_response(
        &webview,
        request(
            "plugin:live-activity|get_capabilities",
            crate::desktop_ipc_tests::local_ipc_url(),
            json!({}),
        ),
    );
    assert_eq!(
        read.unwrap().deserialize::<Value>().unwrap()["backend"],
        "unsupported"
    );
    let denied = tauri::test::get_ipc_response(
        &webview,
        request(
            "plugin:live-activity|start",
            crate::desktop_ipc_tests::local_ipc_url(),
            json!({"input":start_input()}),
        ),
    );
    assert!(
        denied
            .unwrap_err()
            .as_str()
            .unwrap()
            .contains("not allowed")
    );
    let remote = tauri::test::get_ipc_response(
        &webview,
        request(
            "plugin:live-activity|get_capabilities",
            "https://example.com",
            json!({}),
        ),
    );
    assert!(
        remote
            .unwrap_err()
            .as_str()
            .unwrap()
            .contains("not allowed")
    );
}

fn layout_start_input() -> Value {
    json!({"activityKey":"job:1","schemaVersion":2,"fallback":"notification",
        "layout":{"lockScreen":{"type":"text","bind":"title"}},
        "snapshot":{"revision":0,"values":{"title":"Job"}}})
}

// TP-DESKTOP-1
#[test]
fn desktop_layout_commands_validate_before_they_fail_explicitly() {
    use crate::{LiveActivityExt, Validate};
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    let update = json!({"id":"id","snapshot":layout_start_input()["snapshot"]});
    let end = json!({"id":"id","policy":{"kind":"immediate"}});
    tauri::async_runtime::block_on(async {
        let capabilities = commands::get_capabilities(handle.clone()).await.unwrap();
        assert_eq!(capabilities.layout, FeatureSupport::Unsupported);
        assert_eq!(capabilities.actions, FeatureSupport::Unsupported);
        for result in [
            commands::start_layout(handle.clone(), json!({})).await,
            commands::update_layout(handle.clone(), json!({})).await,
            commands::end_layout(handle.clone(), json!({})).await,
            commands::start_layout(handle.clone(), start_input()).await,
            commands::update_layout(handle.clone(), layout_start_input()).await,
        ] {
            assert_eq!(result.unwrap_err().code, "INVALID_INPUT");
        }
        let mut heavy = layout_start_input();
        for key in ["a", "b", "c", "d"] {
            heavy["snapshot"]["values"][key] = json!("x".repeat(1000));
        }
        let error = commands::start_layout(handle.clone(), heavy).await;
        assert_eq!(error.unwrap_err().code, "PAYLOAD_TOO_LARGE");
        for result in [
            commands::start_layout(handle.clone(), layout_start_input()).await,
            commands::update_layout(handle.clone(), update.clone()).await,
            commands::end_layout(handle.clone(), end.clone()).await,
        ] {
            assert_eq!(result.unwrap_err().code, "UNSUPPORTED_PLATFORM");
        }
        let list = commands::list_layout(handle.clone()).await;
        assert_eq!(list.unwrap_err().code, "UNSUPPORTED_PLATFORM");
    });

    // The Rust API validates typed input the same way and takes action handlers everywhere.
    let api = handle.live_activity();
    api.on_action(|_| {});
    let mut start: crate::LayoutStartInput = serde_json::from_value(layout_start_input()).unwrap();
    assert_eq!(start.validate(), Ok(()));
    let unsupported = crate::Error::unsupported();
    assert_eq!(api.start_layout(start.clone()), Err(unsupported.clone()));
    let update = serde_json::from_value(update).unwrap();
    assert_eq!(api.update_layout(update), Err(unsupported.clone()));
    assert_eq!(
        api.end_layout(serde_json::from_value(end).unwrap()),
        Err(unsupported.clone())
    );
    assert_eq!(api.list_layout(), Err(unsupported));
    start.schema_version = 1;
    assert_eq!(api.start_layout(start), Err(crate::Error::invalid()));
    let blank = json!({"id":" ","snapshot":{"revision":0,"values":{}}});
    let blank = api.update_layout(serde_json::from_value(blank).unwrap());
    assert_eq!(blank, Err(crate::Error::invalid()));
    let late = json!({"id":"id","policy":{"kind":"after","at":8640000000000001_u64}});
    let late = api.end_layout(serde_json::from_value(late).unwrap());
    assert_eq!(late, Err(crate::Error::invalid()));
}

// TP-CONFIG-1
#[test]
fn plugin_accepts_an_absent_null_or_redacted_configuration() {
    let build = |config: Option<Value>| {
        let mut context = mock_context(noop_assets());
        if let Some(config) = config {
            let plugins = &mut context.config_mut().plugins.0;
            plugins.insert("live-activity".into(), config);
        }
        mock_builder().plugin(crate::init()).build(context)
    };
    for config in [
        None,
        Some(json!(null)),
        Some(json!({})),
        Some(json!({"receipts":"redacted"})),
        Some(json!({"receipts":"full"})),
    ] {
        assert!(build(config.clone()).is_ok(), "{config:?}");
    }
    for config in [
        json!({"receipts":"hashed"}),
        json!({"receipt":"redacted"}),
        json!({"receipts":"redacted","appGroup":"group.example"}),
        json!("redacted"),
        json!(true),
    ] {
        assert!(build(Some(config.clone())).is_err(), "{config}");
    }
    let config = |value: Value| serde_json::from_value::<Option<crate::Config>>(value).unwrap();
    assert_eq!(config(json!(null)), None);
    let redacted = config(json!({"receipts":"redacted"})).unwrap();
    assert_eq!(redacted.receipts, Some(crate::Receipts::Redacted));
    assert_eq!(
        config(json!({"receipts":"full"})).unwrap().receipts,
        Some(crate::Receipts::Full)
    );
    assert_eq!(config(json!({})).unwrap().receipts, None);
}

// TP-ACTION-1
#[test]
fn taps_reach_tauri_listeners_as_the_action_event() {
    use crate::{ACTION_EVENT, actions::spawn};
    use tauri::{Emitter, Listener};
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let (sender, heard) = std::sync::mpsc::channel();
    app.listen(ACTION_EVENT, move |event| {
        let _ = sender.send(event.payload().to_owned());
    });
    let handle = app.handle().clone();
    let actions = spawn(move |event| handle.emit(ACTION_EVENT, event).unwrap()).unwrap();
    let tap = json!({"actionId":"stop","activityId":"la-1","activityKey":"job:1"});
    actions.tap(serde_json::from_value(tap.clone()).unwrap(), ());
    let payload = heard
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(&payload).unwrap(), tap);
}

// TP-DESKTOP-1
#[test]
fn write_image_checks_the_png_then_reports_that_desktop_has_no_widget() {
    use crate::LiveActivityExt;
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    let png = sized_png(8, 8, 1);
    tauri::async_runtime::block_on(async {
        let write = |input: Value| commands::write_image(handle.clone(), input);
        assert_eq!(
            write(json!({"name":"badge.png","png":png}))
                .await
                .unwrap_err()
                .code,
            "UNSUPPORTED_PLATFORM"
        );
        for input in [
            json!({"name":"../badge.png","png":png}),
            json!({"name":"badge.png","png":"iVBORw0KGgo"}),
            json!({"name":"badge.png","png":png,"scale":3}),
            json!({"name":"badge.png","png":[1, 2, 3]}),
        ] {
            assert_eq!(write(input).await.unwrap_err().code, "INVALID_INPUT");
        }
    });
    let wide = sized_png(1225, 8, 1);
    assert_eq!(
        app.live_activity()
            .write_image("wide.png", &wide)
            .unwrap_err()
            .code,
        "PAYLOAD_TOO_LARGE"
    );
}

// TP-PUSH-1
#[test]
fn a_channel_that_is_no_base64_is_refused_before_the_native_side() {
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    tauri::async_runtime::block_on(async {
        let with = |push: Value| {
            let mut input = layout_start_input();
            input["push"] = push;
            input
        };
        for refused in [
            json!({"channel": "not base64!"}),
            json!({"channel": "dGVzdA==", "other": 1}),
            json!("channel"),
            json!(null),
        ] {
            let error = commands::start_layout(handle.clone(), with(refused)).await;
            assert_eq!(error.unwrap_err().code, "INVALID_INPUT");
        }
        // A valid push passes the check and reaches the backend, which desktop has none of.
        for valid in [json!("token"), json!({"channel": "dGVzdA=="})] {
            let error = commands::start_layout(handle.clone(), with(valid)).await;
            assert_eq!(error.unwrap_err().code, "UNSUPPORTED_PLATFORM");
        }
    });
}

// TP-PUSH-2, TP-PUSH-4
#[test]
fn push_events_reach_tauri_listeners() {
    use crate::{
        PUSH_TO_START_TOKEN_EVENT, PUSH_TOKEN_EVENT, PushToStartTokenEvent, PushTokenEvent,
        UPDATED_EVENT, UpdatedEvent,
    };
    use liveactivity::Event;
    use tauri::Listener;
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let (sender, heard) = std::sync::mpsc::channel();
    for name in [PUSH_TOKEN_EVENT, PUSH_TO_START_TOKEN_EVENT, UPDATED_EVENT] {
        let sender = sender.clone();
        app.listen(name, move |event| {
            let payload: Value = serde_json::from_str(event.payload()).unwrap();
            let _ = sender.send((name, payload));
        });
    }
    let record: crate::LayoutActivityRecord = serde_json::from_value(json!({
        "id":"la-1","activityKey":"job:1","schemaVersion":2,
        "snapshot":{"revision":3,"values":{"status":"Delivered"}},
        "backend":"activityKit","state":"active","visibility":"unknown","degradedFeatures":[],
        "promotionRequested":false,"promotionState":"notApplicable"}))
    .unwrap();
    let events = [
        Event::PushToken(PushTokenEvent {
            activity_id: "la-1".into(),
            activity_key: Some("job:1".into()),
            token: "0a1b".into(),
        }),
        Event::PushToStartToken(PushToStartTokenEvent {
            token: "ff00".into(),
        }),
        Event::Updated(UpdatedEvent {
            record: record.clone(),
        }),
    ];
    // The sink of the backend's events, as the plugin connects it.
    let actions = crate::actions::spawn(|_| {}).unwrap();
    let sink = crate::events::sink(app.handle().clone(), actions);
    for event in &events {
        sink(event.clone());
    }
    let mut received = Vec::new();
    for _ in 0..events.len() {
        received.push(
            heard
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap(),
        );
    }
    assert_eq!(
        received,
        [
            (
                PUSH_TOKEN_EVENT,
                json!({"activityId":"la-1","activityKey":"job:1","token":"0a1b"})
            ),
            (PUSH_TO_START_TOKEN_EVENT, json!({"token":"ff00"})),
            (
                UPDATED_EVENT,
                json!({"record": serde_json::to_value(&record).unwrap()})
            ),
        ]
    );
}

// TP-PUSH-5
#[test]
fn desktop_reports_no_pushes() {
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    tauri::async_runtime::block_on(async {
        let capabilities = commands::get_capabilities(handle.clone()).await.unwrap();
        assert_eq!(capabilities.push, FeatureSupport::Unsupported);
        let permissions = commands::check_permissions(handle.clone()).await.unwrap();
        assert_eq!(permissions.frequent_pushes, PermissionState::NotApplicable);
    });
}

// TP-PUSH-8
#[test]
fn push_tokens_answers_no_tokens_where_there_are_no_pushes() {
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    let tokens = tauri::async_runtime::block_on(commands::push_tokens(handle)).unwrap();
    assert_eq!(tokens, crate::PushTokens::default());
    assert_eq!(
        serde_json::to_value(&tokens).unwrap(),
        json!({"activities": []})
    );
    // What iOS writes once it has tokens.
    let held = crate::PushTokens {
        push_to_start: Some("ff00".into()),
        activities: vec![crate::PushTokenEvent {
            activity_id: "la-1".into(),
            activity_key: None,
            token: "0a1b".into(),
        }],
    };
    assert_eq!(
        serde_json::to_value(&held).unwrap(),
        json!({"pushToStart":"ff00","activities":[{"activityId":"la-1","token":"0a1b"}]})
    );
}

fn pet_tap() -> crate::ActionEvent {
    crate::ActionEvent {
        action_id: "pet".into(),
        activity_id: "la-1".into(),
        activity_key: Some("job:1".into()),
    }
}

// TP-ACTION-3, TP-PUSH-6
#[test]
fn the_sink_holds_a_tap_until_its_handlers_have_run_and_its_event_went_out() {
    use crate::ACTION_EVENT;
    use liveactivity::Event;
    use std::sync::{Arc, Mutex};
    use tauri::{Emitter, Listener};
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let log = Arc::new(Mutex::new(Vec::new()));
    let heard = log.clone();
    app.listen(ACTION_EVENT, move |_| heard.lock().unwrap().push("emitted"));
    let emitter = app.handle().clone();
    let actions =
        crate::actions::spawn(move |event| emitter.emit(ACTION_EVENT, event).unwrap()).unwrap();
    let slow = log.clone();
    actions.subscribe(move |_| {
        std::thread::sleep(std::time::Duration::from_millis(300));
        slow.lock().unwrap().push("handled");
    });
    let sink = crate::events::sink(app.handle().clone(), actions);
    sink(Event::Action(pet_tap()));
    // liveactivity lets the tap's intent go, and reports its next event, when the sink returns: the handler and the
    // event are done by then.
    assert_eq!(*log.lock().unwrap(), ["handled", "emitted"]);
}

// TP-ACTION-3
#[test]
fn the_sink_lets_a_tap_go_when_its_time_is_up_while_a_handler_still_runs() {
    use liveactivity::Event;
    use std::{
        sync::{Arc, Mutex, mpsc},
        time::{Duration, Instant},
    };
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let log = Arc::new(Mutex::new(Vec::new()));
    let (finish, finished) = mpsc::channel::<()>();
    let finished = Mutex::new(finished);
    let actions = crate::actions::spawn(|_| {}).unwrap();
    let handled = log.clone();
    actions.subscribe(move |_| {
        // A handler that hangs far longer than a tap is held, until the test lets it go.
        let _ = finished
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(30));
        handled.lock().unwrap().push("handled");
    });
    let limit = Duration::from_millis(100);
    let sink = crate::events::sink_within(app.handle().clone(), actions, limit);
    let started = Instant::now();
    sink(Event::Action(pet_tap()));
    // The system gives a tap's intent a limited time: the sink returns then, whatever the handlers do.
    assert!(started.elapsed() >= limit);
    assert!(log.lock().unwrap().is_empty());
    finish.send(()).unwrap();
}

// TP-PUSH-6
#[test]
fn a_panicking_rust_listener_ends_neither_the_thread_of_the_events_nor_the_taps() {
    use crate::{PUSH_TOKEN_EVENT, PushTokenEvent};
    use liveactivity::Event;
    use tauri::Listener;
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    // What a Rust listener of the app that panics does: Tauri runs it inline in the emit, on the thread that
    // reports the backend's events.
    app.listen(PUSH_TOKEN_EVENT, |_| panic!("raised by this test"));
    let (sender, handled) = std::sync::mpsc::channel();
    let actions = crate::actions::spawn(|_| {}).unwrap();
    actions.subscribe(move |event| {
        let _ = sender.send(event.action_id);
    });
    let sink = crate::events::sink(app.handle().clone(), actions);
    let token = || {
        Event::PushToken(PushTokenEvent {
            activity_id: "la-1".into(),
            activity_key: None,
            token: "0a1b".into(),
        })
    };
    sink(token());
    // The sink returned, so the thread that called it goes on. Tauri's registry of Rust listeners is poisoned by
    // then, and a further event passes through the sink all the same.
    sink(token());
    // The tap behind the tokens reaches the handlers.
    sink(Event::Action(pet_tap()));
    let handled = handled.recv_timeout(std::time::Duration::from_secs(10));
    assert_eq!(handled.as_deref(), Ok("pet"));
}

/// A PNG of that size: the signature, an image header, a data chunk of `filler` bytes and the end.
fn sized_png(width: u32, height: u32, filler: usize) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    bytes.extend(width.to_be_bytes());
    bytes.extend(height.to_be_bytes());
    bytes.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
    bytes.extend((filler as u32).to_be_bytes());
    bytes.extend(b"IDAT");
    bytes.extend(std::iter::repeat_n(0, filler + 4));
    bytes.extend(b"\0\0\0\0IEND\xaeB`\x82");
    bytes
}

// TP-EVENT-1
#[test]
fn starts_states_and_permissions_reach_tauri_listeners() {
    use crate::{PERMISSIONS_EVENT, STARTED_EVENT, STATE_EVENT};
    use liveactivity::Event;
    use tauri::Listener;
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let (sender, heard) = std::sync::mpsc::channel();
    for name in [STARTED_EVENT, STATE_EVENT, PERMISSIONS_EVENT] {
        let sender = sender.clone();
        app.listen(name, move |event| {
            let payload: Value = serde_json::from_str(event.payload()).unwrap();
            let _ = sender.send((name, payload));
        });
    }
    let record: crate::LayoutActivityRecord = serde_json::from_value(json!({
        "id":"la-1","activityKey":"job:1","schemaVersion":2,
        "snapshot":{"revision":0,"values":{"status":"Started"},"relevance":80.0},
        "backend":"activityKit","state":"active","visibility":"unknown","degradedFeatures":[],
        "promotionRequested":false,"promotionState":"notApplicable"}))
    .unwrap();
    let permissions: crate::Permissions = serde_json::from_value(json!({
        "notifications":"notApplicable","liveActivities":"denied","promotion":"notApplicable",
        "frequentPushes":"denied"}))
    .unwrap();
    let actions = crate::actions::spawn(|_| {}).unwrap();
    let sink = crate::events::sink(app.handle().clone(), actions);
    sink(Event::Started(crate::StartedEvent {
        record: record.clone(),
    }));
    sink(Event::State(crate::StateEvent {
        activity_id: "la-1".into(),
        activity_key: Some("job:1".into()),
        state: crate::ActivityState::Dismissed,
    }));
    sink(Event::Permissions(permissions.clone()));
    let received: Vec<_> = (0..3)
        .map(|_| {
            heard
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap()
        })
        .collect();
    assert_eq!(
        received,
        [
            (
                STARTED_EVENT,
                json!({"record": serde_json::to_value(&record).unwrap()})
            ),
            (
                STATE_EVENT,
                json!({"activityId":"la-1","activityKey":"job:1","state":"dismissed"})
            ),
            (
                PERMISSIONS_EVENT,
                serde_json::to_value(&permissions).unwrap()
            ),
        ]
    );
}
