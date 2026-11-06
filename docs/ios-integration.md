# iOS integration

The backend uses ActivityKit on iPhone with iOS 16.1+ and iPad with iPadOS 17+.
iOS app compatibility mode on Mac is unsupported. The host application must
embed a WidgetKit extension. Installing the Rust crate or JavaScript package does
not add that Xcode target automatically.

## Add the widget

1. Enable `NSSupportsLiveActivities` (`Boolean`, `YES`) in the host application's
   Info.plist.
2. Add a Widget Extension target, with a minimum deployment target of iOS 16.1.
   Remove its generated widget entry point and add
   `templates/ios/LiveActivityWidget.swift` and
   `templates/ios/LiveActivityActionIntent.swift`. Use `templates/ios/Info.plist`
   as the extension Info.plist example.
3. Add this repository's `ios` Swift package as a local package reference. Link its
   **LiveActivityShared** and **LiveActivityUI** products to the widget extension.
   The plugin links `LiveActivityShared` into the host app through the Rust static
   library. Do not copy and redefine the attributes types in another Swift module.
4. Add `templates/ios/LiveActivityActionIntent.swift` to the host app target too,
   so the same file is a member of both targets. Link no package product to the
   app target: the package's objects are already in the Rust static library, and
   a second copy would duplicate symbols.
5. Give the extension an identifier under the app identifier, embed it in the
   host, and use the same signing team for device builds.

The template bundle contains two widgets: `LiveActivityWidget` draws v1
activities (`start`, templates `progress` and `timer`) and
`LiveActivityLayoutWidget` draws layout activities (`start_layout`, request
contract v2). A host that keeps its own v1 widget, like the sample app's
`MochiWidget.swift`, can add `LiveActivityLayoutWidget` to its bundle the same way.

The package's Tauri dependency at `.tauri/tauri-api` is prepared by Tauri's Cargo
plugin build. Before resolving the widget's local Swift package in Xcode, run
this from the host application's `src-tauri` directory with its iOS toolchain
configured:

```sh
cargo check --target aarch64-apple-ios-sim
# On an Intel Mac, use --target x86_64-apple-ios instead.
```

This prepares the Tauri Swift dependency before Xcode attempts package resolution.
For a registry installation, locate the installed crate using `cargo metadata`;
its `ios/` directory is the package location. The Rust crate includes both the template files under `templates/ios/` and the
native Swift package under `ios/`. The npm package supplies the JavaScript API.

The sample app's generated `project.yml` includes `LiveActivityWidget` and links
`LiveActivityShared`. It uses `examples/demo/widget/MochiWidget.swift` for its cat
design; the generic template remains available for other apps.
Regenerating the entire Tauri iOS project can replace manual
Xcode changes. Keep the widget target, package reference, intent file membership
and Info.plist properties in the source XcodeGen specification used for your app.

No App Group, push token, or remote notification entitlement is needed for this
local progress/timer implementation. The plugin does not request ordinary
notification permission on iOS. If Live Activities are disabled,
`requestPermissions('liveActivities')` returns `settingsRequired`;
there is no repeated permission prompt or automatic settings redirect.

## Layout activities

`start_layout` requires an embedded app extension whose Info.plist sets
`TauriLiveActivityLayout` to the integer `2` (`Number` in Xcode's editor).
Without one it answers `CONFIGURATION_REQUIRED`
("Embed a widget extension built from the layout template."). The template
Info.plist sets the key; add it to your own extension's Info.plist when you
embed `LiveActivityLayoutWidget` there. `getCapabilities()` reports
`layout: 'supported'` on every device that supports Live Activities.

`LayoutView` (product `LiveActivityUI`) draws one region of the layout with the
current values. Absent island parts get the defaults of the contract: the
expanded island shows the lock screen tree in its bottom region, the compact
leading and minimal parts show the lock screen's first `symbol` (or
`circle.fill`), and the compact trailing part is empty. `background` becomes
`activityBackgroundTint` and `keyline` becomes `keylineTint`.

Rendering notes:

- Style members apply in this order: font and text members, `color`, `tint` and
  `buttonStyle`, `padding`, `frame`, `background`, `cornerRadius`, `opacity`.
  Members a style leaves out keep the values inherited from the parent.
- `text` shows its string as given, without localization or Markdown.
- `image` names an image in the widget extension's asset catalog; an unknown
  name draws nothing.
- `timerText` uses `Text(timerInterval:countsDown:)`. In a widget it is
  horizontally flexible; give it a `frame` when it shares a row.
- `progress` is a linear or circular `ProgressView`; `gauge` uses the accessory
  linear or circular capacity style.
- `path` is scaled to fit its frame, keeping the aspect ratio of its `box`; it is
  stroked when `stroke` is set and filled otherwise, in the foreground color.
