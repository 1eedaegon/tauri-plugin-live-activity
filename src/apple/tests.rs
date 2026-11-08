use super::{fake::FakeKit, *};
use crate::layout::Value;
use activitykit::{Error as Kit, LimitScope};
use serde_json::{Value as Json, json};

fn apple() -> (Apple<FakeKit>, FakeKit) {
    let kit = FakeKit::default();
    (Apple::new(kit.clone(), false), kit)
}

fn start_json(key: &str, tone: &str) -> Json {
    json!({"activityKey":key,"schemaVersion":2,"fallback":"notification",
        "layout":{"lockScreen":{"type":"text","bind":"status","style":"s"}},
        "styles":{"s":{"color":{"bind":"tone"}}},
        "snapshot":{"revision":5,"values":{"status":"On time","tone":tone},"staleAt":1000},
        "android":{"visibility":"public"}})
}

fn start(key: &str, tone: &str) -> LayoutStartInput {
    serde_json::from_value(start_json(key, tone)).unwrap()
}

fn snapshot(revision: u64, tone: &str) -> LayoutSnapshot {
    serde_json::from_value(json!({"revision":revision,"values":{"status":"Late","tone":tone}}))
        .unwrap()
}

fn update(id: &str, revision: u64, tone: &str) -> LayoutUpdateInput {
    LayoutUpdateInput {
        id: id.into(),
        snapshot: snapshot(revision, tone),
    }
}

fn end(id: &str, policy: EndPolicy, snapshot: Option<LayoutSnapshot>) -> LayoutEndInput {
    LayoutEndInput {
        id: id.into(),
        policy,
        snapshot,
    }
}

fn progress(key: &str, revision: u64, progress: f64) -> StartInput {
    serde_json::from_value(
        json!({"activityKey":key,"schemaVersion":1,"template":"progress","fallback":"none",
        "snapshot":{"revision":revision,"title":"Job","status":"Running","progress":progress}}),
    )
    .unwrap()
}

fn template_update(id: &str, revision: u64, progress: f64) -> UpdateInput {
    serde_json::from_value(json!({"id":id,"snapshot":{"revision":revision,"title":"Job","status":"Running","progress":progress}}))
        .unwrap()
}

fn code<T: std::fmt::Debug>(result: Result<T>) -> String {
    result.unwrap_err().code
}

// TP-IOS-1, TP-IOS-8
#[test]
fn a_layout_start_goes_to_activitykit_and_answers_a_v2_record() {
    let (apple, kit) = apple();
    let record = block_on(apple.start_layout(start("demo:1", "green"))).unwrap();
    assert_eq!(
        serde_json::to_value(&record).unwrap(),
        json!({"id":"la-ios-layout-1","activityKey":"demo:1","schemaVersion":2,
            "snapshot":{"revision":0,"values":{"status":"On time","tone":"green"},"staleAt":1000},
            "backend":"activityKit","state":"active","visibility":"unknown","degradedFeatures":[],
            "promotionRequested":false,"promotionState":"notApplicable"})
    );
    let book = kit.book();
    let [sent] = book.starts.as_slice() else {
        panic!("one start")
    };
    assert_eq!((sent.key.as_str(), sent.stale_at), ("demo:1", Some(1000)));
    assert_eq!(sent.values.get("tone"), Some(&Value::Text("green".into())));
    let layout = serde_json::to_value(&sent.layout.lock_screen).unwrap();
    assert_eq!(layout, json!({"type":"text","bind":"status","style":"s"}));
    assert_eq!(sent.layout.styles.len(), 1);
    drop(book);
    for (state, wire) in [
        (State::Pending, "pending"),
        (State::Stale, "stale"),
        (State::Ended, "ended"),
        (State::Dismissed, "dismissed"),
        (State::Unknown, "unknown"),
    ] {
        kit.set_state("la-ios-layout-1", state);
        let listed = block_on(apple.list_layout()).unwrap();
        assert_eq!(serde_json::to_value(listed[0].state).unwrap(), wire);
    }
}

