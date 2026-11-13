//! The Android contents of tests/fixtures/android/contents.json through the plugin's own exports. One fixture serves
//! three sides: the TypeScript declarations take each content and declare no member beside theirs
//! (tests/android-contents.test.mjs), the Rust models read each and write it back the same (here), and liveupdate's
//! Android side posts each (NativeBridgeTest.kt, on a device). The models are liveupdate's, which the liveactivity
//! crate re-exports.

use liveactivity::liveupdate::Timer;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use tauri_plugin_live_activity::{
    AndroidContent, AndroidPresentation, BigTextStyle, IconSource, Metric, MetricStyle,
    MetricValue, NotificationAction, PresentationStyle, ProgressPoint, ProgressSegment,
    ProgressStyle, PublicVersion, SamsungNowBar, SemanticStyle, TimerStyle, validate_request,
};

/// The contents of the fixture, each with its name.
fn contents() -> Vec<(String, Value)> {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/android/contents.json")).unwrap();
    cases
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            let name = case["name"].as_str().unwrap().to_owned();
            (name, case["content"].clone())
        })
        .collect()
}

fn read(name: &str, content: &Value) -> AndroidContent {
    serde_json::from_value(content.clone()).unwrap_or_else(|error| panic!("{name}: {error}"))
}

// TP-CONTRACT-8, TP-RUST-2
#[test]
fn every_android_content_of_the_fixture_reads_into_the_models_and_writes_back_the_same() {
    let start = |android: &Value| {
        json!({"activityKey":"mochi:content","schemaVersion":2,"fallback":"notification",
            "layout":{"lockScreen":{"type":"text","bind":"title"}},
            "snapshot":{"revision":0,"values":{"title":"Mochi"},"android":android}})
    };
    let update = |android: &Value| {
        json!({"id":"opaque-handle-1",
            "snapshot":{"revision":1,"values":{"title":"Mochi"},"android":android}})
    };
    for (name, content) in &contents() {
        // What Rust writes is the content of the fixture, member for member: nothing more and nothing less.
        let typed = read(name, content);
        assert_eq!(&serde_json::to_value(&typed).unwrap(), content, "{name}");
        // The contract takes each in a start and in an update. Those that liveupdate's Android side does not post
        // on Android 16 are among them: the fixture names them, and no rule of Rust tells them from the others.
        assert_eq!(
            validate_request("start_layout", start(content)),
            Ok(()),
            "{name}"
        );
        assert_eq!(
            validate_request("update_layout", update(content)),
            Ok(()),
            "{name}"
        );
    }
}

/// The members of a stopwatch and a countdown as liveupdate wrote them up to 0.3.0, in snake case, which its Android
/// side refused. Rust still reads them, and writes them as the Android side reads them. A request is taken as it
/// encodes back, so one in the old names is none.
// TP-CONTRACT-8, TP-RUST-2
#[test]
fn a_running_metric_in_snake_case_reads_into_the_models_and_is_no_request() {
    let metric = |value: Value| {
        json!({"title":"Mochi","status":"Lap 2","presentation":{"style":{"kind":"metric",
            "value":{"metrics":[{"label":"Lap","value":value}]}}}})
    };
    let update = |android: Value| {
        json!({"id":"opaque-handle-1",
            "snapshot":{"revision":1,"values":{"title":"Mochi"},"android":android}})
    };
    for (kind, old, new) in [
        ("stopwatch", "started_at", "startedAt"),
        ("countdown", "ends_at", "endsAt"),
    ] {
        let sent = metric(json!({"kind":kind,"value":{old:1_790_000_000_000_u64}}));
        let written = metric(json!({"kind":kind,"value":{new:1_790_000_000_000_u64}}));
        assert_eq!(serde_json::to_value(read(kind, &sent)).unwrap(), written);
        assert_eq!(
            validate_request("update_layout", update(sent))
                .unwrap_err()
                .code,
            "INVALID_INPUT",
            "{kind}"
        );
        assert_eq!(
            validate_request("update_layout", update(written)),
            Ok(()),
            "{kind}"
        );
    }
}

