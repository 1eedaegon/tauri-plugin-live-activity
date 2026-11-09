# Changelog

## Unreleased

- CI runs the two simulator suites only when started by hand (`gh workflow run ci.yml -f simulator=true`); a push or
  a pull request no longer waits 30 to 50 minutes for a hosted runner to rebuild the demo. They run on a Mac before
  the push.

## 0.4.0

iOS moves onto the [activitykit](https://crates.io/crates/activitykit) crate, which was split out of this plugin's iOS
code. The plugin has no Swift of its own any more: its Rust commands call activitykit, whose build script builds its
Swift bridge into the app's Rust library, and the widget extension links activitykit's Swift products. Requests,
records, revisions and taps keep the behaviour of 0.3. On Android the progress and timer templates move onto the
[liveupdate](https://crates.io/crates/liveupdate) crate, run from the plugin's Rust; layouts keep their Kotlin
side. Desktop works as before.

On an iPhone 16 with iOS 27.2 the layouts, updates while locked and buttons ran from an app on this release. A button
on a locked phone that Face ID has not matched waits for an unlock, as a native app's `.alwaysAllowed` intent does
([iOS integration](docs/ios-integration.md#buttons)).

- iOS: the commands call activitykit 0.1 directly. The Tauri Swift plugin and the copied Swift packages (`ios/`,
  `LiveActivityShared`, `LiveActivityCore`, `LiveActivityUI`, `LiveActivityPlugin`) and the templates under
  `templates/ios` are gone. activitykit also fixes what 0.3's Swift got wrong: ActivityKit's `unsupported`,
  `unsupportedTarget` and `visibility` refusals keep their codes, the start's preflight no longer depends on the app's
  state, `pending` is a state, `End::after` takes any time, an end can carry final content, and every content has a
  timestamp.
- Revisions, repeated starts and receipts work as in 0.3: each start, update and end goes out at the request's
  revision, the same keyed start returns the running activity (also after a relaunch), and `receipts: "redacted"`
  keeps a digest instead of the values. After a relaunch, a redacted activity's record has the values that ActivityKit
  shows, where 0.3 reported none.
- On iOS a blocking method of `app.live_activity()` called on the main thread, where activitykit answers, returns
  `NATIVE_ERROR` at once instead of waiting for an answer that cannot come.
- A tap's intent, and so an app that the system launched for the tap, waits until the `on_action` handlers have run
  and the tap has gone to JavaScript, at most 4 seconds, on iOS as on Android. JavaScript listeners are not awaited.
- Breaking: iOS needs 16.2 on an iPhone (iPadOS 17 on an iPad). Below it every command but the reads answers
  `UNSUPPORTED_PLATFORM`, and `getCapabilities()` reports the features as unsupported.
- Breaking: an end can carry final content. `end_layout` takes `LayoutEndInput { id, policy, snapshot }` in Rust, and
  `endLayout` takes `LayoutEndInput`, which is `EndInput` with an optional `snapshot`, in TypeScript. On iOS an end
  without a snapshot ends with the last accepted values at the next revision, so its record has one revision more.
- Breaking: `LayoutSnapshot` has an optional `timestamp`, the time the content was made, which ActivityKit uses on
  iOS 17.2 to drop older content, and which iOS records carry. A struct literal needs `timestamp: None`.
- Breaking: `ActivityState` has `Pending`, and the Rust enum is `#[non_exhaustive]`: a match needs a `_` arm.
  TypeScript's `ActivityState` adds `'pending'`.
- Breaking: the error code `NOT_FOREGROUND`, for a start that ActivityKit refuses while the app is not in the
  foreground (it was `NATIVE_ERROR` or `PERMISSION_DENIED`). `UNSUPPORTED_FEATURE` and `SYSTEM_LIMIT` messages name
  the feature and the limit.
- Breaking: the extension's Info.plist keys are activitykit's, `ActivityKitLayout` and `ActivityKitAppGroup`, and
  activitykit keeps receipts in `activitykit/receipts-v2.json` and drawn images in `activitykit/images` of the App
  Group. Activities that 0.3 started are not listed by 0.4: end them before the update, or the system ends them
  within 8 hours.
- Breaking: the progress and timer templates of contract v1 are layout activities on iOS, with a fixed layout like
  0.3's template widget, so `ActivityKitLayoutWidget` draws them and a widget of the app's own for them no longer
  applies. `start`, `update`, `end` and `list` keep their requests and records. A v1 and a v2 activity can no longer
  share an activity key.
- Breaking: the plugin's setup fails when the process already runs activitykit with other receipts than the plugin
  configuration names.
- Breaking: on an app whose `live-activity.yml` was changed by hand, setup keeps the spec and the old
  `LiveActivityActionIntent.swift` and `LiveActivityCustomRegistry.swift` that it names, and reports how to finish
  the migration by hand.
- Breaking: the value key `liveActivityTemplate` is the plugin's, which marks the progress and timer templates on iOS.
  A layout start, update or end whose values hold it answers `INVALID_INPUT` on every platform.
- Breaking: after a relaunch, ending again an activity that ended at once in an earlier launch, and that the system no
  longer lists, is `NOT_FOUND`; 0.3 answered the record. Within a launch, ending again answers the record for the
  last 64 activities that ended; an older one that the system no longer lists is `NOT_FOUND` too.
- `npx tauri-plugin-live-activity setup` finds activitykit's folder with `cargo metadata` and writes
  `live-activity.yml` on its Swift package: the widget extension (iOS 16.2) links `ActivityKitWidget` and
  `ActivityKitViews`, and the app target links `ActivityKitIntent` and `ActivityKitViews` and compiles the custom
  views file. It writes activitykit's widget template as `LiveActivityWidget.swift`. On an app that 0.2 or 0.3 set
  up, it removes `LiveActivityActionIntent.swift` and `LiveActivityCustomRegistry.swift`, replaces the old widget
  file, gives `LiveActivityCustomViews.swift` activitykit's names (your views stay), and writes the new Info.plist
  keys with the App Group it had. A file changed by hand is kept and reported as a step to do. A second run changes
  nothing.
- Rust: the layout types (`Node`, `Element`, `Style`, `Island`, `Bound`, `Bindable`, `Color`, `Value` and the rest)
  are activitykit's, under the same names and with the same JSON, and gain activitykit's builder methods. `Layout` is
  activitykit's `contract::LayoutRegions`. The plugin's validator is activitykit's; `LayoutStartInput::validate_end`
  is new.
- Request contract v2 is activitykit's: `contracts/request.schema.json` and `tests/fixtures/layout-requests.json`
  are its files, which `node tools/sync-contract.mjs --write` copies and a test compares. They add `timestamp` to
  snapshots, final content to `end_layout` and the `ends` fixtures. The reference validator adds
  `validateLayoutEnd`.
- Android: every activity runs on the liveupdate crate (0.1.2). The progress and timer templates of contract v1
  become its schema-v1 requests. Layouts become its schema-v2 presentations: the plugin's Rust chooses a template from
  the tree (Progress, Timer, BigText or Standard), projects the shown texts, progress, timer, up to three buttons, the
  first file image and the Samsung Now Bar lines, and keeps the layout request and its values in a file of its own;
  liveupdate keeps the lifecycle, the receipts and the notification. The plugin's Android library carries liveupdate's
  Android adapter, copied from the crate (`node tools/sync-liveupdate.mjs --write`); its own Kotlin lifecycle,
  renderer, receivers and validator are gone, with the notification channel `tauri.live-activity.v1` and the tag
  prefixes. Taps come from liveupdate's durable event queue: a tap stored while the app did not run arrives when the
  plugin starts, and the native side no longer waits for the handlers.
- Breaking: on Android, end running template activities before the update. 0.4 does not read the receipts that 0.3's
  Kotlin lifecycle stored, and a notification of 0.3 may stay posted.
- Android takes a snapshot's `timestamp` and keeps it in the record, and ends a layout activity with the final
  content of `end_layout`, checked as an update.
- The demo's widget is activitykit's template, its own Mochi widget for the templates is gone, and its Rust handler
  takes a second to count a pet, which the tap waits for. Launched with `--start-buttons`, it starts the Buttons
  example from Rust. The debug build of `tauri ios dev` on a simulator works as the build of `tauri ios build`: the
  page starts layouts, the widget draws them and their buttons reach Rust and the page.
- `docs/spec.md` lists every requirement with its tests, checked by `tools/spec-coverage.sh` in CI. The demo runs on
  an iOS Simulator of its own with `tests/ios/run.sh` (`MODE=dev` for `tauri ios dev`, with connected iPhones hidden
  from Tauri).
- CI caches the Rust builds and installs cargo-llvm-cov as a binary, and pins the Rust toolchain and XcodeGen (a
  release checked against its SHA-256). Two new macOS jobs run the simulator suite, on the demo of `tauri ios build`
  and on the demo of `tauri ios dev`. The built demo and UI tests are cached under a key of the tracked files they are
  built from, Xcode and the tools. A suite that passed in full is recorded as an artifact named after its inputs, the
  workflow file, what selects the suite (its mode, `ONLY` and the retries), the runner image and the simulator runtime
  (`tests/ci/cache.sh`, as in activitykit), and a later run with the same inputs, the push to main that merges a tested
  pull request included, skips it.

## 0.3.0

- Add bound style members to request contract v2. `{ "bind": "<value key>" }` can stand for a literal `color`, `background`, `tint`, `opacity`, `size`, `weight` or `cornerRadius` in a style, and for the layout's `background` and `keyline`. The member reads that value on every render, so `updateLayout` and `update_layout` change it while the activity runs. A bound color is a color name or a hex color, never a light and dark pair. The tree and the other members stay fixed at start.
- Rust, the reference validator, Swift and Kotlin check the value at start, and the native layers check it again on every update, with `INVALID_INPUT` when it does not fit. The fixture file adds start cases and an `updates` list of start and update pairs that all four run.
- TypeScript: `layout.bind(key)` and the types `LayoutBound` and `LayoutBindable<T>`. The reference validator adds `validateLayoutUpdate`.
- Rust: `Bound`, `Bound::key`, `Bindable<T>` and `LayoutStartInput::validate_update`. Breaking: the bindable `Style` fields and `Layout::background` and `keyline` are `Option<Bindable<_>>`; wrap a literal with `.into()`.
- iOS: the bindable members of `LayoutStyle` and `LayoutRegions` are `LayoutBindable`. `LayoutDocument.style(_:values:)`, `background(values:)` and `keyline(values:)` resolve them; `LayoutView` draws bound style members with the current values. The widget template passes the values to the two tints. A widget copied from the earlier template still compiles and draws a bound tint as absent; `setup` keeps a copy that differs: delete it and run `setup` again to take the new template.
- Android still draws no styles and lists them in `degradedFeatures`.
- A 0.2.x crate rejects bindings with `INVALID_INPUT`. Keep the npm package and the crate on the same minor version.
- The demo's Layouts tab adds **Changing styles**: an update turns the status red and bold when the snack runs late.
- Add custom fonts to request contract v2: the style member `fontFamily`, the PostScript or family name of a font that the widget extension bundles. With `font` the font takes that text style's size and scales with Dynamic Type, with `size` that size. It excludes `design` and takes no binding. A name the extension lacks draws the system font.
- `npx tauri-plugin-live-activity setup --font <file>` copies a font into `gen/apple/LiveActivityWidget/Fonts` and lists every font there under `UIAppFonts` in the extension's Info.plist, and prints the names a style can give. `--asset <file>` puts a PNG, JPEG, PDF or SVG into the extension's asset catalog, with `name@2x` and `name@3x` as scales of one asset. Both are repeatable and copy a file again only when it changed.
- Add images that the app draws: `image({ file: 'badge.png' })` in TypeScript, `ImageSource::file` in Rust, `{ "source": { "file": name } }` on the wire. `writeImage(name, png)` and `app.live_activity().write_image(name, &png)` check a PNG (at most 1 MiB and 1224 x 480 pixels, Apple's largest Lock Screen presentation at @3x) and write it into the App Group container, where the widget reads it on start and on every update. `check_image` checks one without writing it. The new command `write_image` has the permissions `allow-write-image` and `deny-write-image`; `setup` grants the first.
- `setup --app-group[=<id>]` gives the app target and the widget extension an App Group, `group.<app identifier>` unless named, through `live-activity.yml`, and names it in the extension's Info.plist under `TauriLiveActivityAppGroup`. Later runs keep it. Without one, `writeImage` fails with `CONFIGURATION_REQUIRED`. A device build needs the group in the Apple Developer account once; automatic signing registers it.
- Add the `custom` node: a SwiftUI view that the app registers by name in `LiveActivityCustomViews.swift`, which `setup` creates once and never writes again. Its `props` are literals or bindings, so an update redraws the view with new values. The validators check the name and the props; an unknown name draws nothing and is listed in `degradedFeatures` as `layout.custom.<name>`. TypeScript: `layout.custom(name, { props })` and `LayoutCustomNode`; Rust: `Element::Custom`.
- The widget template draws custom views through the new `templates/ios/LiveActivityCustomRegistry.swift`, which `setup` copies and which belongs in both targets, like the custom views file. A widget copied from an earlier template still compiles and draws custom nodes as nothing; delete it and run `setup` again to take the new template.
- Rust, the reference validator, Swift and Kotlin check `fontFamily`, `file` sources and `custom` nodes with the same rules; the shared fixtures add 23 valid starts, 62 invalid ones and 5 update pairs.
- Breaking: Rust's `ImageSource` is an enum (`ImageSource::Asset { asset }`, `ImageSource::File { file }`, with `ImageSource::asset` and `ImageSource::file`), `Style` has the field `font_family`, and `Element` has the variant `Custom`. Swift: `LayoutContent.image` and `LayoutRenderContent.image` take a `LayoutImageSource`, and both enums have a `custom` case.
- Android: the first shown image drawn from a file becomes the notification's large icon. Google's Live Update requirements do not name the large icon, so promotion stays. Custom views, fonts and asset images are left out and listed in `degradedFeatures`.

## 0.2.1

- Add `npx tauri-plugin-live-activity setup`, a command in the npm package with no dependencies. Run in a Tauri 2 app, it adds the plugin's permissions to the capability file and raises the Android minimum to API 26 in `tauri.conf.json` and in an existing `gen/android`. On a Mac with `src-tauri/gen/apple`, it sets `NSSupportsLiveActivities` in `src-tauri/Info.ios.plist`, copies the widget templates from the crate, writes `gen/apple/live-activity.yml` with the widget extension target and the button intent in both targets, includes it in `project.yml`, prepares the crate's Swift package and runs XcodeGen. A second run changes nothing. It keeps files that differ from what it would write and says so. `--dry-run` writes nothing; `--ios-only` leaves the capabilities and `tauri.conf.json` alone.
- The README is short: the demos, four install lines, one example and the layout nodes. The per-feature sections and the setup by hand moved to [docs/usage.md](docs/usage.md).

## 0.2.0

- Breaking: `init()` returns `TauriPlugin<R, Option<Config>>`. `Capabilities` has a new public `layout` field, so code that builds it with a struct literal no longer compiles. After 0.2.0 has run once on iOS, `receipts-v1.json` is gone, and an app that goes back to 0.1.x starts with no iOS receipts.
- Add request contract v2: a layout tree of nodes, a style table and a map of values. Rust, Swift and Kotlin apply the same rules and limits, including a weight limit of 3584 for layout, styles and values together, and are tested against one fixture file. The layout is fixed at start and updates send values only. Contract v1 is unchanged, and the two versions do not see each other's activities.
- Add the `start_layout`, `update_layout`, `end_layout` and `list_layout` commands with `allow-`/`deny-` permissions, the JavaScript functions `startLayout`, `updateLayout`, `endLayout` and `listLayout`, the JavaScript node builders under `layout`, and Rust methods of the same names. `live-activity:default` now also allows `list_layout`.
- Deliver taps on layout buttons to Rust `on_action` handlers and then to `onAction` listeners through the `live-activity://action` event. `onAction` uses Tauri's event permissions (`core:event:default`). `getCapabilities()` reports `actions` as supported on iOS 17+ and Android, and adds `layout`.
- Draw layouts on iOS with the new `LiveActivityUI` package product and the `LiveActivityLayoutWidget` widget in the template. The extension's Info.plist needs `TauriLiveActivityLayout` = `2`; without such an extension `startLayout` fails with `CONFIGURATION_REQUIRED`. Buttons need iOS 17 and `templates/ios/LiveActivityActionIntent.swift` in both the widget extension and the app target.
- Show layouts on Android as notifications: title, body, progress bar, chronometer and up to three actions. Everything else is listed in `degradedFeatures`. `android.visibility` sets the lock screen visibility.
- Add the optional plugin configuration `plugins.live-activity`: `receipts` (`full` or `redacted`) chooses what iOS receipts keep, and `android.samsungNowBar` adds One UI's Now Bar text extras to layout notifications on Android 17+. Neither puts an app on Samsung's Now Bar allow list. An unknown key or a wrong type makes plugin setup fail when the app starts.
- Move iOS receipts to `receipts-v2.json`, which holds both contract versions; the earlier `receipts-v1.json` is converted and deleted on first load.
- On desktop, the layout commands check their input and then return `UNSUPPORTED_PLATFORM`, like the v1 commands.
- Enable serde_json's `float_roundtrip` feature, so Rust reads a number as JavaScript wrote it. Cargo turns it on for every crate in the app's build that uses serde_json.
- The publish workflow now also moves npm's `next` tag to a stable release when `next` is missing or lower, so after a stable release `tauri-plugin-live-activity@next` installs that release or a newer prerelease. This step never moves `next` back.

Push updates, lifecycle event subscriptions and desktop backends are not included.

Android's instrumented tests passed on API 26 and API 36 emulators and on a Galaxy S23 with Android 17, and the 80% Android line coverage gate passed on each. On the S23, four tests that open a test activity were left out. [The 0.2.0 validation record](docs/validation.md) lists what was and was not tested.

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