- A `{ "light", "dark" }` color follows the color scheme the system draws the
  activity with, the background tint included (`Color(_:scheme:)`). The Dynamic
  Island is always dark, so `keyline` uses the dark color.

### Buttons

A `button` node needs iOS 17 or later; `getCapabilities()` reports
`actions: 'supported'` there. Below iOS 17 the widget shows the button's label
without the button.

A tap runs `LiveActivityActionIntent`, a `LiveActivityIntent`, in the app process.
The intent posts `tauri.live-activity.action` through `NotificationCenter` with
the activity id and the action id. The plugin observes that notification from
the moment it is created, acknowledges it, and sends
`{ actionId, activityId, activityKey? }` to Rust on a background queue. Rust
calls every `on_action` handler on a plugin thread and then emits
`live-activity://action` for `onAction` listeners in the web view.

- When the system launches the app for a tap, the plugin may not exist yet, and
  Tauri may never create a web view or run `setup()`. The intent posts again every
  100 ms for up to 5 s until the plugin acknowledges. Up to 16 taps wait in the
  plugin until Rust has registered its channel, and Rust keeps taps that arrive
  before the first `on_action` handler.
- Xcode builds App Intents metadata only for targets it compiles. The plugin's
  Swift code is inside the Rust static library, so the app target needs its own
  copy of the intent, and the widget needs one to build `Button(intent:)`. Keep
  the type name: the system identifies the action by `LiveActivityActionIntent`.
- The intent's `authenticationPolicy` is `.alwaysAllowed`. Apple's pages do not
  settle whether a locked iPhone runs a Live Activity button without unlocking;
  check it on a device.
- A tap does not change the activity. Update it from the handler if the button
  should change.

## Receipts

ActivityKit publication can lag an awaited update. The plugin stores receipts of
accepted requests in the app's Application Support directory, under
`tauri-live-activity/receipts-v2.json`, and merges them with OS lifecycle state.
This prevents a delayed OS read from accepting an older revision, including after
an app restart. One file holds both contract versions. Each version keeps at most
256 receipts, of which at most the latest 128 are terminal; the file is limited
to 2 MiB. It is written atomically with iOS file protection until first unlock.
The containing directory is excluded from cross-app access by the sandbox.

The plugin configuration chooses what a receipt contains:

```json
{ "plugins": { "live-activity": { "receipts": "redacted" } } }
```

- `full` (the default, also without a `live-activity` entry): the accepted
  snapshot, including the text displayed in the activity. Do not put secrets in
  that text.
- `redacted`: only the SHA-256 digest of the snapshot's sorted-keys JSON. The
  revision floor (`STALE_REVISION`), the same-revision check (an equal digest is
  an idempotent success, a different one is `CONFLICT`), terminal receipts and
  end idempotency survive a restart. Within one process the accepted snapshot is
  kept in memory. After a restart, `list` and a repeated `end` report what
  ActivityKit shows; an ended activity that ActivityKit no longer lists is
  reported at the receipt's revision with an empty snapshot (empty title and
  status in v1, `values: {}` in v2). Loading in this mode rewrites stored
  snapshots as digests.

Layouts are never stored in receipts. On the first load, a
`tauri-live-activity/receipts-v1.json` written by earlier versions is converted
and deleted, which also removes its plaintext in redacted mode. A v1 file that
cannot be read is an error and is kept. If such a file appears again, for
example after a downgrade, its entries are merged and replace those with the same
id.

## Runtime behavior

Start activities while the application is in the foreground. `progress` and
`timer` use the same shared Codable attributes and state in both binaries.
`staleAt` requires iOS 16.2; iOS 16.1 returns `UNSUPPORTED_FEATURE` when it is used.
It is sent as ActivityKit's `staleDate`. The returned `state` follows ActivityKit's
observed lifecycle; it does not promise a `stale` transition at an exact clock time.
On the tested iOS 27.2 simulator, foreground and background probes did not observe
that transition within their observation window. See
[iOS coverage](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-coverage.md).
The `after` dismissal policy must be in the future and no more than four hours
away. Immediate and default dismissal are also available. Layout activities
follow the same rules.

A successful native request does not prove that the UI is visible. All results
retain `visibility: 'unknown'`. Listing does not report locally saved activities
as active when ActivityKit no longer reports them. Repeating `end` is idempotent
while the terminal receipt is retained or the OS still reports that terminal
activity. Evicted or unknown IDs return `NOT_FOUND`. A new start after completion
receives a new handle. Remote pushes and lifecycle event subscriptions are outside
this alpha release; call `list()` when returning to the app.

## Reproduce local tests

```sh
tests/ios/run-core.sh
```

This compiles the shared model and lifecycle core with a deterministic in-memory
OS adapter used only in tests. It checks revisions, conflicting retries, async
serialization, template validation, payload size, permission failures, missing
OS activities, disk-backed restart/end recovery, receipt redaction and migration,
and every case of `tests/fixtures/layout-requests.json`. LLVM coverage must be at
least 80% for lines, functions, and regions. These metrics exclude the ActivityKit
adapter, Tauri bridge, and widget rendering.