// TP-IOS-2
#[test]
fn the_same_start_returns_the_running_activity_and_another_start_conflicts() {
    let (apple, kit) = apple();
    let first = block_on(apple.start_layout(start("demo:1", "green"))).unwrap();
    let again = block_on(apple.start_layout(start("demo:1", "green"))).unwrap();
    assert_eq!(again, first);
    assert_eq!(kit.calls(), ["start demo:1"]);
    assert_eq!(
        code(block_on(apple.start_layout(start("demo:1", "red")))),
        "CONFLICT"
    );
    block_on(apple.end_layout(end(&first.id, EndPolicy::Immediate {}, None))).unwrap();
    let fresh = block_on(apple.start_layout(start("demo:1", "green"))).unwrap();
    assert_ne!(fresh.id, first.id);
    // After a relaunch the plugin does not know the start, and activitykit's fingerprint differs.
    let later = Apple::new(kit.relaunched(), false);
    assert_eq!(
        code(block_on(later.start_layout(start("demo:1", "green")))),
        "CONFLICT"
    );
}

// TP-IOS-3, TP-IOS-7
#[test]
fn an_update_follows_the_revision_rules_and_activitykit_numbers_the_revision() {
    let (apple, kit) = apple();
    let id = block_on(apple.start_layout(start("demo:1", "green")))
        .unwrap()
        .id;
    let mut timed = update(&id, 7, "red");
    timed.snapshot.timestamp = Some(1_790_000_000_000);
    timed.snapshot.stale_at = Some(2000);
    let record = block_on(apple.update_layout(timed)).unwrap();
    assert_eq!(record.snapshot.revision, 1);
    assert_eq!(record.snapshot.values["tone"], Value::Text("red".into()));
    assert_eq!(record.snapshot.stale_at, Some(2000));
    {
        let book = kit.book();
        assert_eq!(
            (book.updates[0].timestamp, book.updates[0].stale_at),
            (Some(1_790_000_000_000), Some(2000))
        );
    }
    let mut same = update(&id, 1, "red");
    same.snapshot.stale_at = Some(2000);
    assert_eq!(
        block_on(apple.update_layout(same))
            .unwrap()
            .snapshot
            .revision,
        1
    );
    assert_eq!(
        kit.calls()
            .iter()
            .filter(|call| call.starts_with("update"))
            .count(),
        1
    );
    assert_eq!(
        code(block_on(apple.update_layout(update(&id, 1, "green")))),
        "CONFLICT"
    );
    assert_eq!(
        code(block_on(apple.update_layout(update(&id, 0, "green")))),
        "STALE_REVISION"
    );
    assert_eq!(
        block_on(apple.update_layout(update(&id, 2, "green")))
            .unwrap()
            .snapshot
            .revision,
        2
    );
    assert_eq!(kit.book().updates[1].timestamp, None);
}

// TP-IOS-4, TP-IOS-6
#[test]
fn an_unknown_or_ended_activity_is_not_found_and_a_relaunch_finds_it_in_the_list() {
    let (apple, kit) = apple();
    assert_eq!(
        code(block_on(apple.update_layout(update(
            "la-ios-layout-9",
            1,
            "red"
        )))),
        "NOT_FOUND"
    );
    let id = block_on(apple.start_layout(start("demo:1", "green")))
        .unwrap()
        .id;
    block_on(apple.update_layout(update(&id, 1, "red"))).unwrap();
    let later = Apple::new(kit.relaunched(), false);
    let listed = block_on(later.list_layout()).unwrap();
    assert_eq!((listed.len(), listed[0].snapshot.revision), (1, 1));
    let fresh = Apple::new(kit.relaunched(), false);
    assert_eq!(
        block_on(fresh.update_layout(update(&id, 2, "green")))
            .unwrap()
            .snapshot
            .revision,
        2
    );
    kit.set_state(&id, State::Ended);
    assert_eq!(
        code(block_on(apple.update_layout(update(&id, 3, "red")))),
        "NOT_FOUND"
    );
    // A handle that only an event named is looked up in the list first.
    let (other, other_kit) = super::tests::apple();
    let started = block_on(other.start_layout(start("demo:2", "green"))).unwrap();
    let blind = Apple::new(other_kit.clone(), false);
    blind.remember(&other_kit.handle(&started.id, "demo:2"));
    assert_eq!(
        block_on(blind.update_layout(update(&started.id, 1, "red")))
            .unwrap()
            .snapshot
            .revision,
        1
    );
    assert_eq!(
        other_kit.calls().last().unwrap(),
        &format!("update {}", started.id)
    );
}

