//! The joints between the plugin and activitykit, on the host: the kit's settings, the requests that the plugin's specs
//! become, and the loop that hands each tap to the handlers and lets it go after them.

use super::{
    EndSpec, StartSpec, UpdateSpec, action_event,
    fake::{FakeAck, FakeKit, Log},
    glue::{builder, end_of, millis, setup, start_of, time, update_of},
    start_spec,
};
use crate::{
    Config, Receipts,
    layout::{LayoutStartInput, Value},
    models::EndPolicy,
};
use activitykit::{ActivityKit, End, Start, Update, Values};
use serde_json::json;
use std::{
    fmt::Debug,
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

/// activitykit's `Start` and `Update` compare by what they hold, which their `Debug` shows in full.
fn debug(value: impl Debug) -> String {
    format!("{value:?}")
}

fn spec() -> StartSpec {
    let request: LayoutStartInput = serde_json::from_value(json!({
        "activityKey":"demo:1","schemaVersion":2,"fallback":"notification",
        "layout":{"lockScreen":{"type":"text","bind":"status"}},
        "snapshot":{"revision":5,"values":{"status":"On time"},"staleAt":1000,"timestamp":1_790_000_000_000u64}}))
    .unwrap();
    start_spec(request)
}

fn values(status: &str) -> Values {
    Values::from_iter([("status".to_owned(), Value::Text(status.into()))])
}

// TP-IOS-16
#[test]
fn a_start_goes_to_activitykit_with_its_key_revision_stale_date_and_timestamp() {
    let spec = spec();
    assert_eq!(spec.values, values("On time"));
    let full = Start::new(spec.layout.clone(), spec.values.clone())
        .key("demo:1")
        .revision(5)
        .stale_at(time(1000))
        .timestamp(time(1_790_000_000_000));
    assert_eq!(debug(start_of(spec.clone())), debug(full));
    let bare = StartSpec {
        stale_at: None,
        timestamp: None,
        ..spec
    };
    let plain = Start::new(bare.layout.clone(), bare.values.clone())
        .key("demo:1")
        .revision(5);
    assert_eq!(debug(start_of(bare)), debug(plain));
}

// TP-IOS-16
#[test]
fn times_are_epoch_milliseconds_both_ways() {
    for at in [0, 1_790_000_000_000, 8_640_000_000_000_000] {
        assert_eq!(millis(time(at)), Some(at));
    }
    assert_eq!(millis(UNIX_EPOCH - Duration::from_millis(1)), None);
}

// TP-IOS-16
#[test]
fn an_update_goes_to_activitykit_at_its_revision_with_its_stale_date_and_timestamp() {
    let full = UpdateSpec {
        values: values("Late"),
        revision: 9,
        stale_at: Some(2000),
        timestamp: Some(3000),
    };
    let expected = Update::new(values("Late"))
        .revision(9)
        .stale_at(time(2000))
        .timestamp(time(3000));
    assert_eq!(debug(update_of(full)), debug(expected));
    let bare = UpdateSpec {
        values: values("Late"),
        revision: 0,
        stale_at: None,
        timestamp: None,
    };
    assert_eq!(
        debug(update_of(bare)),
        debug(Update::new(values("Late")).revision(0))
    );
}

// TP-IOS-16
#[test]
fn an_end_goes_to_activitykit_with_its_policy_and_its_final_content() {
    let end = |policy| EndSpec {
        policy,
        values: None,
        revision: None,
        stale_at: None,
        timestamp: None,
    };
    assert_eq!(end_of(end(EndPolicy::Immediate {})), End::immediately());
    assert_eq!(end_of(end(EndPolicy::Default {})), End::default());
    let latest = 8_640_000_000_000_000;
    assert_eq!(
        end_of(end(EndPolicy::After { at: latest })),
        End::after(time(latest))
    );
    assert_ne!(
        end_of(end(EndPolicy::After { at: latest })),
        End::immediately()
    );
    let last = EndSpec {
        policy: EndPolicy::After { at: 4000 },
        values: Some(values("Done")),
        revision: Some(7),
        stale_at: Some(5000),
        timestamp: Some(6000),
    };
    let expected = End::after(time(4000))
        .values(values("Done"))
        .revision(7)
        .stale_at(time(5000))
        .timestamp(time(6000));
    assert_eq!(end_of(last), expected);
}

// TP-IOS-13
#[test]
fn the_kit_takes_its_receipts_from_the_configuration_and_a_conflicting_kit_fails_setup() {
    let config = |receipts| Config {
        receipts,
        android: None,
    };
    let redacted = config(Some(Receipts::Redacted));
    assert_eq!(
        builder(Some(&redacted)),
        ActivityKit::builder().receipts(activitykit::Receipts::Redacted)
    );
    for full in [
        None,
        Some(&config(Some(Receipts::Full))),
        Some(&config(None)),
    ] {
        assert_eq!(
            builder(full),
            ActivityKit::builder().receipts(activitykit::Receipts::Full)
        );
    }
    // activitykit answers a second kit with other settings with CONFLICT, and setup fails with it.
    let conflict = activitykit::Error::Conflict("other settings run".into());
    let failed = setup::<FakeKit>(Err(conflict), |_| {}).err().unwrap();
    assert_eq!(failed.code, "CONFLICT");
}

fn wait_for(log: &Log, entry: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !log.lock().unwrap().iter().any(|seen| seen == entry) {
        assert!(
            Instant::now() < deadline,
            "no {entry}: {:?}",
            log.lock().unwrap()
        );
        thread::sleep(Duration::from_millis(10));
    }
}

// TP-ACTION-1, TP-ACTION-3
#[test]
fn a_tap_from_activitykit_is_released_only_after_a_slow_handler_and_the_event() {
    let kit = FakeKit::default();
    let log = Log::default();
    let emitted = log.clone();
    let (_apple, actions) = setup(Ok(kit.clone()), move |event| {
        emitted
            .lock()
            .unwrap()
            .push(format!("emit:{}:{:?}", event.action_id, event.activity_key));
    })
    .unwrap();
    // The plugin subscribes to the kit's events before anything else.
    assert_eq!(kit.calls(), ["taps"]);
    let handled = log.clone();
    actions.subscribe(move |event| {
        thread::sleep(Duration::from_secs(1));
        handled
            .lock()
            .unwrap()
            .push(format!("slow:{}", event.action_id));
    });
    let started = Instant::now();
    let tapped = action_event(&kit.handle("la-1", "demo:1"), "pet".into());
    kit.send_tap(tapped, FakeAck(log.clone()));
    wait_for(&log, "released");
    assert!(started.elapsed() >= Duration::from_secs(1));
    assert_eq!(
        *log.lock().unwrap(),
        ["slow:pet", "emit:pet:Some(\"demo:1\")", "released"]
    );
    // When the kit's events end, so does the loop; the plugin keeps working.
    kit.close_taps();
    thread::sleep(Duration::from_millis(50));
    actions.subscribe(|_| {});
}
