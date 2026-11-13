//! The TypeScript declarations (guest-js/types.ts) against the Rust models, which are the liveactivity crate's, and
//! the error codes against those of the contract and those that the Kotlin side raises.

use crate::{
    ActionEvent, ActivityRecord, ActivityState, AndroidContent, AndroidOptions, AndroidPlacement,
    AndroidPresentation, AndroidVisibility, Backend, Capabilities, ERROR_CODES, FeatureSupport,
    LayoutActivityRecord, LayoutSnapshot, OpenedEvent, PermissionState, Permissions,
    PresentationCapabilities, PresentationStyle, PromotionState, PublicVersion,
    PushToStartTokenEvent, PushTokenEvent, SemanticStyle, Snapshot, StartedEvent, StateEvent,
    Template, UpdatedEvent, Value, Visibility,
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

/// The string literals of `'a' | 'b' …`.
fn literals(written: &str) -> BTreeSet<String> {
    written
        .split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

/// The string literals of `export type NAME = 'a' | 'b' …;`.
fn union(ts: &str, name: &str) -> BTreeSet<String> {
    let start = ts
        .find(&format!("export type {name} ="))
        .unwrap_or_else(|| panic!("no type {name}"));
    let rest = &ts[start..];
    literals(&rest[..rest.find(';').unwrap()])
}

/// What stands between the braces of `export interface NAME { … }`.
fn interface<'a>(ts: &'a str, name: &str) -> &'a str {
    let start = ts
        .find(&format!("export interface {name} {{"))
        .unwrap_or_else(|| panic!("no interface {name}"));
    let body = &ts[start..];
    &body[body.find('{').unwrap() + 1..body.find("\n}").unwrap()]
}

