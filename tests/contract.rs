use serde_json::{Value, json};
use tauri_plugin_live_activity::{
    Error, LayoutEndInput, LayoutStartInput, LayoutUpdateInput, LiveActivityExt, Validate,
    validate_request, weight,
};

fn progress() -> Value {
    json!({"activityKey":"job:1","schemaVersion":1,"template":"progress",
        "fallback":"notification","snapshot":{"revision":0,"title":"Job","status":"Running","progress":0.3}})
}

// TP-CONTRACT-5
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

// TP-CONTRACT-5
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

// TP-CONTRACT-5
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

// TP-CONTRACT-5
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

// TP-CONTRACT-5
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

fn layout_cases(verdict: &str) -> Vec<Value> {
    let fixtures: Value =
        serde_json::from_str(include_str!("fixtures/layout-requests.json")).unwrap();
    fixtures[verdict].as_array().unwrap().clone()
}

/// Weight of a start (layout, styles, values) or an update (values) as the fixtures state it.
fn layout_weight(input: &Value) -> usize {
    let part = |pointer| input.pointer(pointer).map(weight);
    part("/snapshot/values").unwrap()
        + part("/layout").map_or(0, |layout| layout + part("/styles").unwrap_or(2))
}

// TP-CONTRACT-2, TP-CONTRACT-8, TP-RUST-3
#[test]
fn layout_fixtures_match_reference_validator() {
    let (valid, invalid) = (layout_cases("valid"), layout_cases("invalid"));
    assert!(valid.len() >= 100 && invalid.len() >= 100);
    for case in &valid {
        let (name, command) = (&case["name"], case["command"].as_str().unwrap());
        assert_eq!(
            validate_request(command, case["input"].clone()),
            Ok(()),
            "{name}"
        );
        match command {
            "end_layout" if case["input"].get("snapshot").is_none() => {
                assert!(case.get("weight").is_none(), "{name}")
            }
            _ => assert_eq!(
                case["weight"],
                json!(layout_weight(&case["input"])),
                "{name}"
            ),
        }
    }
    for case in &invalid {
        let (name, command) = (&case["name"], case["command"].as_str().unwrap());
        // liveactivity, whose contract the plugin carries, takes a relevance in a snapshot; activitykit, whose
        // fixtures these are, takes it beside the request and uses it here as its example of an unknown member.
        if name == "rejects an unknown member in the final content" {
            assert_eq!(validate_request(command, case["input"].clone()), Ok(()));
            continue;
        }
        let error =
            validate_request(command, case["input"].clone()).expect_err(name.as_str().unwrap());
        assert_eq!(case["code"], error.code.as_str(), "{name}");
        assert!(
            [Error::invalid(), Error::payload_too_large()].contains(&error),
            "{name}"
        );
    }
}

/// Each pair is a start and the update after it, which the native layer checks against the stored
/// layout and styles. A valid pair states the weight of the layout, the styles and the new values.
// TP-CONTRACT-2, TP-RUST-3
#[test]
fn layout_update_fixtures_match_the_check_against_the_start() {
    let updates = layout_cases("updates");
    assert!(updates.len() >= 20);
    for case in &updates {
        let name = case["name"].as_str().unwrap();
        assert_eq!(
            validate_request("start_layout", case["start"].clone()),
            Ok(()),
            "{name}"
        );
        let start: LayoutStartInput = serde_json::from_value(case["start"].clone()).unwrap();
        let verdict = validate_request("update_layout", case["update"].clone()).and_then(|()| {
            let update: LayoutUpdateInput = serde_json::from_value(case["update"].clone()).unwrap();
            start.validate_update(&update)
        });
        match case.get("code") {
            None => {
                assert_eq!(verdict, Ok(()), "{name}");
                let stored =
                    layout_weight(&case["start"]) - weight(&case["start"]["snapshot"]["values"]);
                let total = stored + weight(&case["update"]["snapshot"]["values"]);
                assert_eq!(case["weight"], json!(total), "{name}");
            }
            Some(code) => assert_eq!(code, verdict.expect_err(name).code.as_str(), "{name}"),
        }
    }
}