// TP-IOS-5
#[test]
fn an_end_sends_its_policy_and_its_final_content_and_ending_again_answers() {
    let (apple, kit) = apple();
    let id = block_on(apple.start_layout(start("demo:1", "green")))
        .unwrap()
        .id;
    let mut last = snapshot(1, "gray");
    last.timestamp = Some(5);
    let record = block_on(apple.end_layout(end(
        &id,
        EndPolicy::After {
            at: 8_640_000_000_000_000,
        },
        Some(last),
    )))
    .unwrap();
    assert_eq!(record.state, ActivityState::Ended);
    assert_eq!(record.snapshot.values["tone"], Value::Text("gray".into()));
    let again = block_on(apple.end_layout(end(&id, EndPolicy::Immediate {}, None))).unwrap();
    assert_eq!(again.state, ActivityState::Ended);
    let book = kit.book();
    assert_eq!(
        book.ends[0].policy,
        EndPolicy::After {
            at: 8_640_000_000_000_000
        }
    );
    assert_eq!(
        (
            book.ends[0].timestamp,
            book.ends[0].values.as_ref().map(|values| values.len())
        ),
        (Some(5), Some(2))
    );
    assert_eq!(
        (book.ends[1].policy.clone(), book.ends[1].values.clone()),
        (EndPolicy::Immediate {}, None)
    );
    drop(book);
    let id = block_on(apple.start_layout(start("demo:2", "green")))
        .unwrap()
        .id;
    block_on(apple.update_layout(update(&id, 1, "red"))).unwrap();
    let stale = Some(snapshot(0, "gray"));
    assert_eq!(
        code(block_on(apple.end_layout(end(
            &id,
            EndPolicy::Default {},
            stale
        )))),
        "STALE_REVISION"
    );
    let other = Some(snapshot(1, "gray"));
    assert_eq!(
        code(block_on(apple.end_layout(end(
            &id,
            EndPolicy::Default {},
            other
        )))),
        "CONFLICT"
    );
    let kept = block_on(apple.end_layout(end(&id, EndPolicy::Default {}, None))).unwrap();
    assert_eq!(
        (kept.snapshot.revision, kept.snapshot.values["tone"].clone()),
        (2, Value::Text("red".into()))
    );
    assert_eq!(
        code(block_on(apple.end_layout(end(
            "missing",
            EndPolicy::Default {},
            None
        )))),
        "NOT_FOUND"
    );
}

// TP-IOS-11, TP-IOS-12
#[test]
fn a_broken_request_never_reaches_activitykit_and_activitykit_errors_keep_their_codes() {
    let (apple, kit) = apple();
    let mut broken = start("demo:1", "green");
    broken.layout.lock_screen.style = Some("missing".into());
    assert_eq!(block_on(apple.start_layout(broken)), Err(Error::invalid()));
    let mut heavy = start("demo:1", "green");
    heavy.snapshot.values = (0..4)
        .map(|key| (format!("k{key}"), Value::Text("x".repeat(1000))))
        .collect();
    heavy.layout.lock_screen = serde_json::from_value(json!({"type":"text","value":"a"})).unwrap();
    heavy.styles = None;
    assert_eq!(
        block_on(apple.start_layout(heavy)),
        Err(Error::payload_too_large())
    );
    let crimson = update("la-ios-layout-1", 1, "crimson");
    assert_eq!(code(block_on(apple.update_layout(crimson))), "NOT_FOUND");
    assert_eq!(kit.calls(), ["list"]);
    for error in [
        Kit::NotForeground("ActivityKit refused the start: visibility".into()),
        Kit::PermissionDenied("Live Activities are turned off".into()),
        Kit::SystemLimit {
            scope: LimitScope::Device,
        },
        Kit::Unsupported,
        Kit::ConfigurationRequired(
            "Embed a widget extension built from the layout template.".into(),
        ),
    ] {
        kit.fail_next(error.clone());
        assert_eq!(
            block_on(apple.start_layout(start("demo:3", "green"))),
            Err(Error::from(error))
        );
    }
}

// TP-IOS-13
#[test]
fn redacted_receipts_stop_every_write_and_leave_the_lists() {
    let kit = FakeKit::default();
    let apple = Apple::new(kit.clone(), true);
    assert_eq!(
        code(block_on(apple.start_layout(start("demo:1", "green")))),
        "CONFIGURATION_REQUIRED"
    );
    assert_eq!(
        code(block_on(apple.update_layout(update("a", 1, "red")))),
        "CONFIGURATION_REQUIRED"
    );
    assert_eq!(
        code(block_on(apple.end_layout(end(
            "a",
            EndPolicy::Default {},
            None
        )))),
        "CONFIGURATION_REQUIRED"
    );
    assert_eq!(
        code(block_on(apple.start_template(progress("job:1", 0, 0.1)))),
        "CONFIGURATION_REQUIRED"
    );
    assert_eq!(
        code(block_on(
            apple.update_template(template_update("a", 1, 0.2))
        )),
        "CONFIGURATION_REQUIRED"
    );
    let ended = serde_json::from_value(json!({"id":"a","policy":{"kind":"immediate"}})).unwrap();
    assert_eq!(
        code(block_on(apple.end_template(ended))),
        "CONFIGURATION_REQUIRED"
    );
    assert_eq!(block_on(apple.list_layout()), Ok(vec![]));
    assert_eq!(block_on(apple.list_templates()), Ok(vec![]));
    assert_eq!(kit.calls(), ["list", "list"]);
    assert!(redacted().message.contains("receipts"));
}

