//! Taps on the buttons and the switch of the demo's layout examples. They are handled in Rust, where they also
//! arrive while the web view is suspended or was never created.

use std::{
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{App, AppHandle, Runtime};
use tauri_plugin_live_activity::{
    ActionEvent, ActivityState, EndPolicy, LayoutActivityRecord, LayoutEndInput, LayoutSnapshot,
    LayoutStartInput, LayoutUpdateInput, LiveActivityExt, Value,
};

/// How long the demo takes to count a pet. A tap's intent, and so an app that the system launched for the tap, waits
/// until the handler has run, so the update still reaches the Lock Screen after a pause like this one.
pub const COUNTING: Duration = Duration::from_secs(1);

/// What a tap asks of the activity that showed the button.
#[derive(Debug, PartialEq)]
pub enum Reply {
    Update(LayoutUpdateInput),
    End(LayoutEndInput),
}

/// Handles taps from now on. Call it on the built app before `run`: when the system launches the
/// app for a tap, Tauri may never run `setup`.
pub fn register<R: Runtime>(app: &App<R>) {
    let handle = app.handle().clone();
    app.live_activity()
        .on_action(move |event| handle_tap(&handle, &event));
}

fn handle_tap<R: Runtime>(app: &AppHandle<R>, event: &ActionEvent) {
    let plugin = app.live_activity();
    let result = plugin.list_layout().and_then(|records| {
        let Some(record) = records.iter().find(|record| record.id == event.activity_id) else {
            return Ok(());
        };
        match reply(&event.action_id, event.on, record) {
            Some(Reply::Update(input)) => {
                thread::sleep(COUNTING);
                plugin.update_layout(input).map(drop)
            }
            Some(Reply::End(input)) => plugin.end_layout(input).map(drop),
            None => Ok(()),
        }
    });
    if let Err(error) = result {
        eprintln!("Mochi demo: the tap {:?} failed: {error}", event.action_id);
    }
}

/// The launch argument that starts the Buttons example from Rust: the UI tests use it in a build of `tauri ios dev`,
/// whose page comes from a server that the test may not reach.
pub const START_BUTTONS: &str = "--start-buttons";

/// The Buttons example of the Layouts tab, as Rust starts it.
pub fn buttons_start() -> LayoutStartInput {
    let request = serde_json::json!({
        "activityKey": "mochi:buttons", "schemaVersion": 2, "fallback": "notification",
        "layout": { "lockScreen": { "type": "vstack", "alignment": "leading", "spacing": 8, "style": "card", "children": [
            { "type": "hstack", "spacing": 8, "children": [
                { "type": "symbol", "name": "cat.fill", "style": "icon" },
                { "type": "text", "bind": "title", "style": "title" }] },
            { "type": "text", "bind": "status" },
            { "type": "hstack", "spacing": 8, "children": [
                { "type": "button", "actionId": "pet", "child": { "type": "text", "value": "Pet Mochi" }, "style": "action" },
                { "type": "button", "actionId": "done", "child": { "type": "text", "value": "All done" }, "style": "quiet" }] }] } },
        "styles": {
            "card": { "padding": 16 },
            "title": { "font": "headline" },
            "icon": { "size": 20, "color": "orange" },
            "action": { "buttonStyle": "borderedProminent", "tint": "orange" },
            "quiet": { "buttonStyle": "bordered", "tint": "teal" }
        },
        "snapshot": { "revision": 0, "values": { "title": "Mochi wants attention", "status": "No pets yet", "pets": 0 } }
    });
    serde_json::from_value(request).expect("the Buttons example reads as a start")
}

/// The launch argument that starts the Scheduled start example from Rust: a phone at hand has no UI test that
/// presses the page's button, and the app is ended before the activity's time.
pub const START_LATER: &str = "--start-later";

/// How far ahead the Scheduled start example begins, as on the page (`startsIn` in `src/layouts.ts`).
pub const STARTS_IN: Duration = Duration::from_secs(30);

/// The Scheduled start example of the Layouts tab, as Rust starts it, to begin [`STARTS_IN`] after `now`.
pub fn later_start(now: SystemTime) -> LayoutStartInput {
    let at = now
        .checked_add(STARTS_IN)
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        });
    let request = serde_json::json!({
        "activityKey": "mochi:later", "schemaVersion": 2, "fallback": "notification",
        "layout": { "lockScreen": { "type": "vstack", "alignment": "leading", "spacing": 6, "style": "card", "children": [
            { "type": "hstack", "spacing": 8, "children": [
                { "type": "symbol", "name": "bell.fill", "style": "icon" },
                { "type": "text", "bind": "title", "style": "title" }] },
            { "type": "text", "bind": "status" }] } },
        "styles": {
            "card": { "padding": 16 },
            "title": { "font": "headline" },
            "icon": { "size": 20, "color": "orange" }
        },
        "snapshot": { "revision": 0, "values": { "title": "Mochi’s dinner bell", "status": "Dinner is served" } },
        "scheduled": { "at": at, "alert": { "title": "Dinner time", "body": "Mochi’s bowl is full." } }
    });
    serde_json::from_value(request).expect("the Scheduled start example reads as a start")
}

