# iOS integration

On iOS the plugin's commands run on the [liveactivity](https://github.com/1eedaegon/liveactivity-rs) crate, whose
iOS backend calls the [activitykit](https://github.com/1eedaegon/activitykit-rs) crate, and the plugin has no Swift of
its own. activitykit's build script builds its Swift bridge, `ActivityKitBridge` (the C
functions, the lifecycle with its receipts, and the ActivityKit calls), into the app's Rust library. What the app adds
in Xcode is a widget extension that draws the activities and a little Swift in the app target; both link products of
activitykit's Swift package. Installing the crate or the npm package does not add them:
`npx tauri-plugin-live-activity setup` does, for the Xcode project that Tauri generates
([Usage](usage.md#what-setup-does)).

Live Activities need iOS 16.2 on an iPhone and iPadOS 17 on an iPad; buttons need iOS 17. Below that every command
but the reads answers `UNSUPPORTED_PLATFORM`, and `getCapabilities()` reports every feature as unsupported. An iOS app
running on a Mac is unsupported too.

```text
JavaScript, Rust -> the plugin's commands -> liveactivity (Rust) -> activitykit (Rust) -> ActivityKitBridge (Swift, in the Rust library) -> ActivityKit
Lock Screen, Dynamic Island <- the widget extension: ActivityKitLayoutWidget (product ActivityKitWidget)
A tap -> ActivityKitActionIntent in the app (product ActivityKitIntent) -> activitykit's events -> liveactivity -> on_action -> onAction
```

The iOS logic is the liveactivity crate's iOS backend: it checks every request against the contract before
activitykit sees it, keeps templates and layouts apart, builds the records, turns the progress and timer templates
into layouts, keeps the handles of the activities it ended and reads the kit's events; lookups by id, the revision
rules and repeated starts are activitykit's. The plugin's own iOS code is
`src/ios.rs`: it builds activitykit's kit from the plugin configuration (the receipts and the push-to-start watch)
and connects that backend to the commands, to Tauri's events and to the handlers of `on_action`.

## Set up by hand

`setup` does these steps for Tauri's generated project; [Usage](usage.md#set-up-by-hand) has them as commands and the
XcodeGen spec. Do them yourself for a project that `setup` leaves alone, such as one that already has a widget
extension.

1. Find activitykit's folder. It is a dependency of the plugin, so `cargo metadata` lists it (the package named
   `activitykit`). Its `swift` folder is the Swift package; add it as a local package reference. The folder is in
   Cargo's registry and names activitykit's version, so its path changes when the plugin moves to another one.
2. Set `NSSupportsLiveActivities` (`Boolean`, `YES`) in the app's Info.plist. In a Tauri app that is
   `src-tauri/Info.ios.plist`, which Tauri merges when it builds.
3. Add a Widget Extension target with a deployment target of iOS 16.2. Link the `ActivityKitWidget` product, and
   `ActivityKitViews` for custom views. Replace its Swift files with activitykit's `templates/ios/Widget.swift`, which
   `setup` writes as `gen/apple/LiveActivityWidget/LiveActivityWidget.swift`:

   ```swift
   import ActivityKitWidget
   import SwiftUI
   import WidgetKit

   @main
   struct Widgets: WidgetBundle {
       var body: some Widget {
           ActivityKitLayoutWidget()
       }
   }
   ```

4. In the extension's Info.plist, set `ActivityKitLayout` to the integer `2` (`Number` in Xcode's editor).
5. Link the `ActivityKitIntent` product (buttons) and the `ActivityKitViews` product (custom views) to the app
   target, and have the app target compile at least one Swift file. `setup`'s `LiveActivityCustomViews.swift` is that
   file; the demo compiles a file whose only code is `import ActivityKitIntent`. Xcode extracts the App Intents metadata
   of a linked package product only for a target that compiles Swift. Without it a button does nothing.
6. Link no other activitykit product to the app target, and never link `ActivityKitBridge` in Xcode: the Rust library
   holds the bridge already, and a second copy would duplicate its symbols. Do not define an `ActivityKitActionIntent`
   of your own; Xcode refuses an intent that conflicts with one of a linked package.
7. Give the extension an identifier under the app's (`setup` uses `<app identifier>.widget`) and the app's version,
   embed it in the app, and use the same signing team for device builds.

