//! The TypeScript declarations (guest-js/types.ts) against the Rust models, and the error codes against those that the
//! Rust side and the Kotlin backend raise.

use crate::{
    error::ERROR_CODES,
    layout::{ActionEvent, LayoutActivityRecord, LayoutSnapshot, Value},
    models::*,
    pushes::{PushToStartTokenEvent, PushTokenEvent, UpdatedEvent},
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

fn source(path: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap()
}

fn types() -> String {
    source("guest-js/types.ts")
}

/// The string literals of `export type NAME = 'a' | 'b' …;`.
fn union(ts: &str, name: &str) -> BTreeSet<String> {
    let start = ts
        .find(&format!("export type {name} ="))
        .unwrap_or_else(|| panic!("no type {name}"));
    let rest = &ts[start..];
    let body = &rest[..rest.find(';').unwrap()];
    body.split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

/// The members of `export interface NAME { … }`, each with whether it is optional.
fn members(ts: &str, name: &str) -> BTreeMap<String, bool> {
    let start = ts
        .find(&format!("export interface {name} {{"))
        .unwrap_or_else(|| panic!("no interface {name}"));
    let body = &ts[start..];
    let body = &body[body.find('{').unwrap() + 1..body.find("\n}").unwrap()];
    body.lines()
        .filter_map(|line| line.trim().strip_prefix("readonly "))
        .map(|member| {
            let name: String = member
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect();
            let optional = member[name.len()..].starts_with('?');
            (name, optional)
        })
        .collect()
}

/// The members that `full` writes, each optional when `bare` leaves it out.
fn written(full: impl Serialize, bare: impl Serialize) -> BTreeMap<String, bool> {
    let keys = |value: serde_json::Value| -> BTreeSet<String> {
        value.as_object().unwrap().keys().cloned().collect()
    };
    let required = keys(serde_json::to_value(bare).unwrap());
    keys(serde_json::to_value(full).unwrap())
        .into_iter()
        .map(|key| {
            let optional = !required.contains(&key);
            (key, optional)
        })
        .collect()
}

fn names<T: Serialize>(values: &[T]) -> BTreeSet<String> {
    values
        .iter()
        .map(|value| {
            serde_json::to_value(value)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect()
}

/// Every value of each state enum; the matches fail to compile when a variant is added.
fn every_activity_state() -> Vec<ActivityState> {
    use ActivityState::*;
    let all = vec![Pending, Active, Stale, Ended, Dismissed, Unknown];
    for state in &all {
        match state {
            Pending | Active | Stale | Ended | Dismissed | Unknown => {}
        }
    }
    all
}

fn every_permission_state() -> Vec<PermissionState> {
    use PermissionState::*;
    let all = vec![
        Granted,
        Denied,
        Prompt,
        SettingsRequired,
        NotApplicable,
        Unknown,
    ];
    for state in &all {
        match state {
            Granted | Denied | Prompt | SettingsRequired | NotApplicable | Unknown => {}
        }
    }
    all
}

fn every_feature_support() -> Vec<FeatureSupport> {
    use FeatureSupport::*;
    let all = vec![Supported, Unsupported, Unknown];
    for support in &all {
        match support {
            Supported | Unsupported | Unknown => {}
        }
    }
    all
}

fn every_backend() -> Vec<Backend> {
    use Backend::*;
    let all = vec![ActivityKit, AndroidNotification, Unsupported];
    for backend in &all {
        match backend {
            ActivityKit | AndroidNotification | Unsupported => {}
        }
    }
    all
}

fn every_promotion_state() -> Vec<PromotionState> {
    use PromotionState::*;
    let all = vec![Promoted, NotPromoted, Unknown, NotApplicable];
    for state in &all {
        match state {
            Promoted | NotPromoted | Unknown | NotApplicable => {}
        }
    }
    all
}

/// The code literals that `marker`s in the files under `folder` with `suffix` raise, outside of tests.
fn raised(folder: &str, suffix: &str, markers: &[&str]) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut folders = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join(folder)];
    while let Some(folder) = folders.pop() {
        for entry in fs::read_dir(folder).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if path.is_dir() {
                if name != "test" {
                    folders.push(path);
                }
                continue;
            }
            if !name.ends_with(suffix) || name == "tests.rs" || name.ends_with("_tests.rs") {
                continue;
            }
            let text = fs::read_to_string(&path).unwrap();
            let text = text.split("#[cfg(test)]\nmod tests {").next().unwrap();
            for marker in markers {
                for (index, _) in text.match_indices(marker) {
                    // A literal code, also on the next line; a variable is no code of this file.
                    let Some(rest) = text[index + marker.len()..].trim_start().strip_prefix('"')
                    else {
                        continue;
                    };
                    let code: String = rest
                        .chars()
                        .take_while(|c| c.is_ascii_uppercase() || *c == '_')
                        .collect();
                    found.insert(code);
                }
            }
        }
    }
    found
}

// TP-JS-7
#[test]
fn the_error_codes_of_typescript_are_those_that_rust_and_kotlin_raise() {
    let codes: BTreeSet<String> = ERROR_CODES.iter().map(|&code| code.to_owned()).collect();
    assert_eq!(codes.len(), 12);
    assert_eq!(union(&types(), "ErrorCode"), codes);
    let rust = raised("src", ".rs", &["Error::new(", "Self::new(", "code: "]);
    // The plugin's Kotlin and liveupdate's adapter, which the plugin's Android library carries.
    let kotlin = raised(
        "android/src/main",
        ".kt",
        &["ActivityFailure(", "AdapterFailure(", "fail("],
    );
    // The Kotlin side raises the few codes of its own commands; liveupdate's codes come through its Rust.
    for (side, raised, least) in [("Rust", rust, 5), ("Kotlin", kotlin, 3)] {
        assert!(raised.len() >= least, "{side}: {raised:?}");
        let unknown: Vec<_> = raised.difference(&codes).collect();
        assert!(unknown.is_empty(), "{side} raises {unknown:?}");
    }
}

/// What iOS reports with everything there.
fn ios_capabilities() -> Capabilities {
    let support = FeatureSupport::Supported;
    Capabilities {
        platform: "ios".into(),
        backend: Backend::ActivityKit,
        start: support,
        update: support,
        end: support,
        progress: support,
        timer: support,
        actions: support,
        state_observation: support,
        silent_update: support,
        native_live_activity: support,
        max_payload_bytes: 4096,
        layout: support,
        push: support,
    }
}

fn ios_permissions() -> Permissions {
    Permissions {
        notifications: PermissionState::Granted,
        live_activities: PermissionState::Granted,
        promotion: PermissionState::NotApplicable,
        frequent_pushes: PermissionState::Granted,
    }
}

// TP-PUSH-5
#[test]
fn capabilities_and_permissions_read_older_natives_without_pushes() {
    // A native side of 0.5 writes neither member: it has no pushes.
    let mut capabilities = serde_json::to_value(ios_capabilities()).unwrap();
    capabilities.as_object_mut().unwrap().remove("push");
    let read: Capabilities = serde_json::from_value(capabilities).unwrap();
    assert_eq!(read.push, FeatureSupport::Unsupported);
    assert_eq!(read.layout, FeatureSupport::Supported);
    let mut permissions = serde_json::to_value(ios_permissions()).unwrap();
    permissions
        .as_object_mut()
        .unwrap()
        .remove("frequentPushes");
    let read: Permissions = serde_json::from_value(permissions).unwrap();
    assert_eq!(read.frequent_pushes, PermissionState::NotApplicable);
    assert_eq!(read.live_activities, PermissionState::Granted);
}

// TP-JS-7
#[test]
fn the_typescript_records_have_the_members_that_the_rust_models_write() {
    let ts = types();
    let capabilities = ios_capabilities();
    assert_eq!(
        members(&ts, "Capabilities"),
        written(&capabilities, &capabilities)
    );
    let permissions = ios_permissions();
    assert_eq!(
        members(&ts, "Permissions"),
        written(&permissions, &permissions)
    );
    let snapshot = Snapshot {
        revision: 1,
        title: "Title".into(),
        status: "Status".into(),
        progress: Some(0.5),
        timer: None,
        stale_at: Some(5),
    };
    let record = ActivityRecord {
        id: "a".into(),
        activity_key: "k".into(),
        schema_version: 1,
        template: Template::Progress,
        snapshot,
        backend: Backend::ActivityKit,
        state: ActivityState::Active,
        visibility: Visibility::Unknown,
        degraded_features: Vec::new(),
        promotion_requested: false,
        promotion_state: PromotionState::NotApplicable,
    };
    assert_eq!(members(&ts, "ActivityRecord"), written(&record, &record));
    let full = LayoutSnapshot {
        revision: 1,
        values: BTreeMap::from([("status".to_owned(), Value::Text("On time".into()))]),
        stale_at: Some(5),
        timestamp: Some(7),
    };
    let bare = LayoutSnapshot {
        stale_at: None,
        timestamp: None,
        ..full.clone()
    };
    assert_eq!(members(&ts, "LayoutSnapshot"), written(&full, &bare));
    let layout = LayoutActivityRecord {
        id: "a".into(),
        activity_key: "k".into(),
        schema_version: 2,
        snapshot: full,
        backend: Backend::ActivityKit,
        state: ActivityState::Active,
        visibility: Visibility::Unknown,
        degraded_features: Vec::new(),
        promotion_requested: false,
        promotion_state: PromotionState::NotApplicable,
    };
    assert_eq!(
        members(&ts, "LayoutActivityRecord"),
        written(&layout, &layout)
    );
    let tap = ActionEvent {
        action_id: "pet".into(),
        activity_id: "a".into(),
        activity_key: Some("k".into()),
    };
    let unkeyed = ActionEvent {
        activity_key: None,
        ..tap.clone()
    };
    assert_eq!(members(&ts, "ActionEvent"), written(&tap, &unkeyed));
    let token = PushTokenEvent {
        activity_id: "a".into(),
        activity_key: Some("k".into()),
        token: "0a".into(),
    };
    let unkeyed_token = PushTokenEvent {
        activity_key: None,
        ..token.clone()
    };
    assert_eq!(
        members(&ts, "PushTokenEvent"),
        written(&token, &unkeyed_token)
    );
    let start_token = PushToStartTokenEvent { token: "0a".into() };
    assert_eq!(
        members(&ts, "PushToStartTokenEvent"),
        written(&start_token, &start_token)
    );
    let updated = UpdatedEvent { record: layout };
    assert_eq!(members(&ts, "UpdatedEvent"), written(&updated, &updated));
    // The state unions are the values the Rust enums write.
    assert_eq!(union(&ts, "ActivityState"), names(&every_activity_state()));
    assert_eq!(
        union(&ts, "PermissionState"),
        names(&every_permission_state())
    );
    assert_eq!(
        union(&ts, "FeatureSupport"),
        names(&every_feature_support())
    );
    assert_eq!(union(&ts, "Backend"), names(&every_backend()));
    assert_eq!(
        union(&ts, "PromotionState"),
        names(&every_promotion_state())
    );
}
