use crate::{Backend, FeatureSupport, PermissionState, commands};
use serde_json::{Value, json};
use tauri::test::{mock_builder, mock_context, noop_assets};

fn start_input() -> Value {
    json!({"activityKey":"job:1","schemaVersion":1,"template":"progress","fallback":"notification",
        "snapshot":{"revision":0,"title":"Job","status":"Running","progress":0.5}})
}

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