Regenerating Tauri's iOS project replaces changes made in Xcode. Keep the widget target, the package reference, the
products, the source files and the Info.plist keys in the XcodeGen spec of your app, as `setup` does with
`gen/apple/live-activity.yml`.

activitykit's [iOS setup](https://github.com/1eedaegon/activitykit-rs/blob/main/docs/ios-setup.md) has the rest for an
app target that does not come from Tauri: the Swift runtime's search paths and `IPHONEOS_DEPLOYMENT_TARGET` while
cargo builds.

## Info.plist keys

| Key | Target | Value |
| --- | --- | --- |
| `NSSupportsLiveActivities` | app | `YES`. Without it a start answers `CONFIGURATION_REQUIRED` |
| `ActivityKitLayout` | widget extension | The integer `2`. A start checks that an embedded extension carries it and answers `CONFIGURATION_REQUIRED` otherwise |
| `ActivityKitAppGroup` | widget extension | The App Group for images the app draws; only with `writeImage` |
| `UIAppFonts` | widget extension | The fonts the extension bundles, for `fontFamily` |

0.2 and 0.3 named the extension's keys `TauriLiveActivityLayout` and `TauriLiveActivityAppGroup`; 0.5 reads neither.

## Pictures the app draws

`writeImage` needs an App Group that both targets have in `com.apple.security.application-groups` and that the
extension names under `ActivityKitAppGroup`. `setup --app-group` configures it. activitykit writes the PNG to
`activitykit/images` in the group's container, and the widget reads it from there each time it draws. Without the
group `writeImage` fails with `CONFIGURATION_REQUIRED`. A simulator needs nothing more; for a device the group has to
exist in your Apple Developer account, which automatic signing registers once. Images that 0.3 wrote lie in
`tauri-live-activity/images` and are not read any more: write them again.

## Fonts and asset images

A `fontFamily` names a font that the extension bundles and lists under `UIAppFonts`; an `image` with an `asset` names
an image of the extension's asset catalog. `setup --font` and `setup --asset` add both. A font name the extension
lacks draws the system font, and an unknown asset draws nothing; neither is reported.

## Custom views