/// Starts from Rust the examples that `args` name, [`START_BUTTONS`] and [`START_LATER`], on a thread of its own: the
/// plugin's calls block until iOS answers from the main thread.
pub fn start_from_rust_if_asked<R: Runtime>(app: &App<R>, args: impl Iterator<Item = String>) {
    let starts: Vec<_> = args
        .filter_map(|argument| match argument.as_str() {
            START_BUTTONS => Some(buttons_start()),
            START_LATER => Some(later_start(SystemTime::now())),
            _ => None,
        })
        .collect();
    if starts.is_empty() {
        return;
    }
    let handle = app.handle().clone();
    thread::spawn(move || {
        for start in starts {
            let key = start.activity_key.clone();
            if let Err(error) = handle.live_activity().start_layout(start) {
                eprintln!("Mochi demo: {key} did not start: {error}");
            }
        }
    });
}

/// The reply to `action_id` on `record`, or `None` for a tap the demo does not handle. `on` is the state a tap on a
/// switch asked for.
pub fn reply(action_id: &str, on: Option<bool>, record: &LayoutActivityRecord) -> Option<Reply> {
    let ended = matches!(
        record.state,
        ActivityState::Ended | ActivityState::Dismissed
    );
    if ended || !record.activity_key.starts_with("mochi:") {
        return None;
    }
    let id = record.id.clone();
    match action_id {
        "pet" => petted(&record.snapshot)
            .map(|snapshot| Reply::Update(LayoutUpdateInput::new(id, snapshot))),
        // The tap moves nothing: the switch shows the flag, so the update that sets it is what turns it.
        "purr" => on
            .and_then(|on| purring(&record.snapshot, on))
            .map(|snapshot| Reply::Update(LayoutUpdateInput::new(id, snapshot))),
        "done" | "wake" => Some(Reply::End(LayoutEndInput {
            id,
            policy: EndPolicy::Immediate {},
            snapshot: None,
        })),
        _ => None,
    }
}

/// The snapshot after one more pet: the count and the status line, at the next revision.
fn petted(snapshot: &LayoutSnapshot) -> Option<LayoutSnapshot> {
    let (Some(Value::Number(pets)), Some(Value::Text(_))) =
        (snapshot.values.get("pets"), snapshot.values.get("status"))
    else {
        return None;
    };
    let count = pets + 1.0;
    let status = if count == 1.0 {
        "Purring. 1 pet so far".to_string()
    } else {
        format!("Purring. {count} pets so far")
    };
    Some(with(
        snapshot,
        &[
            ("pets", Value::Number(count)),
            ("status", Value::Text(status)),
        ],
    ))
}

/// The status lines of the Switch example, as the page starts it (`src/layouts.ts`).
pub const PURRING: &str = "Purring out loud";
pub const QUIET: &str = "Quiet as a mouse";

/// The snapshot with the switch's flag as the person asked for it, and the status line that says so.
fn purring(snapshot: &LayoutSnapshot, on: bool) -> Option<LayoutSnapshot> {
    let (Some(Value::Bool(_)), Some(Value::Text(_))) = (
        snapshot.values.get("purring"),
        snapshot.values.get("status"),
    ) else {
        return None;
    };
    let status = if on { PURRING } else { QUIET };
    Some(with(
        snapshot,
        &[
            ("purring", Value::Bool(on)),
            ("status", Value::Text(status.into())),
        ],
    ))
}

