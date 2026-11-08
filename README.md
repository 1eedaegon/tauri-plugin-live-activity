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
which follows a cat named Mochi. The plugin runs on iOS 16.2+ and Android 8+; on desktop, its
activity commands return `UNSUPPORTED_PLATFORM`. On iOS it is built on the
[activitykit](https://github.com/1eedaegon/activitykit-rs) crate and has no Swift of its own. Before 1.0, a minor
version may change the API.

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
adds the widget extension that draws the activity to the Xcode project, on activitykit's Swift
package. Run it after `tauri ios init`, and again if `src-tauri/gen/apple` is ever made from
scratch. On an app that 0.3 set up, run it again: it moves the widget and your custom views to
activitykit. `--dry-run` shows what it would change.

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

## Changing styles

The tree is fixed at start, but a few style members can name a value. An update then changes them:

```ts
const { bind } = layout;
// styles: { status: { color: bind('tone'), weight: bind('weight') } }, values: { tone: 'green', weight: 'regular', … }
await updateLayout({ id, snapshot: { revision: 2, values: { ...values, tone: 'red', weight: 'bold' } } });
```

```rust
let status = Style { color: Some(Bound::key("tone").into()), ..Style::default() };
// Later: every value again, with the new color.
values.insert("tone".into(), Value::Text("red".into()));
app.live_activity().update_layout(LayoutUpdateInput { id, snapshot: LayoutSnapshot { revision: 2, values, stale_at: None, timestamp: None } })?;
```

Only `color`, `background`, `tint`, `opacity`, `size`, `weight`, `cornerRadius` and the layout's
`background` and `keyline` can be bound. A bound color is a name or a hex color, not a light and
dark pair. Everything else stays as started; end the activity and start it again to change it.
Each update sends all values again, and layout, styles and values share the weight limit of 3584.
Android draws no styles. A 0.2.x crate rejects bindings, so keep the npm package and the crate on
the same minor version. [More](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#changing-styles)

## What a layout can hold

Layouts are built from `text`/`bound`, `path` (SVG path data) and `vstack`, `hstack`, `zstack`,
`spacer`, `divider`, plus the six below. Each picture is the iOS Lock Screen. The snippets take
the builders from `layout` (`const { vstack, hstack, text, bound, symbol, image, gauge, progress, timerText, button } = layout;`).

### Symbols

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-symbols.png" width="400" alt="A cat, a multicolor heart and a speaker filled to 35%">

```ts
hstack([
  symbol('cat.fill'),
  symbol('heart.fill', { rendering: 'multicolor' }),
  symbol('speaker.wave.3.fill', { variableBind: 'purr' }), // purr: 0.35
])
```

SF Symbols. `variableBind` fills a variable symbol from a value between 0 and 1. iOS only.

### Image

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-image.png" width="400" alt="Mochi's portrait from the widget's asset catalog">

```ts
hstack([image('mochi', { resizable: true, style: 'portrait' }), bound('title')])
// styles: { portrait: { frame: { width: 56, height: 56 } } }
```

A picture from the widget extension's asset catalog. iOS only.

### Gauge

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-gauge.png" width="400" alt="A circular and a linear gauge at 80 of 100">

```ts
hstack([gauge('bowl', { max: 100, kind: 'circular' }), gauge('bowl', { max: 100 })]) // bowl: 80
```

A number between `min` and `max` as a ring or a bar. iOS only.

### Progress

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-progress.png" width="400" alt="A ring and a bar at 65%">

```ts
vstack([bound('title'), progress('done', { kind: 'circular' }), progress('done')]) // done: 0.65
```

A number from 0 to 1. On Android the first one becomes the notification's bar.

### Timer

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-timer.png" width="400" alt="A countdown at 4:50 under Mochi's nap">

```ts
vstack([bound('title'), timerText('start', 'end')]) // end: Date.now() + 5 * 60_000
```

The system counts it, down to `end` or up from `start` (`countsDown: false`). On Android it is the notification's chronometer.

### Buttons

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-buttons-after.png" width="400" alt="Pet Mochi and All done buttons after one pet">

```ts
hstack([button('pet', text('Pet Mochi')), button('done', text('All done'))])

await onAction(async ({ actionId, activityId }) => {
  if (actionId === 'done') await endLayout({ id: activityId, policy: { kind: 'immediate' } });
});
```

A tap reaches `onAction`, or `on_action` in Rust, which also runs when the app was not open. iOS 17+; Android shows up to three as notification actions.

### Dynamic Island

<table>
  <tr><th>Compact</th><th>Minimal</th><th>Expanded</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-compact.png" width="270" alt="A paw and 9 min in the compact Dynamic Island"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-minimal.png" width="180" alt="A progress ring in the minimal Dynamic Island"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-expanded.png" width="265" alt="Portrait, title, time, status and bar in the expanded Dynamic Island"></td>
  </tr>
</table>

```ts
island: {
  expanded: {
    leading: image('mochi', { resizable: true, style: 'portrait' }),
    center: bound('title'),
    trailing: bound('eta'),
    bottom: vstack([bound('status'), progress('done')]),
  },
  compactLeading: symbol('pawprint.fill'),
  compactTrailing: bound('eta'),
  minimal: progress('done', { kind: 'circular' }),
},
keyline: '#A3D9C2', // the island's edge color
```

Put `island` next to `lockScreen` in the layout. A part you leave out shows the lock screen tree (expanded) or its first symbol (compact leading, minimal).

Android shows a layout as a notification: the first two texts as title and body, the first progress bar and timer, and up to three buttons. `degradedFeatures` names what it left out.

## Beyond the built-in parts

Most customizing needs no Swift. Bundle your fonts and pictures in the widget extension, and name them:

```sh
npx tauri-plugin-live-activity setup --font fonts/Pacifico-Regular.ttf --asset art/paw@3x.png
```

```ts
styles: { title: { fontFamily: 'Pacifico-Regular', size: 22 } }, // setup prints the names a font answers to
lockScreen: hstack([image('paw'), bound('title', { style: 'title' })]),
```

Pictures the app draws, on a canvas or in Rust, go through an App Group (`setup --app-group`). Write the PNG,
then start or update, and the widget draws it:

```ts
await writeImage('badge.png', png); // Rust: app.live_activity().write_image("badge.png", &png)
lockScreen: image({ file: 'badge.png' }, { resizable: true }),
```

For a view of your own, write it in SwiftUI in `gen/apple/LiveActivityWidget/LiveActivityCustomViews.swift`, which
`setup` creates once and never overwrites, and place it with `custom`:

```ts
custom('ring', { props: { level: bind('done'), width: 4 } }),
```

```swift
"ring": ActivityKitCustomView { props in Ring(level: props.number("level") ?? 0) },
```

A name without a view draws nothing and is reported in `degradedFeatures` as `layout.custom.ring`. The last
resort is to edit the copied `LiveActivityWidget.swift`, activitykit's widget template; `setup` then keeps your copy,
and template updates are yours to merge.

Limits: a Live Activity has no network and little memory. A drawn PNG is at most 1 MiB and 1224 × 480 pixels,
Apple's largest Lock Screen presentation at @3x. Fonts must be in the extension. On a device the App Group is
registered with your Apple account once; automatic signing does that. The validators check a custom view's name
and props, not the view. Android draws none of these, except that the first drawn image becomes the
notification's large icon. Layout, styles and values still share 3584.
[More](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#beyond-the-built-in-parts)

## Limits

- iOS: an iPhone with iOS 16.2 or an iPad with iPadOS 17; buttons need iOS 17. An activity starts only while the
  app is in the foreground (`NOT_FOREGROUND` otherwise), and the system ends it after 8 hours.
- iOS keeps each activity's last values in plain text in the app's Application Support. `receipts: "redacted"` is
  not available on iOS yet: with it, starts, updates and ends fail with `CONFIGURATION_REQUIRED`.
- On iOS activitykit numbers the revisions: an update with a higher revision than the record's is sent as the
  record's plus one.
- No push updates. Android shows an ongoing notification, promoted to a Live Update where the system allows it.

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
