//! The joints between the plugin and activitykit, on the host: the kit's settings, the requests that the plugin's specs
//! become, and the loop that hands each tap to the handlers and lets it go after them.

use super::{
    EndSpec, Handle, Kit, KitEvent, StartSpec, UpdateSpec, action_event, block_on,
    fake::{FakeAck, FakeHandle, FakeKit, Log},
    glue::{
        LATEST_MILLIS, builder, end_of, events_of, millis, setup, setup_with, start_of, time,
        update_of,
    },
    start_spec,
};
use crate::{
    Config, Receipts,
    layout::{LayoutPush, LayoutStartInput, Value},
    models::EndPolicy,
    pushes::PushEvent,
};
use activitykit::{ActivityKit, ChannelId, End, Push, Start, Update, Values};
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
    assert_eq!(debug(start_of(spec.clone()).unwrap()), debug(full));
    let bare = StartSpec {
        stale_at: None,
        timestamp: None,
        ..spec
    };
    let plain = Start::new(bare.layout.clone(), bare.values.clone())
        .key("demo:1")
        .revision(5);
    assert_eq!(debug(start_of(bare).unwrap()), debug(plain));
}

// TP-IOS-16
#[test]
fn times_are_epoch_milliseconds_both_ways() {
    for at in [0, 1_790_000_000_000, LATEST_MILLIS] {
        assert_eq!(millis(time(at)), Some(at));
    }
    // Later times, the contract's largest included, clamp to the latest time every platform's SystemTime holds: on
    // Windows a later one overflows.
    for later in [LATEST_MILLIS + 1, 8_640_000_000_000_000, u64::MAX] {
        assert_eq!(millis(time(later)), Some(LATEST_MILLIS));
    }
    assert_eq!(millis(UNIX_EPOCH - Duration::from_millis(1)), None);
}

// TP-IOS-16
#[test]
fn a_far_future_time_reaches_activitykit_capped() {
    let spec = StartSpec {
        stale_at: Some(8_640_000_000_000_000),
        timestamp: Some(u64::MAX),
        ..spec()
    };
    let capped = Start::new(spec.layout.clone(), spec.values.clone())
        .key("demo:1")
        .revision(5)
        .stale_at(time(LATEST_MILLIS))
        .timestamp(time(LATEST_MILLIS));
    assert_eq!(debug(start_of(spec).unwrap()), debug(capped));
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
        End::after(time(LATEST_MILLIS))
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
        push_to_start: None,
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
    let failed = setup::<FakeKit>(Err(conflict), |_| {}, |_| {})
        .err()
        .unwrap();
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
    let (_apple, actions) = setup(
        Ok(kit.clone()),
        move |event| {
            emitted
                .lock()
                .unwrap()
                .push(format!("emit:{}:{:?}", event.action_id, event.activity_key));
        },
        |_| {},
    )
    .unwrap();
    // The plugin subscribes to the kit's events before anything else.
    assert_eq!(kit.calls(), ["events"]);
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
    kit.close_events();
    thread::sleep(Duration::from_millis(50));
    actions.subscribe(|_| {});
}

// TP-ACTION-3
#[test]
fn setup_subscribes_to_the_kits_events_before_it_starts_the_handlers_thread() {
    let kit = FakeKit::default();
    let spawned = kit.clone();
    let (_apple, _actions) = setup_with(
        Ok(kit.clone()),
        move || {
            spawned.book().calls.push("spawn".into());
            crate::actions::spawn(|_| {})
        },
        |_| {},
    )
    .unwrap();
    // A tap that launched the app waits for the first subscriber: the plugin subscribes before anything else.
    assert_eq!(kit.calls(), ["events", "spawn"]);
}

