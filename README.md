# tauri-plugin-live-activity

[![npm](https://img.shields.io/npm/v/tauri-plugin-live-activity/next)](https://www.npmjs.com/package/tauri-plugin-live-activity)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-live-activity)](https://crates.io/crates/tauri-plugin-live-activity)
[![CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

A Tauri 2 plugin for iOS Live Activities (ActivityKit and Dynamic Island) and Android Live Updates, with an ongoing notification fallback.
Community plugin. **Early alpha.** [한국어](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/README.ko.md)

| Platform | Backend |
| --- | --- |
| iOS 16.1+ / iPadOS 17+ | ActivityKit · Lock Screen and Dynamic Island where available |
| Android API 26+ | Ongoing notifications · Live Update promotion on eligible API 36+ devices |
| macOS / Windows / Linux | Not implemented |

<table>
  <tr><th>Mochi demo</th><th>iOS Live Activities</th><th>Android Live Update</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-demo.png" width="240" alt="Mochi's snack delivery in the Tauri demo app"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-ios-live-activity.png" width="240" alt="Mochi's snack delivery and nap timer on the iPhone Lock Screen"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-android-live-activity.png" width="240" alt="Mochi's snack delivery shown by Android's native notification UI"></td>
  </tr>
</table>

Actual captures from iOS 27.2 Simulator and an Android API 37 emulator.
The demo follows a cat's snack delivery and nap timer, using state supplied by the app.
The iOS demo also includes an [expanded Dynamic Island view](https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-ios-dynamic-island.png).
On older Android versions, the same example uses an
[ongoing notification](https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-android-notification-fallback.png).

## Install

Requires Tauri 2 and Rust 1.90+.
Android requires API 26+, an updated WebView, and Android SDK 37 to build.
See the [version policy](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/compatibility.md) for feature and toolchain requirements.

```sh
npm install tauri-plugin-live-activity@next
```

`src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-live-activity = "=0.1.0-alpha.4"
```

Register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
    // ...
```

Add these permissions to your capability file:

```json
"permissions": [
  "live-activity:default",
  "live-activity:allow-request-permissions",
  "live-activity:allow-start",
  "live-activity:allow-update",
  "live-activity:allow-end"
]
```

**iOS needs a Widget Extension.** Follow the [iOS setup](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-integration.md).
For Android permission and channel behavior, see [Android setup](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md).

## Example: snacks for Mochi

```ts
import {
  getCapabilities, requestPermissions, start, update, end,
} from 'tauri-plugin-live-activity';

const { platform } = await getCapabilities();
await requestPermissions(platform === 'android' ? 'notifications' : 'liveActivities');

const snack = await start({
  activityKey: 'mochi:snack',
  schemaVersion: 1,
  template: 'progress',
  fallback: 'notification',
  snapshot: {
    revision: 0,
    title: 'Mochi’s snack delivery',
    status: 'Packing a tiny treat',
    progress: 0.15,
  },
});

await update({
  id: snack.id,
  snapshot: {
    revision: 1,
    title: 'Mochi’s snack delivery',
    status: 'On the way to Mochi',
    progress: 0.65,
  },
});

// When the snacks arrive:
await end({ id: snack.id, policy: { kind: 'immediate' } });
```

Use increasing revisions and send a complete snapshot on each update. `list()`
reconciles activities after an app restart. A timer uses `template: 'timer'` and
`timer: { startedAt, endsAt }` instead of `progress`; times are Unix milliseconds.

The plugin displays state and, for layouts, reports button taps. Your app still owns the
underlying task, background execution, and update frequency. OS permissions, Focus settings
and promotion policy control where it appears. `fallback: 'none'` rejects an unavailable
native backend; it cannot force Android to promote a notification.

## Layouts (unreleased)

Request contract v2 is on `main` and not in 0.1.0-alpha.4.

With a layout, the app designs the activity instead of choosing the `progress` or `timer`
template. It sends a tree of nodes (stacks, text, SF Symbols, images, paths, progress views,
gauges, timers and buttons), a style table and a map of values. On iOS the plugin's widget
template draws the tree, so the app writes no SwiftUI of its own. The tree is fixed at start;
an update replaces the values only. Layout, styles and values share ActivityKit's 4 KiB limit.
The [request contract](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/request-contract.md#request-contract-v2-layout)
lists every node, style and limit.

Grant the layout commands as well:

```json
"live-activity:allow-start-layout",
"live-activity:allow-update-layout",
"live-activity:allow-end-layout"
```

`live-activity:default` already allows `list_layout`. `onAction` uses Tauri's event
permissions (`core:event:default`).

```ts
import {
  layout, startLayout, updateLayout, endLayout, onAction,
} from 'tauri-plugin-live-activity';

const { vstack, hstack, symbol, bound, progress, button, text } = layout;

const nap = await startLayout({
  activityKey: 'mochi:nap',
  schemaVersion: 2,
  fallback: 'notification',
  layout: {
    lockScreen: vstack([
      hstack([symbol('moon.zzz.fill'), bound('title', { style: 'title' })], { spacing: 8 }),
      bound('status'),
      progress('sleep'),
      button('wake', text('Wake Mochi')),
    ], { alignment: 'leading' }),
  },
  styles: { title: { font: 'headline' } },
  snapshot: { revision: 0, values: { title: 'Mochi’s nap', status: 'Dozing off', sleep: 0.2 } },
});

await updateLayout({
  id: nap.id,
  snapshot: { revision: 1, values: { title: 'Mochi’s nap', status: 'Fast asleep', sleep: 0.6 } },
});

await onAction(async ({ actionId, activityId }) => {
  if (actionId === 'wake') await endLayout({ id: activityId, policy: { kind: 'immediate' } });
});
```

An update keeps the keys and value types of the start. `listLayout()` reconciles layout
activities after a restart. Template and layout activities are separate: `list()` returns
template activities only, and `update` or `end` with a layout id answers `NOT_FOUND`.

### iOS widget

Layouts need the widget extension built from the plugin's template, as described in
[iOS setup](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-integration.md#add-the-widget).
Link the `LiveActivityShared` and `LiveActivityUI` products to the extension, and keep
`TauriLiveActivityLayout` = `2` in its Info.plist (`templates/ios/Info.plist` sets it).
For buttons, add `templates/ios/LiveActivityActionIntent.swift` to both the widget extension
and the app target, and keep its type name. The widget needs it to build the button, and the
app needs its own copy because the system runs the intent in the app process.

### Buttons

A tap on a `button` node calls the `on_action` handlers in Rust, then emits the
`live-activity://action` event that `onAction` receives. The event carries `actionId`,
`activityId` and, when the plugin knows the activity, `activityKey`. A tap does not change
the activity; update or end it from a handler.

The system can launch the app in the background for a tap. Tauri may then never run `setup`
or create a web view, so `onAction` never hears it. For such taps, handle the action in Rust
instead, on the built `App` before `run`:

```rust
use tauri_plugin_live_activity::{EndInput, EndPolicy, LiveActivityExt};

let app = tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
let handle = app.handle().clone();
app.live_activity().on_action(move |event| {
    if event.action_id == "wake" {
        let input = EndInput { id: event.activity_id, policy: EndPolicy::Immediate {} };
        let _ = handle.live_activity().end_layout(input);
    }
});
app.run(|_, _| {});
```

Handlers run on a plugin thread, never the main thread, so they may call the plugin. On iOS,
buttons need iOS 17 (`getCapabilities()` reports `actions`), and the intent waits up to
4 seconds for the handlers. On Android, a tap that starts a killed process waits in memory
and is lost if the Tauri runtime does not start in that process.

### Android

A notification cannot draw a layout, so Android shows part of the lock screen tree: the first
`text` as the title, the second as the body, the first `progress` and `timerText` as the
progress bar and the chronometer, and up to three `button`s as actions labelled with their
first text. It lists what it left out in `degradedFeatures`, for example `layout.symbol` and
`layout.styles` for the layout above. `android: { visibility }` in a start request sets the
lock screen visibility. See
[Android setup](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md#layout-activities-contract-v2).

### Samsung Now Bar

One UI shows an app's promoted notification in the Now Bar only when Samsung's allow list
names the package, or when the user has turned on the developer option
"Live notifications for all apps". The allow list is built into One UI and updated from
Samsung's servers. Samsung approves apps privately; no public way to apply was found. The
Now bar page in Settings (Lock screen and AOD > Now bar) lists only apps on the allow list:
an entry with Samsung's `RON` flag directly, any other entry only when the app also declares
the manifest meta-data `com.samsung.android.support.ongoing_activity` = `true`. The meta-data
alone does not list an app, and the plugin does not add it.

The `android.samsungNowBar` option adds One UI's text extras to layout notifications on
Android 17 and later. With the developer option on, the Now Bar then shows the title and the
body (or the status chip text) as its two lines. The option does not put the app on the allow
list. This was measured on a Galaxy S23 with One UI 9; see
[Samsung Now Bar](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md#samsung-now-bar).

## Plugin configuration (unreleased)

`plugins.live-activity` in `tauri.conf.json` is optional:

```json
{ "plugins": { "live-activity": { "receipts": "redacted", "android": { "samsungNowBar": true } } } }
```

- `receipts`: iOS stores a receipt of each accepted request, so that a late ActivityKit read
  cannot bring back an older revision, also after a restart. `full`, the default, keeps the
  snapshot and its text. `redacted` keeps only a SHA-256 digest of it; a digest hides only
  values that cannot be guessed. This covers template and layout activities. Android ignores
  the option for now and stores records in full in app-private preferences. See
  [Receipts](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-integration.md#receipts).
- `android.samsungNowBar`: the [Samsung Now Bar](#samsung-now-bar) extras; off when absent.

## Try it locally

The [demo](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo)
includes snack delivery, a nap timer and lifecycle checks through the real Tauri bridge.

```sh
npm ci
npm test
npm run build:demo
# With the mobile toolchain configured:
cd examples/demo
npm run tauri -- android dev
# or: npm run tauri -- ios dev
```

See [validation results](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/validation.md)
and [OS coverage](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/platform-coverage.md)
for tested versions and remaining device checks.

## License

[MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
