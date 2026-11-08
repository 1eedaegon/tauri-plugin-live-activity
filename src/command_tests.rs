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

#[test]
fn capabilities_from_a_native_side_without_layout_decode_as_unsupported() {
    let mut native = json!({"platform":"android","backend":"androidNotification","start":"supported",
        "update":"supported","end":"supported","progress":"supported","timer":"supported",
        "actions":"unsupported","stateObservation":"supported","silentUpdate":"supported",
        "nativeLiveActivity":"unsupported","maxPayloadBytes":4096});
    let decode = |data: &Value| {
        crate::bridge::decode::<crate::Capabilities>(json!({"ok":true,"data":data})).unwrap()
    };
    assert_eq!(decode(&native).layout, FeatureSupport::Unsupported);
    for (word, support) in [
        ("supported", FeatureSupport::Supported),
        ("unsupported", FeatureSupport::Unsupported),
        ("unknown", FeatureSupport::Unknown),
    ] {
        native["layout"] = json!(word);
        assert_eq!(decode(&native).layout, support);
        assert_eq!(
            serde_json::to_value(decode(&native)).unwrap()["layout"],
            word
        );
    }
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
    use crate::actions::{ACTION_EVENT, start};
    use std::sync::{Arc, Mutex};
    use tauri::{
        Emitter, Listener,
        ipc::{Channel, InvokeResponseBody},
    };
    let app = mock_builder()
        .plugin(crate::init())
        .build(mock_context(noop_assets()))
        .unwrap();
    let (sender, heard) = std::sync::mpsc::channel();
    app.listen(ACTION_EVENT, move |event| {
        let _ = sender.send(event.payload().to_owned());
    });
    let source = Arc::new(Mutex::new(None::<Channel>));
    let registered = source.clone();
    let handle = app.handle().clone();
    let register = move |channel| {
        *registered.lock().unwrap() = Some(channel);
        true
    };
    let _actions = start(register, move |event| {
        handle.emit(ACTION_EVENT, event).unwrap()
    });
    let tap = json!({"actionId":"stop","activityId":"la-1","activityKey":"job:1"});
    let channel = source.lock().unwrap().take().unwrap();
    channel
        .send(InvokeResponseBody::Json(tap.to_string()))
        .unwrap();
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
    let png = crate::image::tests::png(8, 8, 1);
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
    let wide = crate::image::tests::png(1225, 8, 1);
    assert_eq!(
        app.live_activity()
            .write_image("wide.png", &wide)
            .unwrap_err()
            .code,
        "PAYLOAD_TOO_LARGE"
    );
}
