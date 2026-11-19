use serde_json::{Value, json};
use std::{fs, path::Path, process::Command, sync::OnceLock};
use tauri_plugin_live_activity::{
    Error, LayoutEndInput, LayoutStartInput, LayoutUpdateInput, LiveActivityExt, Validate,
    validate_request, weight,
};

/// The layout fixtures of the activitykit version in Cargo.lock, from that crate's own folder: the plugin keeps no
/// copy of them.
fn layout_fixtures() -> &'static Value {
    static FIXTURES: OnceLock<Value> = OnceLock::new();
    FIXTURES.get_or_init(|| {
        let metadata = Command::new(env!("CARGO"))
            .args(["metadata", "--format-version", "1", "--locked"])
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .output()
            .expect("cargo answers its metadata");
        assert!(
            metadata.status.success(),
            "cargo metadata failed: {}",
            String::from_utf8_lossy(&metadata.stderr)
        );
        let metadata: Value = serde_json::from_slice(&metadata.stdout).unwrap();
        let manifest = metadata["packages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|package| package["name"] == "activitykit")
            .expect("activitykit is a dependency")["manifest_path"]
            .as_str()
            .unwrap()
            .to_owned();
        let file = Path::new(&manifest)
            .parent()
            .unwrap()
            .join("tests/fixtures/layout-requests.json");
        serde_json::from_slice(&fs::read(file).expect("activitykit ships its fixtures")).unwrap()
    })
}

fn layout_cases(verdict: &str) -> Vec<Value> {
    layout_fixtures()[verdict].as_array().unwrap().clone()
}