/// The Rust example of docs/usage.md: a status whose color is bound to the value `tone`.
mod changing_styles {
    use std::collections::BTreeMap;
    use tauri::{AppHandle, Runtime};
    use tauri_plugin_live_activity::{
        Bound, Element, Fallback, Layout, LayoutSnapshot, LayoutStartInput, LayoutUpdateInput,
        LiveActivityExt, Node, Result, Style, Value,
    };

    pub fn delivery(revision: u64, status: &str, tone: &str) -> LayoutSnapshot {
        let values = [("status", status), ("tone", tone)]
            .map(|(key, text)| (key.to_string(), Value::Text(text.into())));
        LayoutSnapshot::new(revision, BTreeMap::from(values))
    }

    pub fn start_input() -> LayoutStartInput {
        let text = Element::Text {
            value: None,
            bind: Some("status".into()),
        };
        let status = Node {
            style: Some("status".into()),
            ..text.into()
        };
        let style = Style {
            color: Some(Bound::key("tone").into()),
            ..Style::default()
        };
        LayoutStartInput {
            activity_key: "mochi:snack".into(),
            schema_version: 2,
            fallback: Fallback::Notification,
            layout: Layout {
                lock_screen: status,
                island: None,
                background: None,
                keyline: None,
                url: None,
            },
            styles: Some(BTreeMap::from([("status".to_string(), style)])),
            snapshot: delivery(0, "On time", "green"),
            android: None,
            ios: None,
            scheduled: None,
            push: None,
        }
    }

    pub fn run_late<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
        let record = app.live_activity().start_layout(start_input())?;
        // Later: every value again, with a higher revision. The status turns red.
        let snapshot = delivery(1, "Running late", "red");
        let update = LayoutUpdateInput::new(record.id, snapshot);
        app.live_activity().update_layout(update)?;
        Ok(())
    }
}

// TP-RUST-1, TP-DESKTOP-1
#[test]
fn the_changing_styles_example_binds_a_color_that_an_update_changes() {
    use changing_styles::{delivery, start_input};
    let input = start_input();
    assert_eq!(
        serde_json::to_value(&input).unwrap(),
        json!({"activityKey":"mochi:snack","schemaVersion":2,"fallback":"notification",
            "layout":{"lockScreen":{"type":"text","bind":"status","style":"status"}},
            "styles":{"status":{"color":{"bind":"tone"}}},
            "snapshot":{"revision":0,"values":{"status":"On time","tone":"green"}}})
    );
    assert_eq!(input.validate(), Ok(()));
    let update = |snapshot| LayoutUpdateInput::new("handle", snapshot);
    let late = update(delivery(1, "Running late", "red"));
    assert_eq!(input.validate_update(&late), Ok(()));
    let unknown = update(delivery(1, "Running late", "crimson"));
    assert_eq!(unknown.validate(), Ok(()));
    assert_eq!(input.validate_update(&unknown), Err(Error::invalid()));

    // The calls of the example. Desktop checks the request and then has no backend.
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_live_activity::init())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let unsupported = changing_styles::run_late(app.handle()).unwrap_err();
    assert_eq!(unsupported.code, "UNSUPPORTED_PLATFORM");
    let plugin = app.live_activity();
    assert_eq!(
        plugin.update_layout(late).unwrap_err().code,
        "UNSUPPORTED_PLATFORM"
    );
    let mut wrong = start_input();
    wrong.snapshot = delivery(0, "On time", "Green");
    assert_eq!(plugin.start_layout(wrong), Err(Error::invalid()));
}

// TP-CONTRACT-2, TP-RUST-2
#[test]
fn layout_fixtures_keep_their_verdict_and_weight_through_the_typed_models() {
    for case in layout_cases("valid") {
        let (name, input) = (&case["name"], case["input"].clone());
        let encoded = match case["command"].as_str().unwrap() {
            "start_layout" => {
                let typed: LayoutStartInput = serde_json::from_value(input).unwrap();
                assert_eq!(typed.validate(), Ok(()), "{name}");
                serde_json::to_value(&typed).unwrap()
            }
            "update_layout" => {
                let typed: LayoutUpdateInput = serde_json::from_value(input).unwrap();
                assert_eq!(typed.validate(), Ok(()), "{name}");
                serde_json::to_value(&typed).unwrap()
            }
            "end_layout" => {
                let typed: LayoutEndInput = serde_json::from_value(input.clone()).unwrap();
                assert_eq!(typed.validate(), Ok(()), "{name}");
                assert_eq!(serde_json::to_value(&typed).unwrap(), input, "{name}");
                if input.get("snapshot").is_none() {
                    continue;
                }
                serde_json::to_value(&typed).unwrap()
            }
            _ => continue,
        };
        assert_eq!(case["weight"], json!(layout_weight(&encoded)), "{name}");
    }
}