/// What the contents of the fixture show of the models: each member that may be left out, where a content gives it
/// and where one leaves it out, and each variant of a union.
#[derive(Default)]
struct Held {
    given: BTreeSet<&'static str>,
    left_out: BTreeSet<&'static str>,
    variants: BTreeSet<&'static str>,
}

/// Every pattern names every member, so a member that a later liveupdate adds does not compile here before the
/// fixture has it, and with the fixture the TypeScript declarations and the test on Android. The `Timer` of a timer
/// style is liveupdate's, which is not among the plugin's exports (TP-RUST-2): this file names it through the
/// liveactivity crate.
impl Held {
    fn member(&mut self, name: &'static str, given: bool) {
        let seen = if given {
            &mut self.given
        } else {
            &mut self.left_out
        };
        seen.insert(name);
    }

    fn icon(&mut self, name: &'static str, icon: &Option<IconSource>) {
        self.member(name, icon.is_some());
        self.variants.extend(icon.as_ref().map(|icon| match icon {
            IconSource::Resource(_) => "icon: resource",
            IconSource::AppFile(_) => "icon: appFile",
        }));
    }

    fn semantic(&mut self, name: &'static str, style: &Option<SemanticStyle>) {
        self.member(name, style.is_some());
        self.variants
            .extend(style.as_ref().map(|style| match style {
                SemanticStyle::Unspecified => "semanticStyle: unspecified",
                SemanticStyle::Info => "semanticStyle: info",
                SemanticStyle::Safe => "semanticStyle: safe",
                SemanticStyle::Caution => "semanticStyle: caution",
                SemanticStyle::Danger => "semanticStyle: danger",
            }));
    }

    fn presentation(&mut self, presentation: &AndroidPresentation) {
        let AndroidPresentation {
            style,
            short_critical_text,
            large_icon,
            actions,
            samsung_now_bar,
            chronometer,
            open_url,
            alert,
            public_version,
            small_icon,
            accent_color,
            sub_text,
        } = presentation;
        self.member(
            "presentation.shortCriticalText",
            short_critical_text.is_some(),
        );
        self.icon("presentation.largeIcon", large_icon);
        self.member("presentation.actions", !actions.is_empty());
        for action in actions {
            let NotificationAction {
                id: _,
                title: _,
                icon,
                authentication_required,
                open_url,
            } = action;
            self.icon("action.icon", icon);
            self.member("action.authenticationRequired", *authentication_required);
            self.member("action.openUrl", open_url.is_some());
        }
        self.member("presentation.samsungNowBar", samsung_now_bar.is_some());
        if let Some(SamsungNowBar { primary, secondary }) = samsung_now_bar {
            self.member("samsungNowBar.primary", primary.is_some());
            self.member("samsungNowBar.secondary", secondary.is_some());
        }
        self.member("presentation.chronometer", chronometer.is_some());
        chronometer.iter().for_each(clock);
        self.member("presentation.openUrl", open_url.is_some());
        self.member("presentation.alert", *alert);
        self.member("presentation.publicVersion", public_version.is_some());
        public_version.iter().for_each(locked);
        // A small icon is a resource: liveupdate refuses one from a file.
        self.icon("presentation.smallIcon", small_icon);
        self.member("presentation.accentColor", accent_color.is_some());
        self.member("presentation.subText", sub_text.is_some());
        self.style(style);
    }

    fn style(&mut self, style: &PresentationStyle) {
        match style {
            PresentationStyle::Standard => {
                self.variants.insert("style: standard");
            }
            PresentationStyle::BigText(BigTextStyle { text: _, summary }) => {
                self.variants.insert("style: bigText");
                self.member("bigText.summary", summary.is_some());
            }
            PresentationStyle::Progress(progress) => {
                self.variants.insert("style: progress");
                self.progress(progress);
            }
            PresentationStyle::Timer(timer) => {
                self.variants.insert("style: timer");
                clock(timer);
            }
            PresentationStyle::Metric(MetricStyle {
                metrics,
                critical_metric,
            }) => {
                self.variants.insert("style: metric");
                self.member("metric.criticalMetric", critical_metric.is_some());
                metrics.iter().for_each(|metric| self.metric(metric));
            }
        }
    }

