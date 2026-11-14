use serde_json::{Value, json};
use std::collections::BTreeSet;
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

// TP-DESKTOP-1
#[test]
fn desktop_ipc_never_advertises_native_features_or_requests_os_permissions() {
    let webview = webview_with_grants(&["get_capabilities", "check_permissions", "push_tokens"]);
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
        "layout",
        "push",
    ] {
        assert_eq!(capabilities[feature], "unsupported", "{feature}");
    }
    assert_eq!(capabilities["maxPayloadBytes"], 0);
    assert_eq!(
        invoke(&webview, "check_permissions", json!({})).unwrap(),
        json!({
            "notifications": "notApplicable",
            "liveActivities": "notApplicable",
            "promotion": "notApplicable",
            "frequentPushes": "notApplicable"
        })
    );
    // TP-PUSH-8: no token is held where there are no pushes, an answer and not a failure.
    assert_eq!(
        invoke(&webview, "push_tokens", json!({})).unwrap(),
        json!({"activities": []})
    );
}

// TP-DESKTOP-1
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

// TP-DESKTOP-1
#[test]
fn desktop_ipc_reports_layout_as_unsupported_and_answers_layout_commands_with_structured_errors() {
    let webview = webview_with_grants(&[
        "get_capabilities",
        "start_layout",
        "update_layout",
        "end_layout",
        "list_layout",
    ]);
    let capabilities = invoke(&webview, "get_capabilities", json!({})).unwrap();
    assert_eq!(capabilities["layout"], "unsupported");
    assert_eq!(capabilities["actions"], "unsupported");

    let snapshot = json!({"revision": 0, "values": {"title": "Mochi", "left": 0.5}});
    let start = json!({"activityKey": "mochi:nap", "schemaVersion": 2, "fallback": "none",
        "layout": {"lockScreen": {"type": "vstack", "children": [
            {"type": "text", "bind": "title", "style": "title"},
            {"type": "progress", "bind": "left"},
            {"type": "button", "actionId": "wake", "child": {"type": "text", "value": "Wake"}}]}},
        "styles": {"title": {"font": "headline"}}, "snapshot": snapshot});
    let requests = [
        ("start_layout", json!({"input": start})),
        (
            "update_layout",
            json!({"input": {"id": "missing", "snapshot": snapshot}}),
        ),
        (
            "end_layout",
            json!({"input": {"id": "missing", "policy": {"kind": "default"}}}),
        ),
        ("list_layout", json!({})),
    ];
    for (command, body) in requests {
        let error = invoke(&webview, command, body).unwrap_err();
        assert_eq!(error["code"], "UNSUPPORTED_PLATFORM", "{command}");
    }
    let invalid = json!({"code": "INVALID_INPUT",
        "message": "Request does not match the live activity contract"});
    for command in ["start_layout", "update_layout", "end_layout"] {
        assert_eq!(
            invoke(&webview, command, json!({"input": {}})).unwrap_err(),
            invalid
        );
        let secret =
            json!({"input": {"id": "private-input", "snapshot": {"revision": "private-input"}}});
        assert_eq!(
            invoke(&webview, command, secret).unwrap_err(),
            invalid,
            "{command}"
        );
    }
    let mut heavy = start.clone();
    for key in ["a", "b", "c", "d"] {
        heavy["snapshot"]["values"][key] = json!("x".repeat(1000));
    }
    let error = invoke(&webview, "start_layout", json!({"input": heavy})).unwrap_err();
    assert_eq!(error["code"], "PAYLOAD_TOO_LARGE");
    assert!(!error["message"].as_str().unwrap().contains("xxx"));
    // A command without its `input` argument never reaches the plugin.
    assert!(
        invoke(&webview, "start_layout", json!({}))
            .unwrap_err()
            .is_string()
    );
}

// TP-PERM-1
#[test]
fn layout_commands_need_their_own_grants() {
    let webview = webview_with_grants(&["start", "update", "end", "list"]);
    for command in ["start_layout", "update_layout", "end_layout", "list_layout"] {
        let denied = invoke(&webview, command, json!({"input": {}})).unwrap_err();
        assert!(
            denied.as_str().unwrap().contains("not allowed"),
            "{command}"
        );
    }
}

