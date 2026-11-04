use serde_json::{Value, json};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{MockRuntime, mock_builder, mock_context, noop_assets},
    utils::acl::ExecutionContext,
    webview::InvokeRequest,
};

pub(super) fn local_ipc_url() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

fn webview_with_grants(commands: &[&str]) -> tauri::WebviewWindow<MockRuntime> {
    let mut context = mock_context(noop_assets());
    for command in commands {
        context.runtime_authority_mut().__allow_command(
            format!("plugin:live-activity|{command}"),
            ExecutionContext::Local,
        );
    }
    let app = mock_builder().plugin(crate::init()).build(context).unwrap();
    tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap()
}

fn invoke(
    webview: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: format!("plugin:live-activity|{command}"),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: local_ipc_url().parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|response| response.deserialize().unwrap())
}

#[test]
fn desktop_ipc_never_advertises_native_features_or_requests_os_permissions() {
    let webview = webview_with_grants(&["get_capabilities", "check_permissions"]);
    let capabilities = invoke(&webview, "get_capabilities", json!({})).unwrap();
    assert_eq!(capabilities["platform"], std::env::consts::OS);
    for feature in [
        "backend",
        "start",
        "update",
        "end",
        "progress",
        "timer",
        "actions",
        "stateObservation",
        "silentUpdate",
        "nativeLiveActivity",
    ] {
        assert_eq!(capabilities[feature], "unsupported", "{feature}");
    }
    assert_eq!(capabilities["maxPayloadBytes"], 0);
    assert_eq!(
        invoke(&webview, "check_permissions", json!({})).unwrap(),
        json!({
            "notifications": "notApplicable",
            "liveActivities": "notApplicable",
            "promotion": "notApplicable"
        })
    );
}

#[test]
fn granted_desktop_ipc_returns_structured_unsupported_errors() {
    let webview = webview_with_grants(&["start", "update", "end", "list", "request_permissions"]);
    let snapshot = json!({"revision": 0, "title": "Mochi", "status": "Napping",
        "timer": {"startedAt": 1_800_000_000_000_u64, "endsAt": 1_800_000_060_000_u64}});
    let requests = [
        (
            "start",
            json!({"input": {"activityKey": "mochi:nap", "schemaVersion": 1,
            "template": "timer", "fallback": "notification", "snapshot": snapshot}}),
        ),
        (
            "update",
            json!({"input": {"id": "missing", "snapshot": snapshot}}),
        ),
        (
            "end",
            json!({"input": {"id": "missing", "policy": {"kind": "immediate"}}}),
        ),
        ("list", json!({})),
        ("request_permissions", json!({"kind": "notifications"})),
        ("request_permissions", json!({"kind": "liveActivities"})),
        ("request_permissions", json!({"kind": "promotion"})),
    ];
    for (command, body) in requests {
        let error = invoke(&webview, command, body).unwrap_err();
        assert_eq!(error["code"], "UNSUPPORTED_PLATFORM", "{command}");
        assert!(
            error["message"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
    }
}