    fn progress(&mut self, progress: &ProgressStyle) {
        let ProgressStyle {
            progress: _,
            indeterminate,
            styled_by_progress,
            segments,
            points,
            start_icon,
            end_icon,
            tracker_icon,
        } = progress;
        self.member("progress.indeterminate", *indeterminate);
        self.member("progress.styledByProgress", *styled_by_progress);
        self.member("progress.points", !points.is_empty());
        self.icon("progress.startIcon", start_icon);
        self.icon("progress.endIcon", end_icon);
        self.icon("progress.trackerIcon", tracker_icon);
        for segment in segments {
            let ProgressSegment {
                length: _,
                id,
                color,
                semantic_style,
            } = segment;
            self.member("segment.id", id.is_some());
            self.member("segment.color", color.is_some());
            self.semantic("segment.semanticStyle", semantic_style);
        }
        for point in points {
            let ProgressPoint {
                position: _,
                id,
                color,
                semantic_style,
            } = point;
            self.member("point.id", id.is_some());
            self.member("point.color", color.is_some());
            self.semantic("point.semanticStyle", semantic_style);
        }
    }

    fn metric(&mut self, metric: &Metric) {
        let Metric {
            label: _,
            value,
            semantic_style,
        } = metric;
        self.semantic("metric.semanticStyle", semantic_style);
        match value {
            MetricValue::Integer { value: _, unit } => {
                self.variants.insert("metric: integer");
                self.member("integer.unit", unit.is_some());
            }
            MetricValue::Decimal { value: _, unit } => {
                self.variants.insert("metric: decimal");
                self.member("decimal.unit", unit.is_some());
            }
            MetricValue::Text(_) => {
                self.variants.insert("metric: text");
            }
            MetricValue::Stopwatch { started_at: _ } => {
                self.variants.insert("metric: stopwatch");
            }
            MetricValue::Countdown { ends_at: _ } => {
                self.variants.insert("metric: countdown");
            }
        }
    }
}

/// The clock of a timer style and of a chronometer, one model for both: it has no member that may be left out.
fn clock(clock: &TimerStyle) {
    let TimerStyle {
        timer: Timer {
            started_at: _,
            ends_at: _,
        },
        counts_down: _,
    } = clock;
}

/// What a locked screen shows in place of a content: it has no member that may be left out either.
fn locked(version: &PublicVersion) {
    let PublicVersion {
        title: _,
        status: _,
    } = version;
}

/// The fixture is as wide as the models: what TypeScript declares and what liveupdate's Android side takes are
/// compared with all that Rust can write, not with a part of it.
// TP-JS-7, TP-ANDROID-14
#[test]
fn the_fixture_holds_every_member_of_the_models_given_and_left_out_and_every_variant() {
    let mut held = Held::default();
    for (name, content) in &contents() {
        let AndroidContent {
            title: _,
            status: _,
            presentation,
        } = read(name, content);
        held.presentation(&presentation);
    }
    // A member that every content gives, or that every content leaves out, stands on one side only.
    assert_eq!(held.given, held.left_out);
    assert_eq!(
        held.variants,
        BTreeSet::from([
            "icon: appFile",
            "icon: resource",
            "metric: countdown",
            "metric: decimal",
            "metric: integer",
            "metric: stopwatch",
            "metric: text",
            "semanticStyle: caution",
            "semanticStyle: danger",
            "semanticStyle: info",
            "semanticStyle: safe",
            "semanticStyle: unspecified",
            "style: bigText",
            "style: metric",
            "style: progress",
            "style: standard",
            "style: timer",
        ])
    );
}