// TP-PERM-1, TP-PUSH-8
#[test]
fn default_permission_grants_only_the_read_commands() {
    let identifiers = |file: &'static str| -> Vec<&'static str> {
        let quoted = file.split('"').skip(1).step_by(2);
        quoted
            .filter(|word| word.starts_with("allow-") || word.starts_with("deny-"))
            .collect()
    };
    assert_eq!(
        identifiers(include_str!("../permissions/default.toml")),
        [
            "allow-get-capabilities",
            "allow-check-permissions",
            "allow-list",
            "allow-list-layout",
            "allow-push-tokens",
            "allow-openings"
        ]
    );
    for (file, slug) in [
        (
            include_str!("../permissions/autogenerated/commands/start_layout.toml"),
            "start-layout",
        ),
        (
            include_str!("../permissions/autogenerated/commands/update_layout.toml"),
            "update-layout",
        ),
        (
            include_str!("../permissions/autogenerated/commands/end_layout.toml"),
            "end-layout",
        ),
        (
            include_str!("../permissions/autogenerated/commands/list_layout.toml"),
            "list-layout",
        ),
        (
            include_str!("../permissions/autogenerated/commands/push_tokens.toml"),
            "push-tokens",
        ),
        (
            include_str!("../permissions/autogenerated/commands/openings.toml"),
            "openings",
        ),
    ] {
        assert_eq!(
            identifiers(file),
            [format!("allow-{slug}"), format!("deny-{slug}")]
        );
    }
}

/// The commands that a permission of the plugin allows. The build lists every permission in the schema: the default
/// set, and for each command of build.rs the generated `allow-` and `deny-`, which name that command alone. Any
/// other is written by hand and may allow any command: one of another name, or a second definition of a generated
/// one, which is the one that counts.
fn commands_with_a_permission() -> BTreeSet<String> {
    let schema: Value = serde_json::from_str(include_str!("../permissions/schemas/schema.json"))
        .expect("the schema of the permissions is JSON");
    let identifiers: Vec<&str> = schema["definitions"]["PermissionKind"]["oneOf"]
        .as_array()
        .expect("the schema lists the permissions under definitions.PermissionKind.oneOf")
        .iter()
        .map(|kind| kind["const"].as_str().expect("a permission has its name"))
        .collect();
    let unique: BTreeSet<&str> = identifiers.iter().copied().collect();
    assert_eq!(
        unique.len(),
        identifiers.len(),
        "a permission is defined twice, and the later definition counts: {identifiers:?}"
    );
    let commands: BTreeSet<String> = unique
        .iter()
        .filter(|identifier| **identifier != "default")
        .map(|identifier| {
            let slug = identifier
                .strip_prefix("allow-")
                .or_else(|| identifier.strip_prefix("deny-"));
            let Some(slug) = slug else {
                panic!("{identifier} is no permission of a command: say here what it allows");
            };
            slug.replace('-', "_")
        })
        .collect();
    let listed: BTreeSet<String> = include_str!("../build.rs")
        .split_once("const COMMANDS: &[&str] = &[")
        .and_then(|(_, rest)| rest.split_once("];"))
        .expect("build.rs lists the commands in COMMANDS")
        .0
        .split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect();
    assert_eq!(
        commands, listed,
        "a permission that the build did not make for a command of build.rs"
    );
    commands
}

// TP-PERM-1
#[test]
fn every_permission_names_a_command_that_rust_answers() {
    let commands = commands_with_a_permission();
    let granted: Vec<&str> = commands.iter().map(String::as_str).collect();
    assert!(
        granted.contains(&"start"),
        "no command has a permission, so nothing is checked: {granted:?}"
    );

    // Tauri answers a granted command that the plugin's Rust does not answer with "not found" on a desktop. On
    // Android it hands such a command to the Kotlin side, as the command of that name in camel case. The Kotlin
    // side has commands that only Rust is to call, the channel to liveupdate's adapter among them: a permission
    // for one of those would let a page call it around Rust.
    let webview = webview_with_grants(&granted);
    for command in &granted {
        assert_ne!(
            invoke(&webview, command, json!({})),
            Err(json!(format!("Command {command} not found"))),
            "{command} has a permission, and Rust does not answer it"
        );
    }
    let lacking = "a_command_that_rust_lacks";
    assert_eq!(
        invoke(&webview_with_grants(&[lacking]), lacking, json!({})),
        Err(json!(format!("Command {lacking} not found"))),
        "Tauri says something else of a granted command that the plugin lacks: the check above proves nothing"
    );
}