A `custom` node draws a SwiftUI view that the app registers in `LiveActivityCustomViews.swift`, a subclass of
activitykit's `ActivityKitCustomViewRegistry` with the Objective-C name `ActivityKitCustomViews`. The file is compiled
into both targets, and both link `ActivityKitViews`: the widget draws the views, and activitykit in the app reads which
names have one and lists the others in `degradedFeatures` as `layout.custom.<name>`. Without the class in the app
target every name is listed. Keep the Objective-C name; the Swift class name may stay `LiveActivityCustomViews`.
[Usage](usage.md#custom-swiftui-views) has an example.

## Buttons

A `button` node needs iOS 17; `getCapabilities()` reports `actions: 'supported'` there. Below iOS 17 the widget shows
the button's label without the button.

A tap runs activitykit's `ActivityKitActionIntent`, a `LiveActivityIntent`, in the app process. When the app was not
running, the system launches it in the background. The intent posts the tap to activitykit's bridge for at most 5
seconds. The plugin creates its `ActivityKit` at plugin setup and reads its events on a thread of its own from then
on. It calls every `on_action` handler on a plugin thread, one tap after another, emits `live-activity://action` with
`{ actionId, activityId, activityKey? }` for `onAction` listeners, and only then lets go of the tap's acknowledgement:
the intent, and so an app that the system launched for the tap, waits for the Rust handlers, at most 4 seconds after
the tap. Taps go through the handlers one after another, and each tap's 4 seconds run from its own tap, so a slow
handler uses up the time of the taps behind it. `onAction` listeners are not awaited; a webview handler is asynchronous
and may not run at all while the web view is suspended. Taps that come before the first handler wait for it, the newest
16, but their intent does not.

- Register `on_action` handlers on the built `App` before `App::run`, or in the setup of a plugin, and not in
  `Builder::setup`: when the system launches the app for a tap, Tauri may never run it, and may create no web view
  for `onAction`.
- The intent's `authenticationPolicy` is `.alwaysAllowed`, yet on an iPhone 16 with iOS 27.2 a tap on a locked phone
  that Face ID has not matched makes the system ask to unlock first; the intent runs once the owner is authenticated.
  With Face ID matched and the Lock Screen still up it runs at once. A native app's own `.alwaysAllowed` intent
  behaved the same ([Validation record](#validation-record)).
- A tap does not change the activity. Update it from the handler if the button should change.

## Permissions

No ordinary notification permission is needed, and no push entitlement unless the app uses [pushes](#pushes). An App
Group is needed only for `writeImage`. Live Activities are a switch in the system's Settings, and the plugin has no
prompt of its own:

- `checkPermissions()` reports `liveActivities` as `granted` when they are on, `denied` when they are off, and
  `notApplicable` where the device has none. `notifications` and `promotion` are `notApplicable`; `frequentPushes`
  is the switch for frequent pushes, `granted` or `denied`, `notApplicable` where there are no Live Activities.
- `requestPermissions('liveActivities')` reports `settingsRequired` instead of `denied`. Another kind fails with
  `UNSUPPORTED_FEATURE`.
- While the app runs, a change of either switch in Settings comes to `onPermissions` with the new permissions.
- `getCapabilities()`: with Live Activities supported, every feature but `actions` is `supported`, and `actions`
  follows iOS 17. Without them every feature is `unsupported` and the backend `unsupported`. `maxPayloadBytes` is 4096.

## Starts, updates and ends

- A start needs the app in the foreground. ActivityKit refuses a start from the background, which answers
  `NOT_FOREGROUND`; a start right after the app left the foreground may still succeed.
- The system ends an activity after 8 hours and removes it from the Lock Screen after 12.
- Every start, update and end goes out at the request's revision, as in 0.3. activitykit's Swift layer takes a higher
  revision than the accepted one, answers the accepted one with the same values and stale date as done, and refuses a
  lower one (`STALE_REVISION`) or the accepted one with other values (`CONFLICT`). An end without a snapshot ends at
  the next revision with the last values.
- While an activity of a key runs, the same start returns it, also after a relaunch (activitykit compares the content
  without its timestamp), and a different start under the key answers `CONFLICT`. After an end the key starts a new
  activity with a new id.
- Commands find an activity by its id through activitykit, which asks ActivityKit when it has no handle. An id that
  neither knows answers `NOT_FOUND`, and so does an update of an ended activity.
- A snapshot's `timestamp` goes to activitykit as the content's time; without one activitykit takes the time it sends
  the content, and a start's content is always timed then. From iOS 17.2 ActivityKit drops content older than what it
  shows: the update still succeeds, but the activity keeps showing the newer content. The iOS record carries the
  timestamp of the accepted content.
- A snapshot's `relevance` is ActivityKit's relevance score: of the app's activities, the Dynamic Island shows the
  one with the highest. A snapshot without one keeps the activity's score, which is 0 at first.
- An update is silent unless it carries an `alert` (a title and a body): the device then lights up, the Dynamic
  Island expands, or without one the Lock Screen presentation shows as a banner, and an Apple Watch shows the two
  texts.
- `staleAt` becomes ActivityKit's stale date. Each snapshot has its own; one without it clears the date. The state is
  what ActivityKit reports: `pending`, `active`, `stale`, `ended`, `dismissed` or `unknown`. ActivityKit has not been
  seen to report `stale` on a simulator, so no test asserts it.
- While the app runs, every new state of an activity comes to `onState`, and a layout activity that began, also one
  that a push started, to `onStarted` with its record. What changed while the app did not run is in the records of
  `list()` and `listLayout()`.
- A successful request does not prove that anything was shown: records keep `visibility: 'unknown'`.

End policies:

- `immediate` removes the activity at once.
- `default` keeps it on the Lock Screen for up to four hours.
- `after` keeps it until the given time or four hours after the end, whichever comes first. Any time from 0 to
  8640000000000000 ms is allowed, and a time in the past removes it at once. (0.3 required a time in the future.)

`endLayout` takes final content in `snapshot`, checked as an update: `STALE_REVISION` below the accepted revision,
`CONFLICT` at it with other values, `INVALID_INPUT` for other keys or types. Without `snapshot` the activity ends
with its last accepted values at the next revision, so the record's revision is one higher. Ending again answers the
record, also once the system no longer lists an activity that ended at once: the handles of the last 64 activities
ended in this launch are kept. After a relaunch such an activity is `NOT_FOUND`. The v1 `end` takes no final
content.

## Pushes

The plugin asks ActivityKit for what a server needs and reports it; the server sends the pushes, built with
activitykit's `push::Payload` (its [usage guide](https://github.com/1eedaegon/activitykit-rs/blob/main/docs/usage.md#pushes)
has the headers and the payloads). The app needs the Push Notifications capability, the `aps-environment`
entitlement, which `setup` does not add: without it, as in the simulator, a start with `push` fails with
`CONFIGURATION_REQUIRED`. Frequent pushes need `NSSupportsLiveActivitiesFrequentUpdates` in Info.plist, and the
person's consent in Settings, which `checkPermissions` reports as `frequentPushes`. Push-to-start (iOS 17.2) is
`"pushToStart": true` under `plugins.live-activity`; broadcast channels need iOS 18. The events are
`live-activity://push-token`, `live-activity://push-to-start-token` and `live-activity://updated`, which `onPushToken`,
`onPushToStartToken` and `onUpdated` listen to; they go out as liveactivity reports them, one at a time on its events
thread, without waiting for JavaScript, an event behind a tap after that tap's `on_action` handlers (at most 4
seconds), and a Rust listener runs inline on that thread. A token that comes before the page listens, the
push-to-start token at launch above all, is kept: `pushTokens()` answers the newest token of each of the last 32
activities and the push-to-start token, and `onPushToken` and `onPushToStartToken` deliver them right after
subscribing. An activity a push starts comes to `onStarted` with its record while the app runs, and is in
`listLayout`.

## Receipts

ActivityKit can report an update late. activitykit's Swift layer therefore keeps a receipt of each accepted request in
the app's Application Support, `activitykit/receipts-v2.json`, so that a late read cannot bring back an older revision,
also after a restart. A receipt holds the activity's key and its last accepted values in plain text. The file is
readable by the app only and protected until the first unlock after a restart. Leave out of activities what must not
rest on the device in plain text.

With `receipts: "redacted"` in the plugin configuration the plugin builds activitykit with redacted receipts, which keep
a SHA-256 digest of each accepted content instead of its values. After a relaunch, `listLayout()` then gives the values
that ActivityKit shows. A digest of guessable values can be guessed, and ActivityKit itself keeps the values in the
activity's content. activitykit's settings hold for the whole process: when the app builds activitykit itself with
other receipts first, the plugin's setup fails. Android ignores the option.

0.5 does not read 0.3's receipts (`tauri-live-activity/receipts-v2.json`) and does not list activities that 0.3
started.

## The progress and timer templates

activitykit has no templates, so `start` turns a template request into a layout activity with a fixed tree, drawn like
0.3's template widget:

- Lock Screen: the title (headline, one line), the status (subheadline, up to two lines) and a progress bar or a
  countdown, on the system's secondary background color in light and dark.
- Dynamic Island: title, status and meter again in the expanded center; compact leading the symbol
  `arrow.down.circle` or `timer`; compact trailing the percentage or the countdown; minimal a progress ring or the
  `timer` symbol.

The snapshot's fields become values, with a marker value `liveActivityTemplate` set to `progress` or `timer`.
`ActivityKitLayoutWidget` draws these activities like any layout, so a widget of the app's own for the templates no
longer draws them. `start`, `update`, `end` and `list` keep their requests and records, and follow the revision rules
above. `list` gives template activities only and `listLayout` layout activities only, and an id of one version is not
found by the other version's commands. Both versions start through activitykit's keys, so a template and a layout
activity can no longer run under the same `activityKey`: the second start answers `CONFLICT`. A layout of your own
that holds the value `liveActivityTemplate` with `progress` or `timer` is taken for a template.

## Migrating from 0.3

1. End the activities that 0.3 started before you update: 0.5 does not list them, and they stay until the system ends
   them, within 8 hours.
2. Update the crate and the npm package to the same minor version, and run `npx tauri-plugin-live-activity setup`
   again. On an app that 0.2 or 0.3 set up, it:
   - removes `LiveActivityActionIntent.swift` and `LiveActivityCustomRegistry.swift` from
     `gen/apple/LiveActivityWidget` when they are as a release wrote them;
   - replaces a `LiveActivityWidget.swift` that 0.2 or 0.3 wrote with activitykit's template;
   - gives `LiveActivityCustomViews.swift` activitykit's names: `@objc(ActivityKitCustomViews)`,
     `ActivityKitCustomViewRegistry`, `ActivityKitCustomView`, `ActivityKitCustomProps` and `import ActivityKitViews`.
     Your views stay as they are;
   - writes `live-activity.yml` again on activitykit's Swift package, with iOS 16.2, `ActivityKitLayout` and, when the
     spec had an App Group, the same group under `ActivityKitAppGroup`;
   - runs XcodeGen.

   Files changed by hand stay. An edited intent or registry file, and a widget file that still imports
   `LiveActivityShared`, `LiveActivityUI` or `LiveActivityCore`, are reported as steps to do. Another changed widget
   file is kept, and so is a `live-activity.yml` changed by hand, which still names 0.3's package and keys: delete it
   and run `setup` again. A second run changes nothing. The 0.3 step that copied Tauri's Swift API into the plugin crate (`.tauri/tauri-api`)
   is gone, and so is the `cargo check` that prepared it.
3. Code: `endLayout` and `end_layout` take `LayoutEndInput` (`snapshot` is optional), a Rust `LayoutSnapshot` literal
   needs `timestamp: None`, a `match` on `ActivityState` needs a `_` arm, and a start may fail with `NOT_FOREGROUND`.
4. Write the images of `writeImage` again; 0.5 reads them from `activitykit/images`.

An app whose widget extension `setup` left alone does the same by hand: replace the plugin's Swift package and its
products (`LiveActivityShared`, `LiveActivityUI`) with activitykit's, draw with `ActivityKitLayoutWidget()`, delete
the copied intent and registry files, rename the custom views as above, and move the Info.plist keys to their new
names. A widget of your own can stay in the bundle beside `ActivityKitLayoutWidget()`; `import ActivityKitWidget`
brings `LiveActivityLayoutAttributes`, `LayoutDocument` and `LayoutView` for one that draws layouts itself.

## Testing

- The iOS logic and its host tests against a fake kit are the liveactivity crate's: what each command sends to
  activitykit, the records, the templates, and a tap whose intent is held until the sink returns. The plugin's
  `cargo test` covers what the plugin adds on every platform: the commands, the sink that carries liveactivity's
  events to Tauri and returns from a tap only once a slow handler has run, and the dispatcher of the handlers. Only
  `src/ios.rs`, which builds the kit from the plugin configuration and connects the backend, is compiled for iOS
  alone: no host test runs it, the coverage gate (`cargo llvm-cov`, 80 % of lines) leaves it out, and the simulator
  suite drives it.
- `ACTIVITYKIT_SKIP_SWIFT=1 cargo clippy --target aarch64-apple-ios --lib` checks the iOS code without building
  activitykit's Swift. `cargo build --target x86_64-apple-ios --lib` builds it with the Swift bridge, which needs
  Xcode. CI runs both.
- `tests/ios/run.sh` runs the demo app end to end on an iOS Simulator of its own:

  ```sh
  npm ci
  tests/ios/run.sh
  ONLY=DemoTests/test2LockScreenButtonReachesRustAndJavaScript tests/ios/run.sh   # one test
  ```

  It creates an iPhone 17 Pro simulator on the newest iOS runtime installed, runs `npm run build:demo`, generates the
  demo's Xcode project and the test project with XcodeGen, builds the demo with
  `tauri ios build --debug --target x86_64|aarch64-sim --ci` for this Mac's architecture, installs it and runs the UI
  tests of `tests/ios/DemoUITests`: a bound style on the Lock Screen, a Lock Screen button that reaches Rust and
  JavaScript, `listLayout` after a relaunch, the demo's lifecycle test, the two templates on the Lock Screen, and a
  tap that launches the app for a slow Rust handler. The tests run through the `DemoUITests` scheme of the project
  that XcodeGen generates on every run; with an `.xctestrun` file alone, xcodebuild found no simulator on a CI
  runner. It copies the screenshots, the other attachments, `xcodebuild.log` and, when a test failed, the demo's log
  (`app.log`) to `tests/ios/output` (or `$OUTPUT`,
  where it replaces only its own files), then deletes the simulator and the build, and puts back the tracked files of
  the demo's `gen/apple`, which XcodeGen rewrites. It needs Xcode, XcodeGen, Node with the repository's npm
  packages, and cargo with the iOS simulator target of this Mac. The archive step after the build needs a signing
  team and may fail; the simulator needs only the build. Under `CI` a failed test runs again, up to three times in
  all, and after a full pass `OUTPUT/passed` lists the tests that passed only on a retry.
- `MODE=dev tests/ios/run.sh` lets `tauri ios dev` build, install, launch and serve the demo on the simulator, and
  runs the layout, button and relaunch tests through its page, then launches it with `--start-buttons`, where Rust
  starts the Buttons example and a tap on Pet Mochi reaches the Rust handler. Three things about Tauri CLI 2.12.4 have
  nothing to do with Live Activities:
  - `tauri ios dev --no-watch` ends once it has launched the app, and its server for the page ends with it: the page
    then shows `Failed to request http://127.0.0.1:1430/`. Run it without `--no-watch`.
  - With an iPhone connected, `tauri ios dev <simulator name>` takes the iPhone when no iPhone has that name. The
    script hides connected iPhones from Tauri (`xcrun devicectl` and `ios-deploy`) for its run; disconnect them, or
    name the device you mean, when you run `tauri ios dev` yourself.
  - After the simulator build Tauri archives the app and installs the archive's copy; on an Intel Mac that archive is
    a device build, which needs a signing team (`bundle > iOS > developmentTeam` or `APPLE_DEVELOPMENT_TEAM`). The
    script answers the archive with the simulator build itself.
- `BUILD_DIR=<folder>` keeps the built demo and UI tests, and `BUILD_KEY=<name>` marks a complete build: a later run
  with the same key tests those products without building, as CI does on a cache hit (`tests/ci/cache.sh` makes the
  key from the tracked files, Xcode and the pinned tools). The simulator destination names its architecture.
- CI does not run the two simulator suites on a push or a pull request: a hosted runner rebuilds the demo whenever
  their inputs change, which takes 30 to 50 minutes. Run `tests/ios/run.sh` and `MODE=dev tests/ios/run.sh` on a Mac
  before pushing a change to what they read. A run of CI started by hand with `simulator` on runs both
  (`gh workflow run ci.yml -f simulator=true`).

The Swift layer's own tests (its validators, the lifecycle and receipts, the C bridge and a test host on a simulator)
are activitykit's ([testing](https://github.com/1eedaegon/activitykit-rs/blob/main/docs/testing.md)). 0.3's
`tests/ios/run-core.sh`, the native harness `tests/ios/SimulatorHost` and the plugin's Swift unit tests are gone.

## Validation record

### 0.5

On 2026-11-09 the simulator suite (`tests/ios/run.sh`) passed its seven tests on this Mac (Intel, Xcode 26.3, an
iPhone 17 Pro simulator with iOS 26.3), and `MODE=dev` its four, without a retry; CI passed both on the merged branch.

On 2026-11-09 and 10 an app on the plugin at `0b3f6ff` ran on an iPhone 16 with iOS 27.2, built with Xcode 26.3 and
linking `ActivityKitWidget` in its extension and `ActivityKitIntent` in the app:

- A start from Rust showed the layout on the Lock Screen, and updates sent while the phone was locked showed there
  within seconds.
- With Face ID matched and the Lock Screen still up, a tap on a layout button ran `ActivityKitActionIntent` in the app
  (the system log shows `Started executing LNAction ActivityKitActionIntent`), and the app's `on_action` handler had
  the tap 0.27 s later.
- With Face ID unable to see the owner, the same tap brought up the passcode, and the intent ran only once the owner
  was authenticated. The intent's metadata in both bundles says `.alwaysAllowed` (`authenticationPolicy` 0,
  explicit). A native build of the same app, whose own parameterless `LiveActivityIntent` is `.alwaysAllowed` and
  compiled into both targets, waited for the unlock in the same way.

The records below describe 0.3 and earlier: the plugin's own Swift package (`LiveActivityShared`, `LiveActivityCore`,
`LiveActivityUI`, `LiveActivityPlugin`), its 16.1 availability gates and the native harness `tests/ios/SimulatorHost`,
none of which exist in 0.4.

### 0.3 and earlier

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
94.92% region, and 97.10% function coverage at that checkpoint. iOS 16.1/16.2 branches were compiled but
were not run on those older OS versions.

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

`docs/images/ios-live-activity.png`, the README screenshot of the first releases, is a direct simulator capture of two
running examples, without mock UI or test-result overlays. The download widget comes from the native
production-adapter harness; the order widget comes from the actual Tauri demo's
Start activity button. XCTest verified the visible order title and accepted the
system's Live Activity prompt before the capture.

References: [Apple ActivityKit](https://developer.apple.com/documentation/activitykit),
[Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/),
[activitykit](https://github.com/1eedaegon/activitykit-rs).
