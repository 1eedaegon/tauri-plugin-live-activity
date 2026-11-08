//! Button taps of the demo's layout examples. They are handled in Rust, where they also arrive
//! while the web view is suspended or was never created.

use tauri::{App, AppHandle, Runtime};
use tauri_plugin_live_activity::{
    ActionEvent, ActivityState, EndPolicy, LayoutActivityRecord, LayoutEndInput, LayoutSnapshot,
    LayoutUpdateInput, LiveActivityExt, Value,
};

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
            Some(Reply::Update(input)) => plugin.update_layout(input).map(drop),
            Some(Reply::End(input)) => plugin.end_layout(input).map(drop),
            None => Ok(()),
        }
    });
    if let Err(error) = result {
        eprintln!("Mochi demo: the tap {:?} failed: {error}", event.action_id);
    }
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
}
