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
   `templates/ios/LiveActivityWidget.swift`. Use `templates/ios/Info.plist` as the
   extension Info.plist example.
3. Add this repository's `ios` Swift package as a local package reference. Link its
   **LiveActivityShared** product to the widget extension. The plugin links the
   same module in the host app. Do not copy and redefine the attributes type in
   another Swift module.
4. Give the extension an identifier under the app identifier, embed it in the
   host, and use the same signing team for device builds.

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
Xcode changes. Keep the widget target, package reference, and Info.plist property
in the source XcodeGen specification used for your app.

No App Group, push token, or remote notification entitlement is needed for this
local progress/timer implementation. The plugin does not request ordinary
notification permission on iOS. If Live Activities are disabled,
`requestPermissions('liveActivities')` returns `settingsRequired`;
there is no repeated permission prompt or automatic settings redirect.

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
away. Immediate and default dismissal are also available.

ActivityKit publication can lag an awaited update. The plugin stores accepted
snapshots and IDs in the app's Application Support directory, under
`tauri-live-activity/receipts-v1.json`, and merges them with OS lifecycle state.
This prevents a delayed OS read from accepting an older revision, including after
an app restart. Storage is atomic, bounded to 256 receipts including up to the
latest 128 terminal receipts, and uses iOS file protection until first unlock.
The file contains the text displayed in an activity; do not put secrets in that
text. The containing directory is excluded from cross-app access by the sandbox.

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
OS activities, and disk-backed restart/end recovery. LLVM coverage must be at
least 80% for lines, functions, and regions. These metrics exclude the ActivityKit
adapter, Tauri bridge, and widget rendering.

The real native harness is under `tests/ios/SimulatorHost`. It compiles the
production ActivityKit adapter and lifecycle core, links the shared Swift module,
and embeds the production widget template:

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

References: [Apple ActivityKit](https://developer.apple.com/documentation/activitykit),
[Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/).

The README screenshot is a direct simulator capture of two running examples,
without mock UI or test-result overlays. The download widget comes from the native
production-adapter harness; the order widget comes from the actual Tauri demo's
Start activity button. XCTest verified the visible order title and accepted the
system's Live Activity prompt before the capture.