/// The members of `export interface NAME { … }`, each with whether it is optional.
fn members(ts: &str, name: &str) -> BTreeMap<String, bool> {
    interface(ts, name)
        .lines()
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

/// What `export interface NAME { … }` declares its member `member` to be, as it is written.
fn declared(ts: &str, name: &str, member: &str) -> String {
    let prefix = format!("readonly {member}");
    interface(ts, name)
        .lines()
        .filter_map(|line| line.trim().strip_prefix(prefix.as_str()))
        .find_map(|rest| rest.trim_start_matches('?').strip_prefix(": "))
        .unwrap_or_else(|| panic!("{name} has no {member}"))
        .trim_end_matches(';')
        .to_owned()
}

/// The member of the union `export type NAME = | {…} | {…};` whose `kind` is `kind`, as it is written.
fn variant(ts: &str, name: &str, kind: &str) -> String {
    let start = ts
        .find(&format!("export type {name} ="))
        .unwrap_or_else(|| panic!("no type {name}"));
    let body = &ts[start..];
    let body = &body[..body.find("\n\n").unwrap_or(body.len())];
    body.lines()
        .find(|line| line.contains(&format!("kind: '{kind}'")))
        .unwrap_or_else(|| panic!("{name} has no {kind}"))
        .to_owned()
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

/// The values of each state enum that liveactivity 0.5 writes. The enums may grow, so a new value shows here as a
/// union of TypeScript that lacks it only once it is listed: the fixtures of each release are the reminder.
fn every_activity_state() -> Vec<ActivityState> {
    use ActivityState::*;
    vec![Pending, Active, Stale, Ended, Dismissed, Unknown]
}

fn every_permission_state() -> Vec<PermissionState> {
    use PermissionState::*;
    vec![
        Granted,
        Denied,
        Prompt,
        SettingsRequired,
        NotApplicable,
        Unknown,
    ]
}

fn every_feature_support() -> Vec<FeatureSupport> {
    use FeatureSupport::*;
    vec![Supported, Unsupported, Unknown]
}

fn every_backend() -> Vec<Backend> {
    use Backend::*;
    vec![ActivityKit, AndroidNotification, Unsupported]
}

fn every_promotion_state() -> Vec<PromotionState> {
    use PromotionState::*;
    vec![Promoted, NotPromoted, Unknown, NotApplicable]
}

/// liveupdate's, for the segments, points and metrics of an Android content.
fn every_semantic_style() -> Vec<SemanticStyle> {
    use SemanticStyle::*;
    vec![Unspecified, Info, Safe, Caution, Danger]
}

/// The lock screen visibilities and the placements of a start on Android.
fn every_android_visibility() -> Vec<AndroidVisibility> {
    use AndroidVisibility::*;
    vec![Public, Private, Secret]
}

fn every_android_placement() -> Vec<AndroidPlacement> {
    use AndroidPlacement::*;
    vec![Tagged, Foreground]
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
    // The Rust codes are liveactivity's `ERROR_CODES`, above. The plugin's Kotlin and liveupdate's adapter, which the
    // plugin's Android library carries, raise the few codes of their own commands.
    let kotlin = raised(
        "android/src/main",
        ".kt",
        &["ActivityFailure(", "AdapterFailure(", "fail("],
    );
    assert!(kotlin.len() >= 3, "Kotlin: {kotlin:?}");
    let unknown: Vec<_> = kotlin.difference(&codes).collect();
    assert!(unknown.is_empty(), "Kotlin raises {unknown:?}");
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
        android_presentation: None,
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

// TP-JS-7
#[test]
fn the_typescript_timer_style_is_what_rust_reads_and_writes() {
    let ts = types();
    // A timer style of an Android content, as TypeScript declares it and JavaScript sends it.
    let sent = serde_json::json!({"kind":"timer",
        "value":{"timer":{"startedAt":1000,"endsAt":2000},"countsDown":true}});
    let style: PresentationStyle = serde_json::from_value(sent.clone()).unwrap();
    assert_eq!(serde_json::to_value(&style).unwrap(), sent);
    // The style and the chronometer of a presentation are one model of Rust, and one declaration of TypeScript.
    let PresentationStyle::Timer(clock) = style else {
        panic!("{sent} is no timer style");
    };
    let beside = AndroidPresentation {
        chronometer: Some(clock.clone()),
        ..AndroidPresentation::new(PresentationStyle::Standard)
    };
    assert_eq!(
        serde_json::to_value(&beside).unwrap()["chronometer"],
        sent["value"]
    );
    let timer_variant = variant(&ts, "AndroidStyle", "timer");
    assert!(
        timer_variant.contains("readonly value: AndroidTimerStyle }"),
        "{timer_variant}"
    );
    assert_eq!(
        declared(&ts, "AndroidPresentation", "chronometer"),
        "AndroidTimerStyle"
    );
    assert_eq!(members(&ts, "AndroidTimerStyle"), written(&clock, &clock));
    // The style holds liveupdate's `Timer`, which the plugin does not re-export. TypeScript declares it as its one
    // `Timer`, the template's, whose members are those that liveupdate's writes.
    assert_eq!(declared(&ts, "AndroidTimerStyle", "timer"), "Timer");
    let timer = &sent["value"]["timer"];
    assert_eq!(members(&ts, "Timer"), written(timer, timer));
}

// TP-JS-7
#[test]
fn the_typescript_options_of_a_start_on_android_are_what_rust_reads_and_writes() {
    let ts = types();
    let version = PublicVersion {
        title: "Mochi".into(),
        status: "An appointment".into(),
    };
    assert_eq!(
        members(&ts, "AndroidPublicVersion"),
        written(&version, &version)
    );
    // One declaration for what a locked screen shows, in the options of a start and in a content.
    for holder in ["LayoutAndroidOptions", "AndroidPresentation"] {
        assert_eq!(
            declared(&ts, holder, "publicVersion"),
            "AndroidPublicVersion",
            "{holder}"
        );
    }
    let bare = AndroidOptions::new(AndroidVisibility::Private);
    let mut full = bare.clone();
    full.public_version = Some(version);
    full.placement = Some(AndroidPlacement::Foreground);
    assert_eq!(members(&ts, "LayoutAndroidOptions"), written(&full, &bare));
    assert_eq!(
        literals(&declared(&ts, "LayoutAndroidOptions", "visibility")),
        names(&every_android_visibility())
    );
    assert_eq!(
        literals(&declared(&ts, "LayoutAndroidOptions", "placement")),
        names(&every_android_placement())
    );
}

// TP-JS-7
#[test]
fn the_typescript_records_have_the_members_that_the_rust_models_write() {
    let ts = types();
    let capabilities = ios_capabilities();
    // Android writes which styles the device draws; iOS leaves the member out.
    let android = Capabilities {
        android_presentation: Some(PresentationCapabilities::default()),
        ..capabilities.clone()
    };
    assert_eq!(
        members(&ts, "Capabilities"),
        written(&android, &capabilities)
    );
    let styles = PresentationCapabilities::default();
    assert_eq!(
        members(&ts, "AndroidPresentationSupport"),
        written(styles, styles)
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
    let values = BTreeMap::from([("status".to_owned(), Value::Text("On time".into()))]);
    let bare = LayoutSnapshot::new(1, values);
    let content = AndroidContent {
        title: "On time".into(),
        status: "Gate 4".into(),
        presentation: AndroidPresentation::new(PresentationStyle::Standard),
    };
    let full = LayoutSnapshot {
        stale_at: Some(5),
        timestamp: Some(7),
        relevance: Some(80.0),
        android: Some(content.clone()),
        ..bare.clone()
    };
    assert_eq!(members(&ts, "LayoutSnapshot"), written(&full, &bare));
    assert_eq!(members(&ts, "AndroidContent"), written(&content, &content));
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
    // A tap on a toggle says which state the person asked for; a tap on a button says none.
    let tap = ActionEvent {
        action_id: "pet".into(),
        activity_id: "a".into(),
        activity_key: Some("k".into()),
        on: Some(true),
    };
    let unkeyed = ActionEvent {
        activity_key: None,
        on: None,
        ..tap.clone()
    };
    assert_eq!(members(&ts, "ActionEvent"), written(&tap, &unkeyed));
    // An opening by an action names it; one by the notification itself names none.
    let opened = OpenedEvent {
        activity_id: "a".into(),
        activity_key: Some("k".into()),
        action_id: Some("map".into()),
    };
    let unkeyed_opening = OpenedEvent {
        activity_key: None,
        action_id: None,
        ..opened.clone()
    };
    assert_eq!(
        members(&ts, "OpenedEvent"),
        written(&opened, &unkeyed_opening)
    );
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
    let updated = UpdatedEvent {
        record: layout.clone(),
    };
    assert_eq!(members(&ts, "UpdatedEvent"), written(&updated, &updated));
    let started = StartedEvent { record: layout };
    assert_eq!(members(&ts, "StartedEvent"), written(&started, &started));
    let state = StateEvent {
        activity_id: "a".into(),
        activity_key: Some("k".into()),
        state: ActivityState::Dismissed,
    };
    let unkeyed_state = StateEvent {
        activity_key: None,
        ..state.clone()
    };
    assert_eq!(members(&ts, "StateEvent"), written(&state, &unkeyed_state));
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
    // The members and the variants of an Android content are compared through a fixture (TP-ANDROID-14); its
    // semantic styles are values, which are compared here.
    assert_eq!(
        union(&ts, "AndroidSemanticStyle"),
        names(&every_semantic_style())
    );
}