/// `snapshot` at the next revision with `changed` in place of the values of those keys, and every other key kept.
fn with(snapshot: &LayoutSnapshot, changed: &[(&str, Value)]) -> LayoutSnapshot {
    let values = snapshot
        .values
        .iter()
        .map(|(key, value)| {
            let value = changed
                .iter()
                .find(|(name, _)| name == key)
                .map_or(value, |(_, value)| value);
            (key.clone(), value.clone())
        })
        .collect();
    LayoutSnapshot {
        stale_at: snapshot.stale_at,
        ..LayoutSnapshot::new(snapshot.revision + 1, values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value as Json, json};
    use tauri_plugin_live_activity::{EndPolicy, LayoutSnapshot, Value};

    fn record(key: &str, state: &str, values: Json) -> LayoutActivityRecord {
        serde_json::from_value(json!({
            "id": "handle-1", "activityKey": key, "schemaVersion": 2,
            "snapshot": { "revision": 4, "values": values },
            "backend": "activityKit", "state": state, "visibility": "unknown", "degradedFeatures": [],
            "promotionRequested": false, "promotionState": "notApplicable"
        }))
        .unwrap()
    }

    fn buttons(pets: f64) -> LayoutActivityRecord {
        record(
            "mochi:buttons",
            "active",
            json!({ "title": "Mochi wants attention", "status": "No pets yet", "pets": pets }),
        )
    }

    fn updated(reply: Option<Reply>) -> LayoutSnapshot {
        match reply {
            Some(Reply::Update(input)) => {
                assert_eq!(input.id, "handle-1");
                input.snapshot
            }
            other => panic!("expected an update, got {other:?}"),
        }
    }

    #[test]
    fn a_pet_counts_up_at_the_next_revision_and_keeps_every_key() {
        let before = buttons(0.0);
        let first = updated(reply("pet", None, &before));
        assert_eq!(first.revision, 5);
        assert_eq!(first.values["pets"], Value::Number(1.0));
        assert_eq!(
            first.values["status"],
            Value::Text("Purring. 1 pet so far".into())
        );
        assert_eq!(first.values["title"], before.snapshot.values["title"]);
        assert_eq!(
            first.values.keys().collect::<Vec<_>>(),
            before.snapshot.values.keys().collect::<Vec<_>>()
        );
        assert_eq!(before.snapshot.values["pets"], Value::Number(0.0));
        let third = updated(reply("pet", None, &buttons(2.0)));
        assert_eq!(
            third.values["status"],
            Value::Text("Purring. 3 pets so far".into())
        );
    }

    // TP-E2E-7
    #[test]
    fn a_tap_on_the_switch_sets_the_flag_the_person_asked_for() {
        let switch = |purring: bool| {
            record(
                "mochi:switch",
                "active",
                json!({ "title": "Mochi’s purr alerts", "status": QUIET, "purring": purring }),
            )
        };
        let on = updated(reply("purr", Some(true), &switch(false)));
        assert_eq!(on.revision, 5);
        assert_eq!(on.values["purring"], Value::Bool(true));
        assert_eq!(on.values["status"], Value::Text(PURRING.into()));
        assert_eq!(
            on.values["title"],
            Value::Text("Mochi’s purr alerts".into())
        );
        let off = updated(reply("purr", Some(false), &switch(true)));
        assert_eq!(off.values["purring"], Value::Bool(false));
        assert_eq!(off.values["status"], Value::Text(QUIET.into()));
        // What the person asked for is set, also when the flag already says so: a tap may come twice.
        let again = updated(reply("purr", Some(true), &switch(true)));
        assert_eq!(again.values["purring"], Value::Bool(true));
        // A tap that says no state is no switch's, and values of other types are not the example's.
        assert_eq!(reply("purr", None, &switch(false)), None);
        let wrong_types = record(
            "mochi:switch",
            "active",
            json!({ "status": "x", "purring": "no" }),
        );
        assert_eq!(reply("purr", Some(true), &wrong_types), None);
    }

    #[test]
    fn done_and_wake_end_the_activity_at_once() {
        for action in ["done", "wake"] {
            assert_eq!(
                reply(action, None, &buttons(1.0)),
                Some(Reply::End(LayoutEndInput {
                    id: "handle-1".into(),
                    policy: EndPolicy::Immediate {},
                    snapshot: None,
                }))
            );
        }
    }

    #[test]
    fn other_taps_and_other_activities_are_left_alone() {
        assert_eq!(reply("feed", None, &buttons(1.0)), None);
        let android = record(
            "mochi:android",
            "active",
            json!({ "title": "Nap", "status": "Dozing", "sleep": 0.2 }),
        );
        assert_eq!(reply("pet", None, &android), None);
        let wrong_types = record(
            "mochi:buttons",
            "active",
            json!({ "status": 1, "pets": "1" }),
        );
        assert_eq!(reply("pet", None, &wrong_types), None);
        let other = record(
            "someone:buttons",
            "active",
            json!({ "status": "x", "pets": 1 }),
        );
        assert_eq!(reply("pet", None, &other), None);
        assert_eq!(reply("done", None, &other), None);
        for state in ["ended", "dismissed"] {
            assert_eq!(
                reply("done", None, &record("mochi:buttons", state, json!({}))),
                None
            );
        }
    }

    #[test]
    fn the_buttons_example_that_rust_starts_is_valid_and_answers_a_pet() {
        use tauri_plugin_live_activity::Validate;
        let start = buttons_start();
        assert_eq!(start.validate(), Ok(()));
        let record = record(
            "mochi:buttons",
            "active",
            serde_json::to_value(&start.snapshot.values).unwrap(),
        );
        let first = updated(reply("pet", None, &record));
        assert_eq!(
            first.values["status"],
            Value::Text("Purring. 1 pet so far".into())
        );
        assert_eq!(START_BUTTONS, "--start-buttons");
    }

    #[test]
    fn the_scheduled_start_that_rust_starts_is_valid_and_begins_half_a_minute_later() {
        use tauri_plugin_live_activity::Validate;
        let now = UNIX_EPOCH + Duration::from_millis(1_900_000_000_000);
        let start = later_start(now);
        assert_eq!(start.validate(), Ok(()));
        assert_eq!(start.activity_key, "mochi:later");
        let scheduled = start.scheduled.expect("the start is scheduled");
        assert_eq!(scheduled.at, 1_900_000_030_000);
        assert_eq!(scheduled.alert.title, "Dinner time");
        assert_eq!(START_LATER, "--start-later");
        assert_eq!(STARTS_IN, Duration::from_secs(30));
    }
}