// TP-CONTRACT-2
#[test]
fn layout_weight_limit_is_a_payload_error_only_for_an_otherwise_valid_request() {
    let start = |values: Value| {
        json!({"activityKey":"job:1","schemaVersion":2,"fallback":"none",
            "layout":{"lockScreen":{"type":"text","bind":"a"}},"snapshot":{"revision":0,"values":values}})
    };
    let heavy =
        json!({"a":"x".repeat(1000),"b":"x".repeat(1000),"c":"x".repeat(1000),"d":"x".repeat(600)});
    let error = validate_request("start_layout", start(heavy.clone())).unwrap_err();
    assert_eq!(error, Error::payload_too_large());
    assert_eq!(error.code, "PAYLOAD_TOO_LARGE");
    assert!(!error.message.contains("xx"));
    let update = json!({"id":"id","snapshot":{"revision":1,"values":heavy}});
    assert_eq!(
        validate_request("update_layout", update),
        Err(Error::payload_too_large())
    );
    let mut broken = start(
        json!({"b":"x".repeat(1000),"c":"x".repeat(1000),"d":"x".repeat(1000),"e":"x".repeat(1000)}),
    );
    assert_eq!(
        validate_request("start_layout", broken.clone()),
        Err(Error::invalid())
    );
    broken["layout"]["lockScreen"] = json!({"type":"text","value":"a"});
    assert_eq!(
        validate_request("start_layout", broken),
        Err(Error::payload_too_large())
    );
}

// TP-CONTRACT-5, TP-RUST-3
#[test]
fn layout_commands_do_not_mix_with_contract_v1() {
    let v2 = json!({"activityKey":"job:1","schemaVersion":2,"fallback":"none",
        "layout":{"lockScreen":{"type":"text","value":"a"}},"snapshot":{"revision":0,"values":{}}});
    assert_eq!(validate_request("start_layout", v2.clone()), Ok(()));
    assert_eq!(validate_request("start", v2), Err(Error::invalid()));
    assert_eq!(
        validate_request("start_layout", progress()),
        Err(Error::invalid())
    );
    let end = json!({"id":"id","policy":{"kind":"after","at":1}});
    assert_eq!(validate_request("end_layout", end), Ok(()));
    for command in ["list_layout", "startLayout", "start_layout ", ""] {
        assert_eq!(
            validate_request(command, json!({})),
            Err(Error::invalid()),
            "{command}"
        );
    }
}

/// A timer style holds liveupdate's `Timer`. The plugin re-exports `TimerStyle` and the template's `Timer`, which is
/// another type with the same members, and not liveupdate's: Rust reads a timer style from JSON, as it comes from
/// JavaScript, and reads its members without naming the type.
// TP-CONTRACT-8, TP-RUST-2
#[test]
fn an_android_content_with_a_timer_style_reads_from_json_and_is_checked_in_full() {
    use tauri_plugin_live_activity::{AndroidContent, PresentationStyle, Timer};
    let content = |started_at: u64, ends_at: u64| {
        json!({"title":"Mochi’s nap","status":"Dozing off","presentation":{"style":{"kind":"timer",
            "value":{"timer":{"startedAt":started_at,"endsAt":ends_at},"countsDown":true}}}})
    };
    let typed: AndroidContent = serde_json::from_value(content(1_000, 2_000)).unwrap();
    let PresentationStyle::Timer(style) = &typed.presentation.style else {
        panic!("the style is a timer");
    };
    assert_eq!(
        (
            style.timer.started_at,
            style.timer.ends_at,
            style.counts_down
        ),
        (1_000, 2_000, true)
    );
    // What Rust writes is what it read: the members that the TypeScript declarations name.
    assert_eq!(serde_json::to_value(&typed).unwrap(), content(1_000, 2_000));
    // The template's `Timer` writes the same two members, so one TypeScript `Timer` serves both.
    let template = Timer {
        started_at: 1_000,
        ends_at: 2_000,
    };
    assert_eq!(
        serde_json::to_value(&template).unwrap(),
        content(1_000, 2_000)["presentation"]["style"]["value"]["timer"]
    );

    let start = |android: Value| {
        json!({"activityKey":"mochi:nap","schemaVersion":2,"fallback":"notification",
            "layout":{"lockScreen":{"type":"text","bind":"title"}},
            "snapshot":{"revision":0,"values":{"title":"Mochi’s nap"},"android":android}})
    };
    assert_eq!(
        validate_request("start_layout", start(content(1_000, 2_000))),
        Ok(())
    );
    // liveupdate's rules for a timer hold on every platform, before any backend: the end is after the start, and
    // the value has its two members and no other.
    assert_eq!(
        validate_request("start_layout", start(content(2_000, 2_000))),
        Err(Error::invalid())
    );
    for (pointer, value) in [
        ("/presentation/style/value/timer/endsAt", json!(null)),
        ("/presentation/style/value/timer/ends_at", json!(3_000)),
        ("/presentation/style/value/countsDown", json!("yes")),
    ] {
        let mut broken = content(1_000, 2_000);
        let (parent, member) = pointer.rsplit_once('/').unwrap();
        broken.pointer_mut(parent).unwrap()[member] = value;
        assert_eq!(
            validate_request("start_layout", start(broken)),
            Err(Error::invalid()),
            "{pointer}"
        );
    }
}