// TP-IOS-9, TP-IOS-10, TP-IOS-15
#[test]
fn capabilities_and_permissions_follow_activitykits_authorization() {
    let (apple, kit) = apple();
    let all = apple.capabilities();
    assert_eq!(
        (all.backend, all.layout, all.actions, all.timer),
        (
            Backend::ActivityKit,
            FeatureSupport::Supported,
            FeatureSupport::Supported,
            FeatureSupport::Supported
        )
    );
    assert_eq!(
        (all.platform.as_str(), all.max_payload_bytes),
        ("ios", 4096)
    );
    assert_eq!(
        apple.permissions(false).live_activities,
        PermissionState::Granted
    );
    kit.book().authorization = Some(Authorization {
        supported: true,
        enabled: false,
        buttons: false,
    });
    let ios16 = apple.capabilities();
    assert_eq!(
        (ios16.start, ios16.actions),
        (FeatureSupport::Supported, FeatureSupport::Unsupported)
    );
    assert_eq!(
        apple.permissions(false).live_activities,
        PermissionState::Denied
    );
    let asked = apple
        .request_permissions(PermissionKind::LiveActivities)
        .unwrap();
    assert_eq!(
        (asked.live_activities, asked.notifications, asked.promotion),
        (
            PermissionState::SettingsRequired,
            PermissionState::NotApplicable,
            PermissionState::NotApplicable
        )
    );
    assert_eq!(
        code(apple.request_permissions(PermissionKind::Notifications)),
        "UNSUPPORTED_FEATURE"
    );
    assert_eq!(
        code(apple.request_permissions(PermissionKind::Promotion)),
        "UNSUPPORTED_FEATURE"
    );
    kit.book().authorization = Some(Authorization {
        supported: false,
        enabled: false,
        buttons: false,
    });
    let none = apple.capabilities();
    assert_eq!(
        (none.backend, none.start, none.layout, none.actions),
        (
            Backend::Unsupported,
            FeatureSupport::Unsupported,
            FeatureSupport::Unsupported,
            FeatureSupport::Unsupported
        )
    );
    assert_eq!(
        apple.permissions(true).live_activities,
        PermissionState::NotApplicable
    );
    kit.fail_next(Kit::Unsupported);
    assert_eq!(
        code(block_on(apple.start_layout(start("demo:1", "green")))),
        "UNSUPPORTED_PLATFORM"
    );
}

// TP-IOS-14
#[test]
fn an_image_is_checked_and_then_written_by_activitykit() {
    let (apple, kit) = apple();
    let png = crate::image::tests::png(2, 2, 0);
    assert_eq!(apple.write_image("badge.png", &png), Ok(()));
    assert_eq!(
        code(apple.write_image("../badge.png", &png)),
        "INVALID_INPUT"
    );
    assert_eq!(
        code(apple.write_image("big.png", &crate::image::tests::png(1225, 2, 0))),
        "PAYLOAD_TOO_LARGE"
    );
    kit.fail_next(Kit::ConfigurationRequired(
        "The widget extension names no App Group under ActivityKitAppGroup.".into(),
    ));
    assert_eq!(
        code(apple.write_image("badge.png", &png)),
        "CONFIGURATION_REQUIRED"
    );
    assert_eq!(kit.calls(), ["image badge.png", "image badge.png"]);
}