// TP-ACTION-1, TP-ACTION-3
#[test]
fn the_kits_events_become_taps_until_they_end_and_other_events_pass() {
    // What activitykit's events are to the plugin: taps with what holds them, among other events.
    enum Seen {
        Started,
        Tapped(&'static str),
        Ended,
    }
    let log = Log::default();
    let events = vec![
        Seen::Started,
        Seen::Tapped("pet"),
        Seen::Ended,
        Seen::Tapped("done"),
    ];
    let mut stream = events.into_iter();
    let held = log.clone();
    let kit = FakeKit::default();
    let handle = kit.handle("la-1", "demo:1");
    let events: Vec<KitEvent<FakeHandle, FakeAck>> = events_of(
        move || stream.next(),
        move |event| match event {
            Seen::Tapped(action) => Some(KitEvent::Tap(
                action_event(&handle, action.into()),
                FakeAck(held.clone()),
            )),
            Seen::Started | Seen::Ended => None,
        },
    )
    .collect();
    let actions: Vec<_> = events
        .iter()
        .map(|event| match event {
            KitEvent::Tap(tap, _) => tap.action_id.as_str(),
            _ => "other",
        })
        .collect();
    assert_eq!(actions, ["pet", "done"]);
    let KitEvent::Tap(first, _) = &events[0] else {
        panic!("a tap")
    };
    assert_eq!(first.activity_key.as_deref(), Some("demo:1"));
    // Nothing is let go while the plugin holds the taps.
    assert!(log.lock().unwrap().is_empty());
}

// TP-PUSH-1
#[test]
fn a_start_carries_its_push_to_activitykit() {
    let with = |push| StartSpec {
        push: Some(push),
        ..spec()
    };
    let expected = |push| {
        Start::new(spec().layout, spec().values)
            .key("demo:1")
            .revision(5)
            .stale_at(time(1000))
            .timestamp(time(1_790_000_000_000))
            .push(push)
    };
    assert_eq!(
        debug(start_of(with(LayoutPush::Token)).unwrap()),
        debug(expected(Push::Token))
    );
    assert_eq!(
        debug(start_of(with(LayoutPush::Channel("dGVzdA==".into()))).unwrap()),
        debug(expected(Push::Channel(ChannelId::new("dGVzdA==").unwrap())))
    );
    // The check of the request keeps a channel that is no id out; one still never reaches activitykit.
    let refused = start_of(with(LayoutPush::Channel("not base64!".into()))).unwrap_err();
    assert_eq!(refused.code(), "INVALID_INPUT");
}

// TP-PUSH-3
#[test]
fn the_builder_watches_push_to_start_when_the_configuration_says_so() {
    let config = |push_to_start| Config {
        receipts: None,
        android: None,
        push_to_start,
    };
    assert_eq!(
        builder(Some(&config(Some(true)))),
        ActivityKit::builder().push_to_start(true)
    );
    for off in [None, Some(&config(Some(false))), Some(&config(None))] {
        assert_eq!(builder(off), ActivityKit::builder());
    }
}

/// What JavaScript would get of an event of the pushes, in one line.
fn payload(event: &PushEvent) -> String {
    match event {
        PushEvent::Token(token) => format!(
            "{}/{}/{}",
            token.activity_id,
            token.activity_key.as_deref().unwrap_or("-"),
            token.token
        ),
        PushEvent::PushToStartToken(token) => token.token.clone(),
        PushEvent::Updated(updated) => format!(
            "{}@{} {:?}",
            updated.record.id, updated.record.snapshot.revision, updated.record.snapshot.values
        ),
    }
}

// TP-PUSH-2, TP-PUSH-4, TP-PUSH-6
#[test]
fn push_events_reach_javascript_as_they_come_without_waiting_for_the_taps_handlers() {
    let kit = FakeKit::default();
    let log = Log::default();
    let (tapped, pushed) = (log.clone(), log.clone());
    let (_apple, actions) = setup(
        Ok(kit.clone()),
        move |event| {
            tapped
                .lock()
                .unwrap()
                .push(format!("emit:{}", event.action_id));
        },
        move |event| {
            pushed
                .lock()
                .unwrap()
                .push(format!("{}:{}", event.name(), payload(event)));
        },
    )
    .unwrap();
    let slow = log.clone();
    actions.subscribe(move |event| {
        thread::sleep(Duration::from_secs(1));
        slow.lock()
            .unwrap()
            .push(format!("slow:{}", event.action_id));
    });
    let activity = block_on(kit.start(spec())).unwrap();
    // A tap first: its handler takes a second, and the events of the pushes behind it do not wait for it.
    kit.send_tap(action_event(&activity, "pet".into()), FakeAck(log.clone()));
    kit.send_event(KitEvent::PushToken {
        activity: activity.clone(),
        token: "0a1b".into(),
    });
    kit.send_event(KitEvent::PushToStartToken {
        token: "ff00".into(),
    });
    kit.pushed(activity.id(), 7, values("Pushed"));
    kit.send_event(KitEvent::Updated(activity.clone()));
    wait_for(&log, "released");
    assert_eq!(
        *log.lock().unwrap(),
        [
            "live-activity://push-token:la-ios-layout-1/demo:1/0a1b",
            "live-activity://push-to-start-token:ff00",
            "live-activity://updated:la-ios-layout-1@7 {\"status\": Text(\"Pushed\")}",
            "slow:pet",
            "emit:pet",
            "released",
        ]
    );
    // A token of an activity the system no longer lists names no key, as a tap does not.
    let gone = kit.handle("gone", "");
    let event = PushEvent::Token(super::push_token_event(&gone, "0a".into()));
    assert_eq!(payload(&event), "gone/-/0a");
}