/// What the liveactivity crate takes with a start beside activitykit's schema, and the sound of an alert: the
/// requests that tests/layout-requests.test.mjs gives the reference validator, with the same verdicts.
// TP-CONTRACT-8, TP-RUST-3
#[test]
fn the_options_of_a_start_and_the_sound_of_an_alert_get_the_verdicts_of_the_reference_validator() {
    let started = |member: &str, value: Value| {
        let mut input = json!({"activityKey":"demo:1","schemaVersion":2,"fallback":"none",
            "layout":{"lockScreen":{"type":"text","value":"a"}},"snapshot":{"revision":0,"values":{}}});
        input[member] = value;
        validate_request("start_layout", input)
    };
    let updated = |member: &str, value: Value| {
        let mut input = json!({"id":"opaque-handle-1","snapshot":{"revision":1,"values":{}}});
        input[member] = value;
        validate_request("update_layout", input)
    };
    let alert = || json!({"title":"Your ride","body":"It starts now"});
    let with = |mut object: Value, member: &str, value: Value| {
        object[member] = value;
        object
    };
    let refused = Err(Error::invalid());

    // The sound of an alert is the name of a file, as an image's is.
    for sound in ["chime.aiff", "a", "0", "A_b-c.d", &"a".repeat(64)] {
        let sounding = with(alert(), "sound", json!(sound));
        assert_eq!(updated("alert", sounding), Ok(()), "{sound}");
    }
    let long = "a".repeat(65);
    for sound in [
        json!(""),
        json!(".aiff"),
        json!("-a"),
        json!("a b"),
        json!("sounds/chime.aiff"),
        json!(long),
        json!("é.aiff"),
        json!("chime.aiff\n"),
        json!(1),
        json!(null),
        json!(["a"]),
    ] {
        let sounding = with(alert(), "sound", sound.clone());
        assert_eq!(updated("alert", sounding), refused, "{sound}");
    }

    // The options of a start on iOS.
    for transient in [true, false] {
        assert_eq!(started("ios", json!({"transient":transient})), Ok(()));
    }
    for ios in [
        json!({}),
        json!({"transient":"yes"}),
        json!({"transient":1}),
        json!({"transient":null}),
        json!({"transient":true,"extra":1}),
        json!(null),
        json!([]),
        json!(true),
    ] {
        assert_eq!(started("ios", ios.clone()), refused, "{ios}");
    }

    // A scheduled start: a time and the alert shown then.
    for at in [0u64, 1_900_000_000_000, 8_640_000_000_000_000] {
        let scheduled = json!({"at":at,"alert":alert()});
        assert_eq!(started("scheduled", scheduled), Ok(()), "{at}");
    }
    let sounding = with(alert(), "sound", json!("chime.aiff"));
    assert_eq!(
        started("scheduled", json!({"at":1,"alert":sounding})),
        Ok(())
    );
    for scheduled in [
        json!({}),
        json!({"at":1}),
        json!({"alert":alert()}),
        json!({"at":-1,"alert":alert()}),
        json!({"at":0.5,"alert":alert()}),
        json!({"at":8_640_000_000_000_001u64,"alert":alert()}),
        json!({"at":"1","alert":alert()}),
        json!({"at":null,"alert":alert()}),
        json!({"at":1,"alert":null}),
        json!({"at":1,"alert":{"title":"a"}}),
        json!({"at":1,"alert":with(alert(), "title", json!(" "))}),
        json!({"at":1,"alert":with(alert(), "sound", json!("a b"))}),
        json!({"at":1,"alert":with(alert(), "extra", json!(1))}),
        json!({"at":1,"alert":alert(),"extra":1}),
        json!(null),
        json!([]),
        json!(1),
    ] {
        assert_eq!(
            started("scheduled", scheduled.clone()),
            refused,
            "{scheduled}"
        );
    }

    // The options of a start on Android: a public version, of a private activity only, and a placement.
    let public_version = || json!({"title":"Delivery","status":"On the way"});
    for android in [
        json!({"visibility":"private"}),
        json!({"visibility":"private","publicVersion":public_version(),"placement":"foreground"}),
        json!({"visibility":"public","placement":"tagged"}),
        json!({"visibility":"secret","placement":"foreground"}),
        json!({"visibility":"private","publicVersion":{"title":"😀".repeat(120),"status":"한".repeat(240)}}),
    ] {
        assert_eq!(started("android", android.clone()), Ok(()), "{android}");
    }
    for placement in [
        json!("Tagged"),
        json!("service"),
        json!(""),
        json!(null),
        json!(1),
        json!(["tagged"]),
    ] {
        let android = json!({"visibility":"private","placement":placement});
        assert_eq!(started("android", android), refused, "{placement}");
    }
    for wrong in [
        json!({}),
        json!({"title":"a"}),
        json!({"status":"b"}),
        json!({"title":"","status":"b"}),
        json!({"title":"a","status":" "}),
        json!({"title":"a".repeat(121),"status":"b"}),
        json!({"title":"a","status":"b".repeat(241)}),
        with(public_version(), "extra", json!(1)),
        json!({"title":1,"status":"b"}),
        json!(null),
        json!([]),
        json!("a"),
    ] {
        let android = json!({"visibility":"private","publicVersion":wrong});
        assert_eq!(started("android", android), refused, "{wrong}");
    }
    for visibility in ["public", "secret"] {
        let android = json!({"visibility":visibility,"publicVersion":public_version()});
        assert_eq!(started("android", android), refused, "{visibility}");
    }
    for android in [
        json!({"visibility":"hidden"}),
        json!({"placement":"tagged"}),
        json!({"visibility":"private","lights":true}),
    ] {
        assert_eq!(started("android", android.clone()), refused, "{android}");
    }

    // The public version of a snapshot's Android content is of a private activity too, which a start is unless it
    // says otherwise. An update does not say how its activity started: there only Android knows.
    let showing = |android: Option<&str>| {
        let mut input = json!({"activityKey":"demo:1","schemaVersion":2,"fallback":"none",
            "layout":{"lockScreen":{"type":"text","value":"a"}},
            "snapshot":{"revision":0,"values":{},"android":{"title":"On time","status":"Gate 4",
                "presentation":{"style":{"kind":"standard"},"publicVersion":public_version()}}}});
        if let Some(visibility) = android {
            input["android"] = json!({"visibility":visibility});
        }
        input
    };
    for (visibility, verdict) in [
        (None, Ok(())),
        (Some("private"), Ok(())),
        (Some("public"), refused.clone()),
        (Some("secret"), refused.clone()),
    ] {
        assert_eq!(
            validate_request("start_layout", showing(visibility)),
            verdict,
            "{visibility:?}"
        );
    }
    assert_eq!(
        updated("snapshot", showing(None)["snapshot"].clone()),
        Ok(())
    );

    // Each member belongs to its command.
    for (member, value) in [
        ("ios", json!({"transient":true})),
        ("scheduled", json!({"at":1,"alert":alert()})),
        ("android", json!({"visibility":"private"})),
    ] {
        assert_eq!(updated(member, value), refused, "{member}");
    }
    assert_eq!(started("alert", alert()), refused);
    for (member, value) in [("alert", alert()), ("ios", json!({"transient":true}))] {
        let end = with(json!({"id":"a","policy":{"kind":"default"}}), member, value);
        assert_eq!(validate_request("end_layout", end), refused, "{member}");
    }

    // A typed start writes the members as it read them.
    let mut full = showing(Some("private"));
    full["android"] =
        json!({"visibility":"private","publicVersion":public_version(),"placement":"foreground"});
    full["ios"] = json!({"transient":true});
    full["scheduled"] = json!({"at":1,"alert":with(alert(), "sound", json!("chime.aiff"))});
    let typed: LayoutStartInput = serde_json::from_value(full.clone()).unwrap();
    assert_eq!(typed.validate(), Ok(()));
    assert_eq!(serde_json::to_value(&typed).unwrap(), full);
}

