# tauri-plugin-live-activity

[![npm](https://img.shields.io/npm/v/tauri-plugin-live-activity-api/next)](https://www.npmjs.com/package/tauri-plugin-live-activity-api)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-live-activity)](https://crates.io/crates/tauri-plugin-live-activity)
[![CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

Live Activities on iOS and ongoing notifications on Android, for Tauri 2.
Community plugin. **Early alpha.** [한국어](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/README.ko.md)

| Platform | Backend |
| --- | --- |
| iOS 16.1+ | ActivityKit · Lock Screen and Dynamic Island |
| Android API 24+ | Ongoing notifications · Live Update promotion on eligible API 36+ devices |
| macOS / Windows / Linux | Not implemented |

<table>
  <tr><th>iOS · order and download progress</th><th>Android · download progress</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-live-activity.png" width="300" alt="iPhone Lock Screen showing a download at 65% and an order being prepared at 30%"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-live-activity.png" width="300" alt="Android notification showing 65 of 100 files downloaded"></td>
  </tr>
</table>

Actual captures from iOS 27.2 Simulator and an Android API 37 emulator.
The examples display progress supplied by the app.
On older Android versions, the same example uses an
[ongoing notification](https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-notification-fallback.png).

## Install

Requires Tauri 2 and Rust 1.90+.

```sh
npm install tauri-plugin-live-activity-api@next
```

`src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-live-activity = "=0.1.0-alpha.1"
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

## Example: download progress

```ts
import {
  getCapabilities, requestPermissions, start, update, end,
} from 'tauri-plugin-live-activity-api';

const { platform } = await getCapabilities();
await requestPermissions(platform === 'android' ? 'notifications' : 'liveActivities');

const download = await start({
  activityKey: 'download:files',
  schemaVersion: 1,
  template: 'progress',
  fallback: 'notification',
  snapshot: {
    revision: 0,
    title: 'Downloading files',
    status: 'Starting download',
    progress: 0,
  },
});

await update({
  id: download.id,
  snapshot: {
    revision: 1,
    title: 'Downloading files',
    status: '65 of 100 files',
    progress: 0.65,
  },
});

// When your download finishes:
await end({ id: download.id, policy: { kind: 'immediate' } });
```

Use increasing revisions and send a complete snapshot on each update. `list()`
reconciles activities after an app restart. A timer uses `template: 'timer'` and
`timer: { startedAt, endsAt }` instead of `progress`; times are Unix milliseconds.

The plugin displays state. Your app still owns the download, background execution,
and update frequency. OS permissions, Focus settings and promotion policy control
where it appears. `fallback: 'none'` rejects an unavailable native backend; it cannot
force Android to promote a notification.

## Try it locally

The [demo](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo)
includes progress, timer and lifecycle checks through the real Tauri bridge.

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
for tested versions and remaining device checks.

## License

[MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
