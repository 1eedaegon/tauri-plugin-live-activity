# Usage

This guide has the parts that the [README](../README.md) leaves out: what `setup` does, the
same steps by hand, every layout node with captures from iOS and Android, fonts, drawn images
and custom views, the progress and timer templates, and the plugin configuration.

The plugin shows state that the app sends. The app still owns the task, background work and
how often it updates. OS permissions, Focus and promotion rules decide where the activity
appears. `fallback: 'none'` rejects an unavailable native backend; it cannot force Android to
promote a notification.

## Install

Requires Tauri 2 and Rust 1.90+. Use the same minor version of the crate and the npm package.
From the app's folder:

```sh
cargo add tauri-plugin-live-activity --manifest-path src-tauri/Cargo.toml
npm i tauri-plugin-live-activity
npx tauri-plugin-live-activity setup
```

Then register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
```

Android builds need Android SDK 37. iOS builds need Xcode and XcodeGen, which `tauri ios init`
asks for too.

### What setup does

`setup` runs in the app's folder or in its `src-tauri` folder. It finds the plugin crate with
`cargo metadata` and takes the iOS templates from it, so they always match the crate's version.

- **Permissions.** It adds `live-activity:default` and the `allow-` permissions of
  `request_permissions`, `start`, `update`, `end`, `start_layout`, `update_layout`,
  `end_layout` and `write_image` to `src-tauri/capabilities/default.json`, or to the only
  capability file there.
  `onAction` also needs `core:event:default`, which `core:default` in a new app includes.
- **Android.** The plugin needs Android 8 (API 26); a new Tauri app starts at 24. It sets
  `bundle.android.minSdkVersion` to 26 in `tauri.conf.json`, which `tauri android init` reads,
  and `minSdk` in `src-tauri/gen/android/app/build.gradle.kts` when that project exists. The
  plugin's manifest adds the notification permissions and its receivers when Gradle merges it.
- **iOS**, on a Mac, once `src-tauri/gen/apple` exists:
  - adds `NSSupportsLiveActivities` = true to `src-tauri/Info.ios.plist`, which Tauri merges into
    the app's Info.plist when it builds;
  - copies `LiveActivityWidget.swift`, `LiveActivityActionIntent.swift`,
    `LiveActivityCustomRegistry.swift` and the extension's `Info.plist` from the crate's
    `templates/ios` to `src-tauri/gen/apple/LiveActivityWidget`, and creates
    `LiveActivityCustomViews.swift` there once, for [custom views](#custom-swiftui-views);
  - with `--font` and `--asset`, copies [fonts and pictures](#fonts-and-pictures-of-the-widget)
    into that folder;
  - writes `src-tauri/gen/apple/live-activity.yml`, an XcodeGen spec with the
    `LiveActivityWidget` app extension (iOS 16.1, the `LiveActivityShared` and `LiveActivityUI`
    products of the crate's Swift package, `TauriLiveActivityLayout` = 2, the bundle identifier
    `<app identifier>.widget`, the app's version, the bundled fonts and, with `--app-group`, the
    [App Group](#pictures-the-app-draws)), and adds the intent file, the two custom view files and
    the extension to the app target;
  - adds `live-activity.yml` to the `include` list of `src-tauri/gen/apple/project.yml`;
  - copies Tauri's Swift API next to the crate's Swift package (`.tauri/tauri-api` in the crate's
    folder) when it is not there yet, as the plugin's iOS build does. Xcode resolves that package
    before the Rust code is built;
  - runs `xcodegen generate` when any of these files changed, or when the Xcode project has no
    widget target yet.

It prints what it changed. A second run changes nothing. It leaves a file alone when it differs
from what setup would write, and says so: a widget file you edited, or a `live-activity.yml`
changed by hand. To take the template again, delete the file and run setup again. It also
leaves alone an Xcode project that already has a widget extension, such as the
[demo's](../examples/demo/src-tauri/gen/apple/project.yml); add the plugin's widget to that one
as [iOS setup](ios-integration.md) describes.

Run it again:

- when `src-tauri/gen/apple` is made from scratch, for example after you delete it and run
  `tauri ios init`: the new `project.yml` does not include `live-activity.yml`. A `tauri ios init`
  over an existing folder keeps `project.yml` (checked with Tauri CLI 2.12.4);
- after a plugin update: it rewrites `live-activity.yml` for the new crate folder, and names
  widget files that differ from the new templates;
- after a change of the app's version, so that the extension's version matches the app's, which
  the App Store requires.

| Option | Effect |
| --- | --- |
| `--dry-run` | Shows what would change and writes nothing |
| `--ios-only` | Does the iOS part only; leaves the capabilities and `tauri.conf.json` alone |
| `--font <file>` | Bundles a `.ttf`, `.otf` or `.ttc` font in the widget extension and prints its names; repeatable |
| `--asset <file>` | Puts a `.png`, `.jpg`, `.jpeg`, `.pdf` or `.svg` image in the widget's asset catalog; repeatable |
| `--app-group[=<id>]` | Gives both targets an App Group for `writeImage`, `group.<app identifier>` unless named; kept on later runs |

It exits with 0 when everything is set up, 1 when something is left to do (listed under
"To do") or it could not start, such as a `--font` file that does not exist, and 2 for an
unknown option or an option without its file. It reads `tauri.conf.json`, not
`tauri.conf.json5` or `Tauri.toml`, and uses `$CARGO` when that is set.

### Set up by hand

These steps do what `setup` does. Run them from the app's folder.

Grant the permissions:

```sh
for p in default allow-request-permissions allow-start allow-update allow-end allow-start-layout allow-update-layout allow-end-layout allow-write-image; do npx tauri permission add live-activity:$p; done
```

Raise the Android minimum: set `bundle.android.minSdkVersion` to `26` in
`src-tauri/tauri.conf.json`, and, if `src-tauri/gen/android` exists, `minSdk = 26` in
`src-tauri/gen/android/app/build.gradle.kts`.

On iOS, after `tauri ios init`, in one shell:

1. find the plugin's folder (`jq` comes with macOS 15 and later);
2. copy the widget, the button intent, the custom view files and the extension's Info.plist;
3. add `NSSupportsLiveActivities` to `src-tauri/Info.ios.plist`;
4. prepare the Tauri dependency of the plugin's Swift package. On an Intel Mac, use
   `--target x86_64-apple-ios`.

```sh
LA=$(cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml | jq -r '.packages[] | select(.name == "tauri-plugin-live-activity") | .manifest_path | rtrimstr("Cargo.toml")')
mkdir -p src-tauri/gen/apple/LiveActivityWidget && cp "$LA"templates/ios/* src-tauri/gen/apple/LiveActivityWidget/
# Once: LiveActivityCustomViews.swift is yours from now on; do not copy it over your edits again.
/usr/libexec/PlistBuddy -c 'Add :NSSupportsLiveActivities bool true' src-tauri/Info.ios.plist
IPHONEOS_DEPLOYMENT_TARGET=16.1 cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios-sim
```

Then write `src-tauri/gen/apple/live-activity.yml`. Replace `app_iOS` with the name of the app
target in `project.yml` (`<name>_iOS`), the path with the plugin's folder plus `ios`, and the
bundle identifier and the versions with the app's:

```yaml
packages:
  LiveActivity:
    path: "/path/to/tauri-plugin-live-activity-0.2.1/ios"
targets:
  app_iOS:
    sources: [LiveActivityWidget/LiveActivityActionIntent.swift, LiveActivityWidget/LiveActivityCustomRegistry.swift, LiveActivityWidget/LiveActivityCustomViews.swift]
    dependencies: [{ target: LiveActivityWidget }]
    settings:
      base:
        SWIFT_VERSION: "5.0"
  LiveActivityWidget:
    type: app-extension
    platform: iOS
    deploymentTarget: "16.1"
    sources: [LiveActivityWidget]
    dependencies:
      - package: LiveActivity
        product: LiveActivityShared
      - package: LiveActivity
        product: LiveActivityUI
    info:
      path: LiveActivityWidget/Info.plist
      properties:
        CFBundleShortVersionString: "0.1.0"
        CFBundleVersion: "0.1.0"
        NSExtension:
          NSExtensionPointIdentifier: com.apple.widgetkit-extension
        TauriLiveActivityLayout: 2
    settings:
      groups: [app]
      base:
        PRODUCT_NAME: LiveActivityWidget
        PRODUCT_BUNDLE_IDENTIFIER: "com.example.app.widget"
        SWIFT_VERSION: "5.0"
        APPLICATION_EXTENSION_API_ONLY: YES
        SKIP_INSTALL: YES
```

`groups: [app]` gives the extension the signing team of Tauri's `app` setting group. For bundled
fonts, add `UIAppFonts` with the file names under `properties`, and put the files in
`LiveActivityWidget/Fonts`. For drawn images, add `TauriLiveActivityAppGroup: "group.com.example.app"`
under `properties`, and to both targets:

```yaml
    entitlements:
      path: LiveActivityWidget.entitlements   # app_iOS/app_iOS.entitlements in the app target
      properties:
        com.apple.security.application-groups: ["group.com.example.app"]
```

Include the file and regenerate the Xcode project:

```sh
printf '\ninclude:\n  - live-activity.yml\n' >> src-tauri/gen/apple/project.yml && xcodegen generate --spec src-tauri/gen/apple/project.yml
```

The intent file goes into both targets: the widget builds its buttons from it, and the system
runs it in the app. So do the two custom view files: the widget draws the views, and the plugin
in the app reads which names have one. A `src-tauri/gen/apple` made from scratch has a new `project.yml`; run the
last line again then.

## Layouts

Captures: iOS 26.3 on the iPhone 17 simulator, Android 16 on an emulator. The demo adds
Mochi's colors and padding to the code shown here.

With a layout the app designs the activity itself: a tree of nodes, a table of styles and a
map of values. On iOS the plugin's widget template draws it, with no SwiftUI in the app.
Android shows part of it as a notification. The tree is fixed at start; an update sends new
values with the same keys and types, and a few style members can read values
([Changing styles](#changing-styles)). Layout, styles and values share ActivityKit's 4 KiB
limit.

### Text, values and styles

```ts
import { layout, startLayout, updateLayout, endLayout } from 'tauri-plugin-live-activity';

const { vstack, bound, text } = layout;

const card = await startLayout({
  activityKey: 'mochi:text',
  schemaVersion: 2,
  fallback: 'notification',
  layout: {
    lockScreen: vstack([
      bound('title', { style: 'title' }),
      bound('status', { style: 'status', unless: 'arrived' }),
      text('Snack time! Made it home', { style: 'done', if: 'arrived' }),
    ], { alignment: 'leading' }),
  },
  styles: {
    title: { font: 'headline' },
    status: { font: 'subheadline', color: 'secondary' },
    done: { font: 'subheadline', weight: 'bold', color: '#C9654D' },
  },
  snapshot: { revision: 0, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', arrived: false } },
});

await updateLayout({
  id: card.id,
  snapshot: { revision: 1, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', arrived: true } },
});

await endLayout({ id: card.id, policy: { kind: 'immediate' } });
```

`bound` shows a value, `text` a literal. `if` shows a node only while a value is truthy,
`unless` only while it is not. The examples below show only the members after `fallback`; the
builders are all in `layout`.

<table>
  <tr><th></th><th>iOS 26.3 simulator</th><th>Android 16 emulator</th></tr>
  <tr>
    <td><code>arrived: false</code></td>
    <td><img src="images/ios-layout-text.png" width="380" alt="Title and status text on the iOS Lock Screen"></td>
    <td><img src="images/android-layout-text.png" width="380" alt="The same title and status as an Android notification"></td>
  </tr>
  <tr>
    <td><code>arrived: true</code></td>
    <td><img src="images/ios-layout-text-arrived.png" width="380" alt="The status replaced by Snack time in bold coral on iOS"></td>
    <td><img src="images/android-layout-text-arrived.png" width="380" alt="The body replaced by Snack time on Android"></td>
  </tr>
</table>

Android drops styles: the first text is the title and the second the body.

### Changing styles

A style member can name a value with `bind` instead of holding a literal. The member reads
the value each time the activity is drawn, so an update changes it:

```ts
import { layout, startLayout, updateLayout } from 'tauri-plugin-live-activity';

const { vstack, hstack, symbol, bound, progress, bind } = layout;

const values = { title: 'Mochi’s snack', status: 'On time', tone: 'green', weight: 'regular', done: 0.3 };
const delivery = await startLayout({
  activityKey: 'mochi:styles',
  schemaVersion: 2,
  fallback: 'notification',
  layout: {
    lockScreen: vstack([
      hstack([symbol('clock.fill', { style: 'badge' }), bound('title')], { spacing: 8 }),
      bound('status', { style: 'status' }),
      progress('done', { style: 'meter' }),
    ], { alignment: 'leading' }),
  },
  styles: {
    badge: { color: bind('tone') },
    status: { font: 'subheadline', weight: bind('weight'), color: bind('tone') },
    meter: { tint: bind('tone') },
  },
  snapshot: { revision: 0, values },
});

// The snack runs late: the badge, the status and the bar turn red, and the status bold.
await updateLayout({
  id: delivery.id,
  snapshot: { revision: 1, values: { ...values, status: 'Running 5 min late', tone: 'red', weight: 'bold', done: 0.5 } },
});
```

`bind('tone')` writes `{ "bind": "tone" }`. In Rust, `Bound::key("tone")` writes the same, and
`.into()` turns it, or a literal, into the member's `Bindable`:

```rust
use std::collections::BTreeMap;
use tauri::{AppHandle, Runtime};
use tauri_plugin_live_activity::{
    Bound, Element, Fallback, Layout, LayoutSnapshot, LayoutStartInput, LayoutUpdateInput,
    LiveActivityExt, Node, Result, Style, Value,
};

fn delivery(revision: u64, status: &str, tone: &str) -> LayoutSnapshot {
    let values = [("status", status), ("tone", tone)]
        .map(|(key, text)| (key.to_string(), Value::Text(text.into())));
    LayoutSnapshot { revision, values: BTreeMap::from(values), stale_at: None }
}

fn start_input() -> LayoutStartInput {
    let text = Element::Text { value: None, bind: Some("status".into()) };
    let status = Node { style: Some("status".into()), ..text.into() };
    let style = Style { color: Some(Bound::key("tone").into()), ..Style::default() };
    LayoutStartInput {
        activity_key: "mochi:snack".into(),
        schema_version: 2,
        fallback: Fallback::Notification,
        layout: Layout { lock_screen: status, island: None, background: None, keyline: None },
        styles: Some(BTreeMap::from([("status".to_string(), style)])),
        snapshot: delivery(0, "On time", "green"),
        android: None,
    }
}

fn run_late<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let record = app.live_activity().start_layout(start_input())?;
    // Later: every value again, with a higher revision. The status turns red.
    let snapshot = delivery(1, "Running late", "red");
    let update = LayoutUpdateInput { id: record.id, snapshot };
    app.live_activity().update_layout(update)?;
    Ok(())
}
```

`LayoutStartInput::validate_update` checks an update against a start the way the native
layer does, before anything is sent.

The limits:

- Only these members can be bound: `color`, `background` and `tint` (a color name or a hex
  color), `size` (a number from 6 to 96), `opacity` (0 to 1), `cornerRadius` (0 to 64),
  `weight` (a weight name), and the layout's `background` and `keyline` (a color).
- A bound color cannot be a light and dark pair, because a value is a string, a number or a
  boolean. Color names such as `primary` or `red` follow the appearance; a hex color does not.
- The tree and every other member are fixed after start: `font`, `design`, `monospacedDigit`,
  `lineLimit`, `minimumScaleFactor`, `alignment`, `padding`, `frame`, `buttonStyle` and the
  members of nodes. To change them, end the activity and start it again.
- The value must exist at start and fit the member. Every update is checked again; a value
  that does not fit fails with `INVALID_INPUT`, and the activity keeps what it showed.
- Every update sends all values again. Layout, styles and values share the weight limit of
  3584, and each binding counts toward it.
- Android draws no styles: the status text changes, its color does not.
- A crate of 0.2.x rejects bindings with `INVALID_INPUT`. Keep the npm package and the crate on
  the same minor version.
- The iOS widget template passes the values to the background and keyline tints. A widget
  copied from an earlier template draws a bound `background` or `keyline` as absent. `setup`
  keeps a copy that differs; delete `LiveActivityWidget.swift` and run `setup` again.

The demo's **Changing styles** example cycles through on time (green), late (red and bold) and
home (a teal hex color). The full rules are in the
[request contract](request-contract.md#bound-style-members).

### SF Symbols

```ts
layout: {
  lockScreen: hstack([
    symbol('cat.fill'),
    symbol('heart.fill', { rendering: 'multicolor' }),
    symbol('speaker.wave.3.fill', { variableBind: 'purr' }),
    bound('title'),
  ], { spacing: 12 }),
},
snapshot: { revision: 0, values: { title: 'Purr meter', purr: 0.35 } },
```

`variableBind` fills a variable symbol from a number between 0 and 1.

| iOS 26.3 simulator | Android |
| --- | --- |
| <img src="images/ios-layout-symbols.png" width="400" alt="A cat, a multicolor heart and a speaker filled to 35% on the iOS Lock Screen"> | Not shown. Listed as `layout.symbol` in `degradedFeatures`. |

### Image

```ts
layout: {
  lockScreen: hstack([image('mochi', { resizable: true, style: 'portrait' }), bound('title')], { spacing: 12 }),
},
styles: { portrait: { frame: { width: 56, height: 56 } } },
snapshot: { revision: 0, values: { title: 'Mochi’s portrait' } },
```

`image` names a picture in the widget extension's asset catalog; `setup --asset` puts one there
([Fonts and pictures](#fonts-and-pictures-of-the-widget)). An `Assets.xcassets` folder made by hand
in `src-tauri/gen/apple/LiveActivityWidget` works too: run
`xcodegen generate --spec src-tauri/gen/apple/project.yml` and the widget target picks it up. The
demo's `mochi` is a PNG drawn from an SVG file. `image({ file: 'badge.png' })` shows a picture the
app drew instead ([Pictures the app draws](#pictures-the-app-draws)).

| iOS 26.3 simulator | Android |
| --- | --- |
| <img src="images/ios-layout-image.png" width="400" alt="Mochi's portrait from the widget's asset catalog on the iOS Lock Screen"> | Not shown. Listed as `layout.image`. |

### Paths (SVG path data)

```ts
const head = 'M14 40C12 32 11 22 14 14Q15 11 18 13L35 27Q50 23 65 27L82 13Q85 11 86 14C89 22 88 32 86 40C93 48 94 61 87 71C79 81 66 85 50 85C34 85 21 81 13 71C6 61 7 48 14 40Z';
layout: {
  lockScreen: zstack([
    path(head, [100, 90], { style: 'fur' }),
    path(head, [100, 90], { stroke: 1.5 }),
    path('M28 54Q33 58 38 54M62 54Q67 58 72 54', [100, 90], { stroke: 2 }),
    path('M48 64Q50 62 52 64Q50 66 48 64Z', [100, 90], { style: 'nose' }),
  ], { style: 'face' }),
},
styles: { face: { frame: { width: 60, height: 54 } }, fur: { color: '#F6E9CD' }, nose: { color: '#C9654D' } },
snapshot: { revision: 0, values: {} },
```

`path` draws the `d` of an SVG `<path>` in a `box` of `[width, height]`, scaled to fit. It is
filled, or stroked when `stroke` gives a line width. `d` takes `M L H V C S Q T Z`, up to
512 bytes. Arcs (`A`) are not supported; convert them to curves first.

| iOS 26.3 simulator | Android |
| --- | --- |
| <img src="images/ios-layout-paths.png" width="400" alt="Mochi's face drawn from four paths on the iOS Lock Screen"> | Not shown. Listed as `layout.path`. |

### Gauge

```ts
layout: {
  lockScreen: hstack([gauge('bowl', { max: 100, kind: 'circular' }), gauge('bowl', { max: 100 })], { spacing: 12 }),
},
snapshot: { revision: 0, values: { bowl: 80 } },
```

A gauge shows a number between `min` and `max` (0 and 1 when left out), as a ring or a bar.

| iOS 26.3 simulator | Android |
| --- | --- |
| <img src="images/ios-layout-gauge.png" width="400" alt="A circular and a linear gauge at 80 of 100 on the iOS Lock Screen"> | Not shown. Listed as `layout.gauge`. |

### Progress

```ts
layout: {
  lockScreen: vstack([bound('title'), progress('done', { kind: 'circular' }), progress('done')]),
},
snapshot: { revision: 0, values: { title: 'Mochi’s snack delivery', done: 0.65 } },
```

A progress view shows a number from 0 to 1 as a bar or a ring.

<table>
  <tr><th>iOS 26.3 simulator</th><th>Android 16 emulator</th></tr>
  <tr>
    <td><img src="images/ios-layout-progress.png" width="400" alt="A ring and a bar at 65% on the iOS Lock Screen"></td>
    <td><img src="images/android-layout-progress.png" width="400" alt="The first progress view as the bar of an Android notification"></td>
  </tr>
</table>

Android turns the first progress view into the notification's bar.

### Timer

```ts
layout: {
  lockScreen: vstack([bound('title'), timerText('start', 'end')]),
},
snapshot: { revision: 0, values: { title: 'Mochi’s nap', start: Date.now(), end: Date.now() + 5 * 60_000 } },
```

`timerText` counts down to the `end` value, or up from `start` with `countsDown: false`.

<table>
  <tr><th>iOS 26.3 simulator</th><th>Android 16 emulator</th></tr>
  <tr>
    <td><img src="images/ios-layout-timer.png" width="400" alt="A countdown at 4:50 under Mochi's nap on the iOS Lock Screen"></td>
    <td><img src="images/android-layout-timer.png" width="400" alt="The countdown as the chronometer in the Android notification header"></td>
  </tr>
</table>

Android shows the first timer as the notification's chronometer.

### Stacks

```ts
layout: {
  lockScreen: vstack([
    hstack([zstack([symbol('circle.fill'), symbol('pawprint.fill', { style: 'mark' })]), bound('title'), spacer(), bound('eta')]),
    divider(),
    hstack([bound('from'), spacer(), bound('to')]),
  ], { spacing: 10 }),
},
styles: { mark: { size: 13, color: 'white' } },
snapshot: { revision: 0, values: { title: 'Snack route', eta: '4 min', from: 'Kitchen', to: 'Mochi’s bowl' } },
```

`vstack`, `hstack` and `zstack` put nodes in a column, in a row or on top of each other.
`spacer` takes the free space and `divider` draws a line.

| iOS 26.3 simulator | Android |
| --- | --- |
| <img src="images/ios-layout-stacks.png" width="400" alt="A paw badge, title and time in a row, a line, and From and To below on the iOS Lock Screen"> | Only the first two texts, as the title and the body. Not captured. |

### Buttons

```ts
layout: {
  lockScreen: vstack([
    bound('title'),
    bound('status'),
    hstack([button('pet', text('Pet Mochi')), button('done', text('All done'))], { spacing: 8 }),
  ], { alignment: 'leading' }),
},
snapshot: { revision: 0, values: { title: 'Mochi wants attention', status: 'No pets yet', pets: 0 } },
```

A tap reports the button's action ID. It does not change the activity: update or end it in a
handler. `onAction` hears taps while the web view runs:

```ts
import { endLayout, onAction } from 'tauri-plugin-live-activity';

await onAction(async ({ actionId, activityId }) => {
  if (actionId === 'done') await endLayout({ id: activityId, policy: { kind: 'immediate' } });
});
```

The system can start the app in the background for a tap, and Tauri may then create no web
view. Taps that must work then belong in Rust. Register the handler on the built `App`
before `run`:

```rust
use tauri_plugin_live_activity::{EndInput, EndPolicy, LiveActivityExt};

let app = tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
let handle = app.handle().clone();
app.live_activity().on_action(move |event| {
    if event.action_id == "done" {
        let input = EndInput { id: event.activity_id, policy: EndPolicy::Immediate {} };
        let _ = handle.live_activity().end_layout(input);
    }
});
app.run(|_, _| {});
```

Rust handlers run first, on a plugin thread, and may call the plugin. `onAction` needs
`core:event:default`, which a new app has.

<table>
  <tr><th></th><th>iOS 26.3 simulator</th><th>Android 16 emulator</th></tr>
  <tr>
    <td>Start</td>
    <td><img src="images/ios-layout-buttons-before.png" width="380" alt="Pet Mochi and All done buttons on the iOS Lock Screen"></td>
    <td><img src="images/android-layout-buttons-before.png" width="380" alt="Pet Mochi and All done as Android notification actions"></td>
  </tr>
  <tr>
    <td>After taps on Pet Mochi</td>
    <td><img src="images/ios-layout-buttons-after.png" width="380" alt="The status reads Purring. 1 pet so far after one tap on iOS"></td>
    <td><img src="images/android-layout-buttons-after.png" width="380" alt="The body reads Purring. 2 pets so far after two taps on Android"></td>
  </tr>
</table>

The demo's Rust handler counts the pets and updates the status. Buttons need iOS 17
(`getCapabilities()` reports `actions`). Android shows up to three buttons as notification
actions. On Android, a tap that starts a killed app waits in memory and is lost if the Tauri
runtime does not start.

### Dynamic Island

```ts
layout: {
  lockScreen: vstack([bound('title'), bound('status'), progress('done')]),
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
  keyline: '#A3D9C2',
},
styles: { portrait: { frame: { width: 44, height: 44 } } },
snapshot: { revision: 0, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', done: 0.15, eta: '9 min' } },
```

`island` gives each part its own nodes. A part left out gets a default: the expanded view
shows the lock screen tree, compact leading and minimal show its first symbol. `keyline` tints
the island's edge.

<table>
  <tr><th>Compact</th><th>Minimal</th><th>Expanded</th></tr>
  <tr>
    <td><img src="images/ios-island-compact.png" width="270" alt="A paw on the left and 9 min on the right of the compact Dynamic Island"></td>
    <td><img src="images/ios-island-minimal.png" width="180" alt="A progress ring in the minimal Dynamic Island"></td>
    <td><img src="images/ios-island-expanded.png" width="265" alt="Mochi's portrait, title, time, status and bar in the expanded Dynamic Island"></td>
  </tr>
</table>

iOS 26.3 on the iPhone 17 simulator. Android has no Dynamic Island and lists `layout.island`.

### Android

A notification cannot draw a layout. Android takes these parts of the lock screen tree, in
order, with the current values:

| Layout | Notification |
| --- | --- |
| first `text` | title |
| second `text` | body |
| first `progress` | progress bar |
| first `timerText` | chronometer |
| up to three `button`s | actions, labelled with their first text |
| `android.visibility` | lock screen visibility: `public`, `private` (default) or `secret` |

Everything else is listed in `degradedFeatures`, here `layout.symbol` and `layout.styles`:

```ts
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
android: { visibility: 'public' },
```

| iOS | Android 16 emulator |
| --- | --- |
| Drawn as written, like the examples above. | <img src="images/android-layout-android.png" width="400" alt="Mochi's nap at 60% with a Wake Mochi action in the Android notification shade"> |

The capture is after an update to `Fast asleep` and `0.6`. On Android 16 and later the plugin
requests promotion to a Live Update where the app may post one; `promotionState` reports what
Android did.

### Samsung Now Bar

One UI shows a promoted notification in the Now Bar only for apps on Samsung's allow list, or
for every app while the user has the developer option "Live notifications for all apps" on.
Samsung adds apps to the list privately; no public way to apply was found. To show the title
and the body there on Android 17 and later, turn on the plugin's One UI extras in
`tauri.conf.json`:

```json
{ "plugins": { "live-activity": { "android": { "samsungNowBar": true } } } }
```

| Galaxy S23, One UI 9 (Android 17), locked |
| --- |
| <img src="images/samsung-now-bar.png" width="400" alt="Mochi's snack delivery and On the way to Mochi in the One UI Now Bar"> |

This is the demo's Now Bar example (title, status and a progress bar, with
`android: { visibility: 'public' }`) after one update, with the developer option on. The
extras do not put the app on the allow list. An app that Samsung lists without its `RON` flag
also needs this entry in the `<application>` of
`src-tauri/gen/android/app/src/main/AndroidManifest.xml`, which the plugin does not add:

```xml
<meta-data android:name="com.samsung.android.support.ongoing_activity" android:value="true" />
```

What was found about the Now Bar on One UI 9 is in [Android setup](android-integration.md#samsung-now-bar).

## Beyond the built-in parts

The nodes above draw with system fonts, SF Symbols, the widget's asset catalog, SVG path data, progress views,
gauges and timers. Four ways go further. The first two need no Swift:

| You want | How | Swift |
| --- | --- | --- |
| your fonts, your pictures | `setup --font`, `setup --asset`; a style's `fontFamily`, `image(name)` | no |
| pictures the app draws while it runs | `setup --app-group`; `writeImage`, `image({ file })` | no |
| a view of your own | `custom(name)` and a SwiftUI view in `LiveActivityCustomViews.swift` | yes, that view |
| everything | edit the copied `LiveActivityWidget.swift` | yes, all of it |

The captures were made with a scratch Tauri app on the iOS 26.3 simulator (iPhone 17 Pro), with the plugin added
by path.

### Fonts and pictures of the widget

```sh
npx tauri-plugin-live-activity setup --font fonts/Pacifico-Regular.ttf --asset art/paw@2x.png --asset art/paw@3x.png
```

`--font` copies a `.ttf`, `.otf` or `.ttc` file to `src-tauri/gen/apple/LiveActivityWidget/Fonts` and lists every
font of that folder under `UIAppFonts` in the extension's Info.plist, through `live-activity.yml`. It prints the
names the font answers to, for example `fontFamily: "Pacifico-Regular" or "Pacifico"`: the PostScript name and the
family name from the font's name table. A style takes either:

```ts
styles: {
  title: { fontFamily: 'Pacifico-Regular', font: 'title3' }, // the size of title3, scaled with Dynamic Type
  price: { fontFamily: 'Pacifico', size: 18, weight: 'bold' }, // 18 points, not scaled
}
```

- With `font`, the custom font takes that text style's size (title3 is 20 points at the default text size) and
  scales with Dynamic Type. With `size`, it has that size. Alone it takes the size of `body`, 17 points.
- `weight` picks another face of the family when the extension bundles one; a family of one face draws that face.
- `fontFamily` and `design` exclude each other, as `font` and `size` do: `design` chooses a design of the system
  font. `fontFamily` is fixed at start, like `font`.
- A name the extension does not have draws the system font at the same size. Nothing reports it, so check the
  names that `setup` prints.

`--asset` copies a `.png`, `.jpg`, `.jpeg`, `.pdf` or `.svg` file into the extension's asset catalog,
`LiveActivityWidget/Assets.xcassets`. The file name is the asset name, without the extension and a `@2x` or `@3x`
scale: `paw@2x.png` and `paw@3x.png` become the two scales of `paw`, which `image('paw')` shows. A PDF or SVG is kept
as vector data. The name must follow the asset rule (1 to 64 ASCII letters, digits, `.`, `_` and `-`). An image set
that you edited in Xcode keeps its entries; setup only adds the file it copies.

Both options copy a file again when it changed, and leave it alone otherwise. The fonts in the folder stay listed
on later runs without `--font`. Both files and folders live in `gen/apple`; keep that folder in version control, and
restore `LiveActivityWidget` with it if you ever make it from scratch.

<img src="images/ios-custom-before.png" width="400" alt="A drawn coral badge with 1, a title in the BM Hanna font, a ring at 35% and Mochi's portrait on the iOS Lock Screen">

The title uses a bundled font by its PostScript name, the line below it the same font by its family name; Mochi's
portrait on the right is an asset that `--asset` added.

### Pictures the app draws

The widget extension runs in a process of its own and cannot read the app's files. An App Group gives both a shared
container:

```sh
npx tauri-plugin-live-activity setup --app-group                 # group.<app identifier>
npx tauri-plugin-live-activity setup --app-group=group.com.example.shared
```

Setup writes the group into `live-activity.yml`: into the entitlements of the app target and of the extension, and
under `TauriLiveActivityAppGroup` into the extension's Info.plist, where the plugin and the widget read it. Later runs
keep the group without the option. XcodeGen writes both entitlements files from the spec each time it generates the
project, and it did so before this option too: with Tauri's `project.yml` it writes the app's file empty. An
entitlement the app needs, such as `aps-environment`, belongs under `entitlements.properties` of the app target in
`project.yml`; XcodeGen merges it with the App Group of `live-activity.yml`. In the simulator nothing
more is needed. For a device the group has to exist in your Apple Developer account and in the provisioning profiles
of both targets: with automatic signing, Xcode registers it the first time it builds for a device, which needs your
account signed in to Xcode; with manual signing, add the group to both App IDs and download the profiles again.

Then write a PNG and point an `image` at it:

```ts
import { layout, startLayout, updateLayout, writeImage } from 'tauri-plugin-live-activity';

const { hstack, image, bound } = layout;

async function badge(color: string, label: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 168; // 56 points at @3x
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.beginPath();
  context.arc(84, 84, 80, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#FFFFFF';
  context.font = 'bold 96px -apple-system';
  context.textAlign = 'center';
  context.fillText(label, 84, 118);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(png => resolve(png!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

await writeImage('badge.png', await badge('#C9654D', '1'));
const card = await startLayout({
  activityKey: 'mochi:badge',
  schemaVersion: 2,
  fallback: 'none',
  layout: { lockScreen: hstack([image({ file: 'badge.png' }, { resizable: true, style: 'badge' }), bound('title')]) },
  styles: { badge: { frame: { width: 52, height: 52 } } },
  snapshot: { revision: 0, values: { title: 'Mochi’s snack' } },
});

// Later: a new picture under the same name, then an update.
await writeImage('badge.png', await badge('#2E8B7A', '2'));
await updateLayout({ id: card.id, snapshot: { revision: 1, values: { title: 'Mochi is home' } } });
```

In Rust, `write_image` takes the bytes, for example from a PNG encoder such as the `png` or `image` crate:

```rust
app.live_activity().write_image("badge.png", &png_bytes)?;
```

- The name follows the rule of a `file` source, the same as an asset name: 1 to 64 ASCII letters, digits, `.`, `_`
  and `-`, starting with a letter or digit. No folders, so a name cannot leave the image folder.
  `INVALID_INPUT` otherwise.
- The bytes are a PNG file, from its signature and image header to its end chunk (`INVALID_INPUT` otherwise), of at
  most 1 MiB and 1224 × 480 pixels (`PAYLOAD_TOO_LARGE` beyond). Apple requires an image of a Live Activity to be no
  larger than its presentation and says that a larger one may keep the activity from starting; 1224 × 480 is the
  largest Lock Screen presentation, 408 × 160 points, at @3x. Draw at the size the frame shows at @3x: 56 points are
  168 pixels.
- On iOS the file goes to `tauri-live-activity/images` in the App Group container, replacing an earlier file of that
  name as a whole: the widget reads the old picture or the new one, never part of one. Without an App Group in the
  extension the call fails with `CONFIGURATION_REQUIRED`. On desktop it checks the PNG and returns
  `UNSUPPORTED_PLATFORM`.
- The widget reads the file each time it draws the activity, which it does on start and on every update. Writing
  alone draws nothing new: write first, then update. The update may keep every value; its higher revision is new
  content. A missing or unreadable file draws nothing and is not reported.
- The name is fixed in the tree at start, so a new picture takes the same name. Files stay until the app writes them
  again; the plugin removes none, so reuse a few names.
- Files get the app's default data protection, readable after the first unlock, so the Lock Screen can draw them.

<img src="images/ios-custom-after.png" width="400" alt="The same activity after an update: a teal badge with 2, Mochi is home, the ring at 80%">

The same activity after an update: the app wrote a teal badge under the same name, then sent new values. A
later update that kept every value and only raised the revision, sent after a third badge was written, drew the
third badge too.

On Android, `writeImage` writes to the app's private files. The notification shows the first image of the lock
screen tree whose source is a file, in document order with the conditions applied, as its large icon, scaled to at
most 256 pixels. Google's requirements for a Live Update do not name the large icon, so it keeps promotion; One UI's
Now Bar was not checked with one. Asset images and further file images are listed as `layout.image`.

### Custom SwiftUI views

A `custom` node draws a SwiftUI view that the app registers under a name:

```ts
const { custom, bind } = layout;

lockScreen: hstack([bound('title'), custom('ring', { props: { level: bind('done'), label: bind('percent'), width: 5 }, style: 'ring' })]),
styles: { ring: { frame: { width: 46, height: 46 }, color: 'mint' } },
snapshot: { revision: 0, values: { title: 'Mochi’s snack', done: 0.35, percent: '35%' } },
```

`setup` creates `src-tauri/gen/apple/LiveActivityWidget/LiveActivityCustomViews.swift` once and never writes it again.
Fill in its table:

```swift
import SwiftUI

@available(iOS 16.1, *)
@objc(TauriLiveActivityCustomViews)
final class LiveActivityCustomViews: LiveActivityCustomViewRegistry {
    override class var views: [String: LiveActivityCustomView] {
        [
            "ring": LiveActivityCustomView { props in
                Ring(level: props.number("level") ?? 0, label: props.string("label") ?? "", width: props.number("width") ?? 4)
            },
        ]
    }
}

@available(iOS 16.1, *)
struct Ring: View {
    let level: Double
    let label: String
    let width: Double

    var body: some View {
        ZStack {
            Circle().stroke(lineWidth: width).opacity(0.25)
            Circle().trim(from: 0, to: level).stroke(style: StrokeStyle(lineWidth: width, lineCap: .round)).rotationEffect(.degrees(-90))
            Text(label).font(.system(size: 11, weight: .bold))
        }
    }
}
```

- `props` holds 1 to 16 inputs under value-key names. A literal is text of at most 200 code points, a number or a
  boolean; `bind(key)` reads a value, so each update can change it. In Swift, `props.number`, `props.string` and
  `props.bool` read them, and `props["key"]` gives the value as it is. A prop the node does not set is absent.
- The node's `style` and conditions work as on any node: the style sets the frame, padding, colors and font around
  the view, which inherits the foreground color and the tint.
- The file is compiled into the widget extension, which draws the views, and into the app, so the plugin can tell
  which names have a view. Keep the class name and `@objc(TauriLiveActivityCustomViews)`: the widget and the plugin
  find the table by it. Mark your views `@available(iOS 16.1, *)` when they use newer SwiftUI, because the app target
  may support an older iOS than the extension.
- The plugin's half, `LiveActivityCustomRegistry.swift`, and `LiveActivityWidget.swift` stay templates of the plugin,
  so a plugin update replaces them while your views stay.
- A node whose name has no view draws nothing. On iOS the record names it in `degradedFeatures` as
  `layout.custom.<name>`, for every such name of the layout, as long as ActivityKit reports the activity. Android
  draws no custom view and lists `layout.custom`.
- The validators check the name (the asset name rule) and the props, not the view: what it draws, how much memory it
  takes and whether it compiles are yours to test. A Live Activity has no network; draw with shapes, text and images
  of the extension, and leave out timers and animations of your own.

The ring in the captures is this view, with `level` bound to a value: 35% at start, 80% after the update.

### The whole widget

The last resort is to edit `src-tauri/gen/apple/LiveActivityWidget/LiveActivityWidget.swift`, the copy of the
plugin's template, and draw `context.state.values` your own way. Keep `ActivityConfiguration(for:
LiveActivityLayoutAttributes.self)` and the extension's `TauriLiveActivityLayout` = 2. What you give up:

- `setup` keeps a file that differs from the template and says so on every run; fixes and features of later
  templates, such as the bound tints of 0.3.0 or custom views, are yours to merge by hand.
- The plugin draws nothing of the layout any more: the validators still check every request, but what the widget
  shows for it is your code, outside the shared fixtures and the plugin's tests.
- `degradedFeatures` describes the plugin's widget, not yours.

### Limits

- A Live Activity runs in a sandbox of its own with no network and no location (Apple: "unlike a widget, a Live
  Activity can't access the network or receive location updates"). Everything it shows must be in the extension,
  in the payload, or in the App Group container.
- Apple does not publish the memory limit of the widget extension. A decoded image takes 4 bytes per pixel, so a
  picture of 1224 × 480 takes about 2.3 MB; keep few of them on screen.
- Images of a Live Activity must be no larger than the presentation (Apple); `writeImage` holds to 1 MiB and
  1224 × 480 pixels, the largest Lock Screen presentation at @3x. The Lock Screen is 160 points high at most and a
  compact island part about 36 points.
- Fonts must be bundled in the extension; the extension cannot load the app's fonts or download one.
- Drawn images need the App Group, configured in both targets, which a device build registers with your Apple
  account once.
- The validators check a custom node's name and props; the view itself is not checked.
- Android shows a standard notification for a Live Update: no fonts, no styles, no custom views and no asset
  images. A drawn image becomes the large icon.
- Layout, styles and values share the weight limit of 3584, custom props and font names included; each update sends
  every value again.

## Templates: progress and timer

Request contract v1 has two fixed templates. The plugin's widget draws them on iOS, with a
title, a status and a bar or a countdown; Android shows them as a notification.

### Progress template

```ts
import { getCapabilities, requestPermissions, start, update, end } from 'tauri-plugin-live-activity';

const { platform } = await getCapabilities();
await requestPermissions(platform === 'android' ? 'notifications' : 'liveActivities');

const snack = await start({
  activityKey: 'mochi:snack',
  schemaVersion: 1,
  template: 'progress',
  fallback: 'notification',
  snapshot: { revision: 0, title: 'Mochi’s snack delivery', status: 'Packing a tiny treat', progress: 0.15 },
});
await update({
  id: snack.id,
  snapshot: { revision: 1, title: 'Mochi’s snack delivery', status: 'On the way to Mochi', progress: 0.65 },
});
await end({ id: snack.id, policy: { kind: 'immediate' } });
```

Each update sends a complete snapshot with a higher revision. `list()` finds the activities
again after a restart.

<table>
  <tr><th>iOS 26.3 simulator</th><th>Android 16 emulator</th></tr>
  <tr>
    <td><img src="images/ios-v1-progress.png" width="400" alt="Mochi's snack delivery at 65% on the iOS Lock Screen"></td>
    <td><img src="images/android-v1-progress.png" width="400" alt="Mochi's snack delivery with a progress bar in the Android notification shade"></td>
  </tr>
</table>

On iOS the cat comes from the demo's own widget. The plugin's template shows the same title,
status and bar.

### Timer template

```ts
import { start } from 'tauri-plugin-live-activity';

const now = Date.now();
await start({
  activityKey: 'mochi:nap',
  schemaVersion: 1,
  template: 'timer',
  fallback: 'notification',
  snapshot: {
    revision: 0, title: 'Mochi’s nap', status: 'A little snooze, a little peace',
    timer: { startedAt: now, endsAt: now + 5 * 60_000 },
  },
});
```

Times are Unix milliseconds. The system counts down; the app sends nothing per second.

<table>
  <tr><th>iOS 26.3 simulator</th><th>Android 16 emulator</th></tr>
  <tr>
    <td><img src="images/ios-v1-timer.png" width="400" alt="Mochi's nap counting down from 4:48 on the iOS Lock Screen"></td>
    <td><img src="images/android-v1-timer.png" width="400" alt="Mochi's nap with the countdown in the Android notification header"></td>
  </tr>
</table>

## Plugin configuration

`plugins.live-activity` in `tauri.conf.json` is optional:

```json
{ "plugins": { "live-activity": { "receipts": "redacted", "android": { "samsungNowBar": true } } } }
```

- `receipts`: iOS stores a receipt of each accepted request, so that a late ActivityKit read
  cannot bring back an older revision, also after a restart. `full`, the default, keeps the
  snapshot and its text. `redacted` keeps only a SHA-256 digest of it; a digest hides only
  values that cannot be guessed. Android ignores the option for now and stores records in
  full in app-private preferences.
- `android.samsungNowBar`: the [Samsung Now Bar](#samsung-now-bar) extras; off when absent.

## Try the demo

<img src="images/ios-demo-picker.png" width="300" alt="The demo's Layouts tab with one chip per example">

The demo's Layouts tab starts each layout example of this page. From the repository root,
with the mobile toolchain configured:

```sh
npm ci && npm run build:demo && cd examples/demo && npm run tauri -- ios dev
```

Use `android dev` for Android. The [demo's README](../examples/demo/README.md) has more.