/// Weight of a start (layout, styles, values) or an update (values) as the fixtures state it.
fn layout_weight(input: &Value) -> usize {
    let part = |pointer| input.pointer(pointer).map(weight);
    part("/snapshot/values").unwrap()
        + part("/layout").map_or(0, |layout| layout + part("/styles").unwrap_or(2))
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
                small: None,
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

// TP-RUST-1, TP-RUST-3, TP-DESKTOP-1
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

/// Where the two engine versions of the plugin's Cargo.lock meet: activitykit's fixtures, liveactivity's models.
// TP-RUST-2
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

// TP-RUST-6
#[test]
fn requests_are_built_on_the_constructors_through_the_plugins_exports() {
    use std::collections::BTreeMap;
    use tauri_plugin_live_activity::{
        AndroidContent, AndroidOptions, AndroidPresentation, AndroidVisibility, EndInput,
        EndPolicy, ImageInput, LayoutSnapshot, PresentationStyle, ProgressSegment, ProgressStyle,
        PublicVersion, Snapshot, StartInput, Template, UpdateInput,
    };
    // The templates: a start takes its template from its snapshot.
    let start = StartInput::new("ride:7", Snapshot::progress(0, "Ride", "On the way", 0.5));
    assert_eq!(
        serde_json::to_value(&start).unwrap(),
        json!({"activityKey":"ride:7","schemaVersion":1,"template":"progress","fallback":"notification",
            "snapshot":{"revision":0,"title":"Ride","status":"On the way","progress":0.5}})
    );
    assert_eq!(start.validate(), Ok(()));
    let nap = Snapshot::timer(1, "Nap", "Asleep", 10, 20);
    assert_eq!(
        serde_json::to_value(UpdateInput::new("id", nap)).unwrap(),
        json!({"id":"id","snapshot":{"revision":1,"title":"Nap","status":"Asleep",
            "timer":{"startedAt":10,"endsAt":20}}})
    );
    assert_eq!(
        serde_json::to_value(EndInput::after("id", 9)).unwrap(),
        json!({"id":"id","policy":{"kind":"after","at":9}})
    );
    assert_eq!(
        serde_json::to_value(ImageInput::new("cat.png", vec![1, 2])).unwrap(),
        json!({"name":"cat.png","png":[1,2]})
    );

    // A layout's snapshot with an Android content, and the options of its start, each on its constructor.
    let track = ProgressStyle {
        styled_by_progress: true,
        ..ProgressStyle::new(60, vec![ProgressSegment::new(100)])
    };
    let mut snapshot = LayoutSnapshot::new(0, BTreeMap::new());
    snapshot.android = Some(AndroidContent::new(
        "Ride",
        "On the way",
        AndroidPresentation {
            public_version: Some(PublicVersion::new("Ride", "Soon")),
            wear_ongoing_activity: false,
            ..AndroidPresentation::new(PresentationStyle::Progress(track))
        },
    ));
    assert_eq!(
        serde_json::to_value(&snapshot).unwrap()["android"],
        json!({"title":"Ride","status":"On the way","presentation":{
            "style":{"kind":"progress","value":{"progress":60,"styledByProgress":true,"segments":[{"length":100}]}},
            "publicVersion":{"title":"Ride","status":"Soon"},
            "wearOngoingActivity":false}})
    );
    assert_eq!(
        serde_json::to_value(
            AndroidOptions::new(AndroidVisibility::Private).with_wear_ongoing_activity(false)
        )
        .unwrap(),
        json!({"visibility":"private","wearOngoingActivity":false})
    );

    // The other parts of a presentation, each on its constructor. A timer style takes liveupdate's `Timer`,
    // which the plugin has under `liveupdate`, since the contract's `Timer` is the template's.
    use tauri_plugin_live_activity::{
        BigTextStyle, Metric, MetricStyle, MetricValue, NotificationAction, Timer, TimerStyle,
        liveupdate,
    };
    assert_eq!(
        serde_json::to_value(Timer::new(10, 20)).unwrap(),
        json!({"startedAt":10,"endsAt":20})
    );
    let clock = TimerStyle::new(liveupdate::Timer::new(10, 20), true);
    let steps = Metric::new(
        "Steps",
        MetricValue::Integer {
            value: 42,
            unit: None,
        },
    );
    let presentation = AndroidPresentation {
        actions: vec![NotificationAction::new("call", "Call")],
        chronometer: Some(clock),
        ..AndroidPresentation::new(PresentationStyle::Metric(MetricStyle::new(vec![steps])))
    };
    assert_eq!(
        serde_json::to_value(&presentation).unwrap(),
        json!({"style":{"kind":"metric","value":{"metrics":[{"label":"Steps","value":{"kind":"integer","value":{"value":42}}}]}},
            "actions":[{"id":"call","title":"Call"}],
            "chronometer":{"timer":{"startedAt":10,"endsAt":20},"countsDown":true}})
    );
    assert_eq!(
        serde_json::to_value(PresentationStyle::BigText(BigTextStyle::new("A long text"))).unwrap(),
        json!({"kind":"bigText","value":{"text":"A long text"}})
    );

    // The contract's enums are matched with a last arm.
    #[deny(unreachable_patterns)]
    fn named(template: Template, policy: &EndPolicy) -> (&'static str, &'static str) {
        let template = match template {
            Template::Progress => "progress",
            Template::Timer => "timer",
            _ => "later",
        };
        let policy = match policy {
            EndPolicy::Immediate {} => "immediate",
            EndPolicy::Default {} => "default",
            EndPolicy::After { .. } => "after",
            _ => "later",
        };
        (template, policy)
    }
    assert_eq!(
        named(Template::Timer, &EndPolicy::After { at: 1 }),
        ("timer", "after")
    );
}

// TP-ANDROID-20
#[test]
fn a_watchs_ongoing_activity_is_a_boolean_in_a_start_and_in_a_content() {
    let start = |members: Value| {
        let mut request = json!({"activityKey":"ride:7","schemaVersion":2,"fallback":"notification",
            "layout":{"lockScreen":{"type":"text","bind":"eta"}},
            "snapshot":{"revision":0,"values":{"eta":"4 min"}}});
        request
            .as_object_mut()
            .unwrap()
            .extend(members.as_object().unwrap().clone());
        validate_request("start_layout", request).map_err(|error| error.code)
    };
    let option =
        |value: Value| json!({"android":{"visibility":"private","wearOngoingActivity":value}});
    let content = |value: Value| {
        json!({"snapshot":{"revision":0,"values":{"eta":"4 min"},"android":{"title":"Ride","status":"On the way",
            "presentation":{"style":{"kind":"standard"},"wearOngoingActivity":value}}}})
    };
    // Off, and on, which is what a request without the member says.
    for right in [
        option(json!(false)),
        option(json!(true)),
        content(json!(false)),
        content(json!(true)),
    ] {
        assert_eq!(start(right.clone()), Ok(()), "{right}");
    }
    for wrong in [
        option(json!("no")),
        option(json!(0)),
        option(Value::Null),
        content(json!("no")),
        content(json!(0)),
        content(Value::Null),
        // Where it does not belong: in a style, and beside the options.
        json!({"snapshot":{"revision":0,"values":{"eta":"4 min"},"android":{"title":"Ride","status":"On the way",
            "presentation":{"style":{"kind":"standard","wearOngoingActivity":true}}}}}),
        json!({"wearOngoingActivity":false}),
    ] {
        assert_eq!(
            start(wrong.clone()),
            Err("INVALID_INPUT".to_owned()),
            "{wrong}"
        );
    }
    // What a start that turns it off is to Rust: the options built on their constructor, written as the request.
    let options = tauri_plugin_live_activity::AndroidOptions::new(
        tauri_plugin_live_activity::AndroidVisibility::Private,
    )
    .with_wear_ongoing_activity(false);
    assert_eq!(
        serde_json::to_value(options).unwrap(),
        option(json!(false))["android"]
    );
}