// TP-V1-1, TP-V1-2
#[test]
fn a_template_activity_starts_updates_ends_and_lists_as_contract_v1() {
    let (apple, kit) = apple();
    let record = block_on(apple.start_template(progress("job:1", 0, 0.3))).unwrap();
    assert_eq!(
        serde_json::to_value(&record).unwrap(),
        json!({"id":"la-ios-layout-1","activityKey":"job:1","schemaVersion":1,"template":"progress",
            "snapshot":{"revision":0,"title":"Job","status":"Running","progress":0.3},
            "backend":"activityKit","state":"active","visibility":"unknown","degradedFeatures":[],
            "promotionRequested":false,"promotionState":"notApplicable"})
    );
    assert_eq!(
        block_on(apple.start_template(progress("job:1", 0, 0.3))).unwrap(),
        record
    );
    let id = record.id;
    let updated = block_on(apple.update_template(template_update(&id, 1, 0.5))).unwrap();
    assert_eq!(
        (updated.snapshot.revision, updated.snapshot.progress),
        (1, Some(0.5))
    );
    assert_eq!(
        block_on(apple.update_template(template_update(&id, 1, 0.5))).unwrap(),
        updated
    );
    assert_eq!(
        code(block_on(
            apple.update_template(template_update(&id, 1, 0.9))
        )),
        "CONFLICT"
    );
    assert_eq!(
        code(block_on(
            apple.update_template(template_update(&id, 0, 0.1))
        )),
        "STALE_REVISION"
    );
    let timer = serde_json::from_value(json!({"id":id,"snapshot":{"revision":2,"title":"Job","status":"Running","timer":{"startedAt":1,"endsAt":2}}})).unwrap();
    assert_eq!(
        block_on(apple.update_template(timer)),
        Err(Error::invalid())
    );
    assert_eq!(block_on(apple.list_templates()).unwrap(), [updated]);
    let ending =
        serde_json::from_value::<EndInput>(json!({"id":id,"policy":{"kind":"immediate"}})).unwrap();
    let ended = block_on(apple.end_template(ending.clone())).unwrap();
    assert_eq!(
        (ended.state, ended.snapshot.progress),
        (ActivityState::Ended, Some(0.5))
    );
    assert_eq!(
        block_on(apple.end_template(ending)).unwrap().state,
        ActivityState::Ended
    );
    assert_eq!(
        code(block_on(
            apple.update_template(template_update(&id, 3, 0.5))
        )),
        "NOT_FOUND"
    );
    assert_eq!(
        kit.book().starts[0].values.get(template::MARKER),
        Some(&Value::Text("progress".into()))
    );
}

// TP-V1-3
#[test]
fn the_two_contract_versions_do_not_see_each_others_activities() {
    let (apple, _kit) = apple();
    let layout = block_on(apple.start_layout(start("demo:1", "green"))).unwrap();
    let template = block_on(apple.start_template(progress("job:1", 0, 0.3))).unwrap();
    assert_eq!(
        block_on(apple.list_layout()).unwrap(),
        std::slice::from_ref(&layout)
    );
    assert_eq!(
        block_on(apple.list_templates()).unwrap(),
        std::slice::from_ref(&template)
    );
    assert_eq!(
        code(block_on(
            apple.update_template(template_update(&layout.id, 1, 0.5))
        )),
        "NOT_FOUND"
    );
    assert_eq!(
        code(block_on(apple.update_layout(update(
            &template.id,
            1,
            "red"
        )))),
        "NOT_FOUND"
    );
    let ending =
        serde_json::from_value(json!({"id":layout.id,"policy":{"kind":"immediate"}})).unwrap();
    assert_eq!(code(block_on(apple.end_template(ending))), "NOT_FOUND");
    assert_eq!(
        code(block_on(apple.end_layout(end(
            &template.id,
            EndPolicy::Immediate {},
            None
        )))),
        "NOT_FOUND"
    );
}

// TP-ACTION-1, TP-ACTION-3
#[test]
fn a_tap_names_the_action_the_activity_and_its_key() {
    let kit = FakeKit::default();
    assert_eq!(
        action_event(
            &kit.handle("la-ios-layout-1", "mochi:buttons"),
            "pet".into()
        ),
        ActionEvent {
            action_id: "pet".into(),
            activity_id: "la-ios-layout-1".into(),
            activity_key: Some("mochi:buttons".into())
        }
    );
    // activitykit names no key once ActivityKit no longer lists the activity.
    assert_eq!(
        action_event(&kit.handle("gone", ""), "pet".into()).activity_key,
        None
    );
}

// TP-RUST-1
#[test]
fn block_on_drives_a_future_that_another_thread_completes() {
    let (sender, receiver) = activitykit::async_channel::bounded(1);
    let answer = thread::spawn(move || {
        thread::sleep(std::time::Duration::from_millis(20));
        sender.send_blocking(42).unwrap();
    });
    assert_eq!(block_on(async { receiver.recv().await.unwrap() }), 42);
    answer.join().unwrap();
}