The real native harness is under `tests/ios/SimulatorHost`. It compiles the
production ActivityKit adapters, the action hub and the lifecycle core, links the
shared Swift module, and embeds the production widget template with the layout
interpreter. The intent template is a member of the app and the widget, as in a
host app:

```sh
xcodegen generate --spec tests/ios/SimulatorHost/project.yml
xcodebuild \
  -project tests/ios/SimulatorHost/LiveActivityNativeTests.xcodeproj \
  -scheme LiveActivityNativeTests \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/live-activity-native-host \
  CODE_SIGNING_ALLOWED=NO build
```

Install its `.app` with `xcrun simctl install`, then launch
`io.github.eedaegon.LiveActivityNativeTests`. It writes the current stage to
`Documents/result.json` in its own data container. Lock the simulated device while
it shows `updated` to inspect the actual widget. Return to the app so its local
task can complete the immediate-end check. Native simulator coverage does not
establish device signing, APNs, low-power behavior, or physical-device support.

Launch arguments select the layout scenarios:

- `-scenario layout` ends activities that earlier runs left, starts a layout
  activity with a Stop button in redacted receipt mode, updates it, checks
  recovery from a second controller and that the receipt file holds none of its
  text, waits up to two minutes for a tap, and ends the activity after the action
  arrived from the production action hub, off the main thread.
- `-scenario fixtures` sends every case of `tests/fixtures/layout-requests.json`
  through the plugin's argument decoding, controller and reply mapping, and draws
  every region of every valid start with `LayoutView`.

`NativeUITests/LayoutScreen` drives both on a simulator with iOS 17 or later.
`testLayoutButtonReachesApp` reads the activity's texts on the Lock Screen, taps
Stop and waits for the app to report the action:

```sh
xcodebuild test \
  -project tests/ios/SimulatorHost/LiveActivityNativeTests.xcodeproj \
  -scheme LiveActivityNativeTests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:NativeUITests/LayoutScreen
```

## Validation record

On 2026-11-04, Xcode 27.2 built the full Tauri Swift plugin package for arm64 and
x86_64 iOS simulators with the package's iOS 15 deployment target and runtime
16.1 availability gates. The native widget host built and ran on an iPhone 18 Pro
simulator with iOS 27.2. An initial test exposed delayed ContentState observation
after `update`; the accepted-state receipt fix was added and its regression tests
passed. The real native lifecycle harness then passed all six checks: start, duplicate start,
update, state recovery, immediate end, and rejection of updates after end. Actual Lock Screen rendering showed `Downloading files`,
`65 of 100 files`, and 65% progress.

The full Tauri demo then passed all 13 JavaScript → Rust → Swift lifecycle checks.
The sanitized persisted report is in `tests/ios/results/tauri-lifecycle.json`.
XCTest drove the real WebView button; these were not mocked IPC calls.

The Swift shared model/lifecycle suite passed 36 assertions with 98.05% line,
94.92% region, and 97.10% function coverage at that checkpoint. Exact current
coverage is printed by the test script. iOS 16.1/16.2 branches are compiled but
have not been run on those older OS versions.

On 2026-11-06, on an Intel Mac with Xcode 26.3 (iOS 26.2 SDK), the package's
`tauri-plugin-live-activity` and `LiveActivityUI` schemes built for the iOS
simulator without warnings. A release `swift build` of the whole package with
the flags swift-rs passes, for an iOS 15.0 simulator target, built every target;
its `libtauri-plugin-live-activity.a` holds no `LiveActivityUI` object. The
native harness ran on an iPhone 17 Pro
simulator with iOS 26.3 (x86_64). Both bundles carried App Intents metadata for
`LiveActivityActionIntent`. Every layout fixture took the plugin path with the
expected result, and every region of every valid start rendered. On the Lock
Screen the layout activity showed its title, bound status, progress, timer and
Stop button. A tap on Stop ran the intent in the app process and reached the
action hub, and the app ended the activity. The v1 Lock Screen test passed
unchanged. On that simulator the system drew the Lock Screen activity in its dark
scheme in both appearances; with a dynamic `UIColor` as background tint, the
light appearance had shown a light background behind white text, which is why
color pairs are resolved from the view's color scheme. Locked-device behavior
of the button was not tested.

References: [Apple ActivityKit](https://developer.apple.com/documentation/activitykit),
[Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/).

The README screenshot is a direct simulator capture of two running examples,
without mock UI or test-result overlays. The download widget comes from the native
production-adapter harness; the order widget comes from the actual Tauri demo's
Start activity button. XCTest verified the visible order title and accepted the
system's Live Activity prompt before the capture.