/// Tauri reads a request from JSON text with this crate's serde_json, so every number must
/// arrive as the double that JavaScript wrote.
// TP-CONTRACT-6
#[test]
fn layout_numbers_keep_their_value_when_read_from_json_text() {
    for text in [
        "977.9461044818163",
        "0.0018531278500143397",
        "96.00000000000001",
        "0.09999999999999999",
        "3875413157790899.5",
        "8640000000000000.6",
    ] {
        let read: Value = serde_json::from_str(text).unwrap();
        assert_eq!(read.as_f64(), text.parse().ok(), "{text}");
    }
    let start = |style: &str, values: &str| {
        let text = format!(
            r#"{{"activityKey":"job:1","schemaVersion":2,"fallback":"none","layout":{{"lockScreen":
            {{"type":"vstack","children":[{{"type":"text","value":"a","style":"s"}},
            {{"type":"timerText","start":"from","end":"to"}}]}}}},"styles":{{"s":{style}}},
            "snapshot":{{"revision":0,"values":{values}}}}}"#
        );
        validate_request("start_layout", serde_json::from_str(&text).unwrap())
    };
    let times = r#"{"from":1,"to":2}"#;
    assert_eq!(
        start(r#"{"size":96,"minimumScaleFactor":0.1}"#, times),
        Ok(())
    );
    // Each number is just outside its range; a rounded read would bring it back inside.
    for (style, values) in [
        (r#"{"size":96.00000000000001}"#, times),
        (r#"{"minimumScaleFactor":0.09999999999999999}"#, times),
        (r#"{"size":12}"#, r#"{"from":0.9999999999999999,"to":2}"#),
        (
            r#"{"size":12}"#,
            r#"{"from":3875413157790899.5,"to":3875413157790901}"#,
        ),
        (r#"{"size":12}"#, r#"{"from":1,"to":8640000000000000.6}"#),
    ] {
        assert_eq!(
            start(style, values),
            Err(Error::invalid()),
            "{style} {values}"
        );
    }
}

/// Each pair is a start and an end with final content, which the native layer checks against the stored layout and
/// styles as an update. A valid pair states the weight of the layout, the styles and the final values.
// TP-CONTRACT-2, TP-RUST-3
#[test]
fn layout_end_fixtures_match_the_check_against_the_start() {
    let ends = layout_cases("ends");
    assert!(ends.len() >= 4);
    for case in &ends {
        let name = case["name"].as_str().unwrap();
        assert_eq!(
            validate_request("start_layout", case["start"].clone()),
            Ok(()),
            "{name}"
        );
        let start: LayoutStartInput = serde_json::from_value(case["start"].clone()).unwrap();
        let verdict = validate_request("end_layout", case["end"].clone()).and_then(|()| {
            let end: LayoutEndInput = serde_json::from_value(case["end"].clone()).unwrap();
            start.validate_end(&end)
        });
        match case.get("code") {
            None => {
                assert_eq!(verdict, Ok(()), "{name}");
                let stored =
                    layout_weight(&case["start"]) - weight(&case["start"]["snapshot"]["values"]);
                let total = stored + weight(&case["end"]["snapshot"]["values"]);
                assert_eq!(case["weight"], json!(total), "{name}");
            }
            Some(code) => assert_eq!(code, verdict.expect_err(name).code.as_str(), "{name}"),
        }
    }
}
