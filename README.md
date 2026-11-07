# tauri-plugin-live-activity

[![npm](https://img.shields.io/npm/v/tauri-plugin-live-activity)](https://www.npmjs.com/package/tauri-plugin-live-activity)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-live-activity)](https://crates.io/crates/tauri-plugin-live-activity)
[![CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

Show what your Tauri 2 app is doing on the iPhone Lock Screen and in the Dynamic Island, and as
an ongoing notification on Android. You describe the layout in TypeScript; the plugin draws it.
[한국어](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/README.ko.md)

<table>
  <tr><th>iOS Lock Screen</th><th>Dynamic Island</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-paths.png" width="400" alt="Mochi's face drawn from SVG paths on the iOS Lock Screen"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-expanded.png" width="400" alt="Mochi's snack in the expanded Dynamic Island"></td>
  </tr>
  <tr><th>Android notification</th><th>Samsung Now Bar</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-android.png" width="400" alt="Mochi's nap as an Android notification with a progress bar and a Wake Mochi action"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/samsung-now-bar.png" width="400" alt="Mochi's snack delivery in the One UI Now Bar on a locked Galaxy S23"></td>
  </tr>
</table>

All four come from the [demo app](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo),
which follows a cat named Mochi. The plugin runs on iOS 16.1+ and Android 8+; on desktop, its
activity commands return `UNSUPPORTED_PLATFORM`. Before 1.0, a minor version may change the API.

## Install

In the folder of your Tauri 2 app:

```sh
cargo add tauri-plugin-live-activity --manifest-path src-tauri/Cargo.toml
npm i tauri-plugin-live-activity
npx tauri-plugin-live-activity setup
```

Then add one line to the builder in `src-tauri/src/lib.rs`:

```rust
.plugin(tauri_plugin_live_activity::init())
```

`setup` grants the plugin's permissions, raises the Android minimum to API 26 and, on a Mac,
adds the widget extension that draws the activity to the Xcode project. Run it after
`tauri ios init`, and again if `src-tauri/gen/apple` is ever made from scratch. `--dry-run`
shows what it would change.

## Use

```ts
import { getCapabilities, layout, requestPermissions, startLayout, updateLayout, endLayout } from 'tauri-plugin-live-activity';

const { vstack, bound, progress } = layout;
const { platform } = await getCapabilities();
await requestPermissions(platform === 'android' ? 'notifications' : 'liveActivities');

const snack = await startLayout({
  activityKey: 'mochi:snack',
  schemaVersion: 2,
  fallback: 'notification',
  layout: { lockScreen: vstack([bound('title'), bound('status'), progress('done')]) },
  snapshot: { revision: 0, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', done: 0.15 } },
});
await updateLayout({ id: snack.id, snapshot: { revision: 1, values: { title: 'Mochi’s snack', status: 'On the way', done: 0.65 } } });
await endLayout({ id: snack.id, policy: { kind: 'immediate' } });
```

The layout stays as it started. Each update sends every value again, with a higher revision.

## What a layout can hold

- `text` and `bound`: fixed text, or the value of a key, in the styles you name
- `symbol`: SF Symbols, also filled from a value
- `image`: a picture from the widget's asset catalog
- `path`: a shape from SVG path data
- `gauge` and `progress`: a number as a ring or a bar
- `timerText`: a timer that the system counts, down or up
- `button`: a tap that reaches `onAction`, or `on_action` in Rust (iOS 17+)
- `vstack`, `hstack`, `zstack`, `spacer` and `divider` to arrange them, and `island` for the
  Dynamic Island's own parts

<table>
  <tr><th>Symbols</th><th>Image</th><th>Gauge</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-symbols.png" width="260" alt="A cat, a multicolor heart and a speaker filled to 35%"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-image.png" width="260" alt="Mochi's portrait from the widget's asset catalog"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-gauge.png" width="260" alt="A circular and a linear gauge at 80 of 100"></td>
  </tr>
  <tr><th>Progress</th><th>Timer</th><th>Buttons</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-progress.png" width="260" alt="A ring and a bar at 65%"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-timer.png" width="260" alt="A countdown at 4:50 under Mochi's nap"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-buttons-after.png" width="260" alt="Pet Mochi and All done buttons after one pet"></td>
  </tr>
</table>

Android shows a layout as a notification: the first two texts as title and body, the first
progress bar and timer, and up to three buttons. `degradedFeatures` names what it left out.

## Samsung Now Bar

Set `"plugins": { "live-activity": { "android": { "samsungNowBar": true } } }` in
`tauri.conf.json` to send One UI 9 the title and body that its Now Bar shows. One UI shows the
Now Bar only for apps on Samsung's allow list, or for every app while the developer option
"Live notifications for all apps" is on, and the plugin cannot add an app to that list.

## More

The [docs](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/docs) cover the
rest: what `setup` changes and how to do it by hand, every layout node with iOS and Android
captures, buttons handled in Rust, the progress and timer templates, the plugin options and
the test records.

## License

[MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
