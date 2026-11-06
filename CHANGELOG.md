# Changelog

## Unreleased

- Add request contract v2: a layout tree of nodes, a style table and a map of values, with a weight limit of 3584 checked the same way in every layer. The layout is fixed at start and updates send values only. Contract v1 is unchanged, and the two versions do not see each other's activities.
- Add the `start_layout`, `update_layout`, `end_layout` and `list_layout` commands, their JavaScript functions and Rust methods, node builders under `layout`, and `allow-`/`deny-` permissions. `live-activity:default` now also allows `list_layout`.
- Deliver taps on layout buttons to Rust `on_action` handlers and then to `onAction` listeners through the `live-activity://action` event. `getCapabilities()` reports `actions` as supported on iOS 17+ and Android, and adds `layout`.
- Draw layouts on iOS with the new `LiveActivityUI` package product and the `LiveActivityLayoutWidget` widget in the template. Buttons need `templates/ios/LiveActivityActionIntent.swift` in both the widget extension and the app target, and the extension's Info.plist needs `TauriLiveActivityLayout` = `2`.
- Show layouts on Android as notifications: title, body, progress bar, chronometer and up to three actions. Everything else is listed in `degradedFeatures`. `android.visibility` sets the lock screen visibility.
- Add the optional plugin configuration: `receipts` (`full` or `redacted`) chooses what iOS receipts keep, and `android.samsungNowBar` adds One UI's Now Bar text extras to layout notifications on Android 17+. Neither puts an app on Samsung's Now Bar allow list.
- Move iOS receipts to `receipts-v2.json`, which holds both contract versions; the earlier `receipts-v1.json` is converted and deleted on first load.
- Enable serde_json's `float_roundtrip` feature, so Rust reads a number as JavaScript wrote it. Cargo turns it on for every crate in the app's build that uses serde_json.

## 0.1.0-alpha.4

- Add npm search keywords and crates.io keywords/categories for Tauri, Live Activities, ActivityKit and Android notifications.
- Add a guarded GitHub Actions release workflow for npm and crates.io.
- Native behavior and the public API are unchanged from alpha.3.

## 0.1.0-alpha.3

- Require Android 8.0 / API 26 in the plugin and demo manifests. The previous API 24 minimum allowed installation on a version where Tauri's Jackson dependency crashes during startup.
- Document OS feature floors, build requirements, desktop limitations and actual boundary-test results separately.
- Refine Mochi's ears and face, using the same silhouette in the app and iOS widget.
- Make Android permission-dialog tests work across API 33 and 37 and native tests run on API 26.

## 0.1.0-alpha.2

- Rename the npm package to `tauri-plugin-live-activity`, matching the crate name.
- Replace the demo with Mochi's snack delivery and nap timer, including a custom iOS widget.
- Keep Android permission requests retryable after the system dialog is cancelled.
- Check notification channel importance before requesting Live Update promotion and report rejected promotion as a degraded feature.
- Reject conflicting iOS updates whose text differs only in Unicode encoding.
- Require iPadOS 17 for iPad and exclude iOS app compatibility mode on Mac.
- Add native permission, timer and lifecycle tests, registry-backed Tauri consumers, and Windows/Linux IPC checks.

## 0.1.0-alpha.1

- Start, update, end and reconcile local progress/timer activities from Tauri 2.
- iOS ActivityKit backend and shared Widget Extension template.
- Android ongoing notifications with explicit fallback and Live Update promotion checks.
- Typed JavaScript API, read-only default Tauri permissions and strict request validation.
- Runnable mobile demo and native lifecycle tests.

Desktop backends, push updates and event subscriptions are not included.
