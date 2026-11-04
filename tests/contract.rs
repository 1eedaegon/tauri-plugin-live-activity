use serde_json::{Value, json};
use tauri_plugin_live_activity::validate_request;

fn progress() -> Value {
    json!({"activityKey":"job:1","schemaVersion":1,"template":"progress",
        "fallback":"notification","snapshot":{"revision":0,"title":"Job","status":"Running","progress":0.3}})
}

#[test]
fn shared_contract_fixtures_match_reference_validator() {
    let fixtures: Value = serde_json::from_str(include_str!("fixtures/requests.json")).unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let request = &fixture["request"];
        let result = validate_request(
            request["command"].as_str().unwrap(),
            request["input"].clone(),
        );
        assert_eq!(
            result.is_ok(),
            fixture["valid"].as_bool().unwrap(),
            "{}",
            fixture["name"]
        );
    }
}

#[test]
fn rejects_boundary_and_type_errors_without_echoing_values() {
    let invalid = [
        ("/activityKey", json!("../secret")),
        ("/activityKey", json!("key\n")),
        ("/activityKey", json!("a".repeat(129))),
        ("/schemaVersion", json!(2)),
        ("/fallback", json!(null)),
        ("/template", json!("timer")),
        ("/snapshot/title", json!(" \n\t")),
        ("/snapshot/title", json!("😀".repeat(121))),
        ("/snapshot/status", json!("x".repeat(241))),
        ("/snapshot/progress", json!(-0.1)),
        ("/snapshot/progress", json!(1.1)),
        ("/snapshot/progress", json!(null)),
        ("/snapshot/progress", json!("private-input")),
        ("/snapshot/revision", json!(-1)),
        ("/snapshot/revision", json!(0.5)),
        ("/snapshot/revision", json!(9007199254740992u64)),
    ];
    for (pointer, value) in invalid {
        let mut input = progress();
        *input.pointer_mut(pointer).unwrap() = value;
        let error = validate_request("start", input).expect_err(pointer);
        assert!(!format!("{error:?}").contains("private-input"));
    }
}

#[test]
fn rejects_unknown_fields_nulls_and_mixed_presentations() {
    for (key, value) in [("unsafePath", json!("/tmp")), ("snapshot", json!(null))] {
        let mut input = progress();
        input[key] = value;
        assert!(validate_request("start", input).is_err());
    }
    for (key, value) in [
        ("timer", json!({"startedAt":0,"endsAt":1})),
        ("staleAt", json!(null)),
        ("token", json!("secret")),
    ] {
        let mut input = progress();
        input["snapshot"][key] = value;
        assert!(validate_request("start", input).is_err());
    }
    assert!(
        validate_request(
            "end",
            json!({"id":"id","policy":{"kind":"immediate","at":0}})
        )
        .is_err()
    );
    assert!(validate_request("start", json!([])).is_err());
}

#[test]
fn accepts_unicode_and_numeric_boundaries() {
    let mut input = progress();
    input["activityKey"] = json!("a".repeat(128));
    input["snapshot"]["title"] = json!("😀".repeat(120));
    input["snapshot"]["status"] = json!("한".repeat(240));
    input["snapshot"]["revision"] = json!(9007199254740991u64);
    input["snapshot"]["staleAt"] = json!(8640000000000000u64);
    assert!(validate_request("start", input).is_ok());
}

#[test]
fn validates_timer_order_and_end_policy() {
    for (start, end, valid) in [
        (0, 1, true),
        (1, 1, false),
        (2, 1, false),
        (0, 8640000000000001u64, false),
    ] {
        let input = json!({"id":"timer","snapshot":{"revision":0,"title":"Timer","status":"Running","timer":{"startedAt":start,"endsAt":end}}});
        assert_eq!(validate_request("update", input).is_ok(), valid);
    }
    for input in [
        json!({"id":" ","policy":{"kind":"default"}}),
        json!({"id":"x".repeat(257),"policy":{"kind":"default"}}),
        json!({"id":"x","policy":{"kind":"after"}}),
        json!({"id":"x","policy":{"kind":"after","at":-1}}),
    ] {
        assert!(validate_request("end", input).is_err());
    }
}
