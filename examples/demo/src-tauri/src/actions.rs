//! Button taps of the demo's layout examples. They are handled in Rust, where they also arrive
//! while the web view is suspended or was never created.

use std::{thread, time::Duration};
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
        match reply(&event.action_id, record) {
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

/// Starts the Buttons example from Rust when `args` hold [`START_BUTTONS`], on a thread of its own: the plugin's calls
/// block until iOS answers from the main thread.
pub fn start_from_rust_if_asked<R: Runtime>(app: &App<R>, mut args: impl Iterator<Item = String>) {
    if !args.any(|arg| arg == START_BUTTONS) {
        return;
    }
    let handle = app.handle().clone();
    thread::spawn(move || {
        if let Err(error) = handle.live_activity().start_layout(buttons_start()) {
            eprintln!("Mochi demo: the Buttons example did not start: {error}");
        }
    });
}

/// The reply to `action_id` on `record`, or `None` for a tap the demo does not handle.
pub fn reply(action_id: &str, record: &LayoutActivityRecord) -> Option<Reply> {
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
            .map(|snapshot| Reply::Update(LayoutUpdateInput { id, snapshot })),
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
    let values = snapshot
        .values
        .iter()
        .map(|(key, value)| {
            let value = match key.as_str() {
                "pets" => Value::Number(count),
                "status" => Value::Text(status.clone()),
                _ => value.clone(),
            };
            (key.clone(), value)
        })
        .collect();
    Some(LayoutSnapshot {
        revision: snapshot.revision + 1,
        values,
        stale_at: snapshot.stale_at,
        timestamp: None,
    })
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
        let first = updated(reply("pet", &before));
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
        let third = updated(reply("pet", &buttons(2.0)));
        assert_eq!(
            third.values["status"],
            Value::Text("Purring. 3 pets so far".into())
        );
    }

    #[test]
    fn done_and_wake_end_the_activity_at_once() {
        for action in ["done", "wake"] {
            assert_eq!(
                reply(action, &buttons(1.0)),
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
        assert_eq!(reply("feed", &buttons(1.0)), None);
        let android = record(
            "mochi:android",
            "active",
            json!({ "title": "Nap", "status": "Dozing", "sleep": 0.2 }),
        );
        assert_eq!(reply("pet", &android), None);
        let wrong_types = record(
            "mochi:buttons",
            "active",
            json!({ "status": 1, "pets": "1" }),
        );
        assert_eq!(reply("pet", &wrong_types), None);
        let other = record(
            "someone:buttons",
            "active",
            json!({ "status": "x", "pets": 1 }),
        );
        assert_eq!(reply("pet", &other), None);
        assert_eq!(reply("done", &other), None);
        for state in ["ended", "dismissed"] {
            assert_eq!(
                reply("done", &record("mochi:buttons", state, json!({}))),
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
        let first = updated(reply("pet", &record));
        assert_eq!(
            first.values["status"],
            Value::Text("Purring. 1 pet so far".into())
        );
        assert_eq!(START_BUTTONS, "--start-buttons");
    }
}
