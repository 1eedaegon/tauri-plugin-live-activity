# iOS and iPadOS coverage

Research and validation date: 2026-11-04. This covers the iOS ActivityKit backend; forwarded Apple Watch, Mac, and CarPlay presentations are separate from a native backend on those platforms.

This page records the alpha releases, whose iOS backend was the plugin's own Swift package. Since 0.5 the plugin calls the [activitykit](https://github.com/1eedaegon/activitykit-rs) crate instead and needs iOS 16.2 on an iPhone; iOS 16.1 answers `UNSUPPORTED_PLATFORM`. `tests/ios/run-core.sh`, `tests/ios/SimulatorHost` and the Swift tests named below are gone; activitykit tests its Swift layer, and `tests/ios/run.sh` runs the demo on a simulator ([iOS integration](ios-integration.md#testing)).

## Platform boundaries

| Environment | Plugin policy | Evidence |
| --- | --- | --- |
| iPhone, iOS 16.1 | Local progress and timer activities; `staleAt` requires 16.2 | Deployment/availability branches compiled; no 16.1 runtime installed |
| iPhone, iOS 16.2+ | ActivityContent with an optional stale date | Runtime validation on iOS 27.2 simulator |
| iPad, iPadOS 16.x | Unsupported | OS policy unit cases reject 16.1 and 16.7 |
| iPad, iPadOS 17+ | ActivityKit backend | OS policy cases accept 17.0 and 27.2; released alpha.2 passed all 24 runtime checks on iPadOS 27.2 simulator |
| iOS app running on Mac / Mac Catalyst | Unsupported by this plugin | Explicit platform gate; desktop Tauri has a separate unsupported implementation |
| Other idioms | Unsupported | OS policy unit case |
| visionOS, including compatible iPhone/iPad apps | Unsupported; no visionOS runtime validation | Apple documents that start requests fail; no claim of tested compatibility-mode detection |
| Physical iPhone/iPad; Apple Watch, Mac forwarding, CarPlay | Not validated in this session | Requires physical devices and the relevant pairing/setup |

Apple introduced iPad Live Activities with iPadOS 17 in [Meet ActivityKit, WWDC23](https://developer.apple.com/videos/play/wwdc2023/10184/). A Swift `#available(iOS 16.1, *)` check alone is insufficient to distinguish older iPads. The same device/OS policy now controls capabilities, permission applicability, and command execution; native Swift availability checks remain in place for safe API use. Platform support is separate from the person's app settings. Apple’s [ActivityKit overview](https://developer.apple.com/documentation/activitykit) explicitly excludes visionOS, including compatible iPhone/iPad apps. This release does not introduce a dependency on the newer SDK-only compatibility detection API or claim that Vision compatibility mode was tested.

Apple documents [Live Activity authorization](https://developer.apple.com/documentation/activitykit/activityauthorizationinfo) independently of ordinary notification permission. This plugin checks Live Activity settings; it does not fabricate a prompt or request unrelated notification permission.

## Behavior and limits

Apple's [Live Activity integration guide](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) specifies a combined 4 KiB limit for static attributes and dynamic content. The plugin checks the encoded combined payload before native calls. Local starts require a foreground app. Updating and ending from the background is possible while the app is executing; this is not a guarantee that suspended Tauri JavaScript continues running. Push starts/updates and lifecycle event subscriptions remain outside this release. Since 0.2.0, layout buttons are the one interactive action (iOS 17+).

The guide specifies up to eight active hours and up to four further Lock Screen hours. [Dismissal policies](https://developer.apple.com/documentation/activitykit/activityuidismissalpolicy) determine removal after ending. Acceptance and content lifecycle do not prove a visible presentation: returned `visibility` remains `unknown`.

Apple documents that [`staleDate`](https://developer.apple.com/documentation/activitykit/activitycontent/staledate) changes an activity to stale. On iOS 27.2 simulator, an initial foreground-only published-package test did not observe that transition within 20 seconds of a deadline set two seconds after starting. This failed observation is retained in `tests/ios/results/published-alpha1-stale-observation.json`; it is not counted as passing runtime coverage. A second test backgrounded the app for eight seconds and returned before completing the same polling window; it also failed to observe stale (`published-alpha1-stale-background.json`). The bridge passes the stale date to ActivityKit and preserves observed OS lifecycle state. Android may derive content staleness from its deadline; iOS reports ActivityKit’s observed state. The strict stale probe remains separate from the other feature tests, and is not converted into a passing test by guessing an OS transition.

## 0.7.0 additions

0.7.0 adds to the iOS layouts: toggles (a switch from iOS 17), links, the nodes `accessibility`, `transition`,
`privacy` and `ifStale`, the layout's `url`, the Dynamic Island's `priority`, `belowIfTooWide` and `margins`, a style's
`contentTransition`, the alert's `sound`, the scheduled start (iOS 26, `pending` until it begins) and the transient
start (iOS 18). The contract and its checks run on every platform; the iOS behavior of these members is
activitykit's, which runs them on a simulator in its own suite.

A push or a pull request does not run the plugin's two simulator suites (`tests/ios/run.sh`): CI runs them when it
is started by hand with `simulator`. For 0.7.0 they were started so on the head of the pull request, with the widget
extension on activitykit 0.5's Swift package: the suite on the built demo passed its 7 tests, and the one on
`tauri ios dev` its 4, of which the tap on the Lock Screen button passed on a second try. Their tests are those of
0.6 and show none of the new nodes. On an iPhone XS with iOS 18, a build of the demo on liveactivity 0.5.0 with a test harness ran that crate's
conformance suite (24 checks) and started a layout with a toggle and nodes that follow staleness, an update whose
alert names a sound and a transient activity; a scheduled start answered `UNSUPPORTED_FEATURE`, as below iOS 26. An
end that removed an activity at once was reported there as `dismissed` without `ended`. No run shows a tap on a
toggle, a stale layout on a Lock Screen or a scheduled start on iOS 26 through the plugin, so the version floors
above are activitykit's documented ones.

## Tests added after the first release

- Exact encoded Unicode title/status equality: NFC and NFD strings must conflict at the same revision, matching JS/Rust/Android contracts. Swift's default canonical string equivalence incorrectly accepted the changed text. A failing core test and the actual published alpha.1 consumer reproduced it; the local fix compares UTF-8 bytes.
- iPhone/iPad OS boundaries, unsupported device family, and iOS compatibility apps on Mac. The old policy failed on iPadOS 16.1 before the policy fix.
- Timer epoch milliseconds, observed stale-state preservation and updateability, four-hour dismissal boundaries, bounded terminal receipts, retained end idempotence after restart, and eviction of old terminal receipts.
- Trailing/leading newline activity keys: the existing Swift validator already rejected all added regression cases, so it needed no change.

`./tests/ios/run-core.sh` passes 60 assertions with 98.17% line, 96.15% function, and 95.31% region coverage across the shared/core Swift sources. This coverage does not include UIKit/ActivityKit adapters or the SwiftUI widget; those are compiled and exercised through native integration and the Tauri app. Red/green failures were observed before the two fixes. No older-runtime or physical-device claims are inferred from core coverage.

## Published consumer

The final isolated consumer pins **`tauri-plugin-live-activity@0.1.0-alpha.2` from npm** and **`tauri-plugin-live-activity = "=0.1.0-alpha.2"` from crates.io**. The old `-api` npm package is absent. There are no plugin path overrides or workspace links. The app uses the Mochi host widget with `LiveActivityShared` from the downloaded crate.

| Released alpha.2 runtime | Lifecycle | Additional features | Unicode regression |
| --- | --- | --- | --- |
| iPhone 18 Pro, iOS 27.2 simulator | 13/13 | 10/10 | 1/1 |
| iPad mini (A20 Pro), iPadOS 27.2 simulator | 13/13 | 10/10 | 1/1 |

The paired registry run passed 48 checks. The downloaded npm tarball SHA-1 `b91bf5e1a0d9cf4da3f0d355b044790fc980567a` matches the frozen publication manifest and npm registry metadata; its SHA-512 integrity also matches the lockfile. Cargo SHA-256 `157b238cc6d5f79de4c86b6c9219eac83689def958224c12be2e0f3cbf43e938` matches the downloaded crate, sparse index and lockfile; packaged source is commit `b91266c`. The actual app and widget both declare `MinimumOSVersion=16.1`. See [paired registry evidence](../tests/ios/results/published-alpha2-consumer.json) and the six `published-alpha2-{iphone,ipad}-{lifecycle,features,unicode}.json` reports.

The strict OS stale transition probe remains outside those passing counts. A reused compilation cache does not replace exact registry dependency resolution, and the local XCTest host only drives the independently installed consumer.

### Earlier baseline and packaged candidate

The earlier isolated consumer pinned `tauri-plugin-live-activity-api@0.1.0-alpha.1` from npm and `tauri-plugin-live-activity = "=0.1.0-alpha.1"` from crates.io. It has no plugin path dependency or copied plugin implementation. Its widget imports `LiveActivityShared` and uses the template from the downloaded crate. A reused build target cache does not replace dependency resolution. The UI runner's local test-host app only provides XCTest automation; all plugin calls run inside the independently installed registry consumer.

- iPhone 18 Pro simulator, iOS 27.2: JS → Rust → Swift lifecycle suite passed 13/13 (`tests/ios/results/published-alpha1-iphone-lifecycle.json`).
- iPad mini (A20 Pro) simulator, iPadOS 27.2: the same exact published-package lifecycle suite passed 13/13 (`tests/ios/results/published-alpha1-ipad-lifecycle.json`).
- Both iPhone and iPad simulators passed the separate 10/10 feature suite: timer bounds/update/end, permissions, template enforcement, and default/after dismissal. See `published-alpha1-iphone-features.json` and `published-alpha1-ipad-features.json`. The strict stale transition probe is excluded and remains explicitly failed.
- The exact released npm/Cargo combination reproduced the Unicode conflict defect (`tests/ios/results/published-alpha1-unicode-red.json`). This is a known alpha.1 failure, not a failed assertion concealed by the UI automation test that captures it.
- The published Cargo archive checksum is `5e8b202f1dca8d3a1a68037cf035eb6827ba5ab0555ec1529075dcafcacf4305`; sparse index, lockfile, and downloaded archive agree. See `tests/release/crates-io-consumer.json` for the independent registry compile evidence.

The prepublication alpha.2 npm tarball (`tauri-plugin-live-activity`) and freshly extracted Cargo crate also passed lifecycle 13/13, feature 10/10, and the Unicode conflict regression 1/1 in an actual Tauri app. `packaged-alpha2-consumer.json` records the exact local archive hashes and bootstrap order; the native package started without `.tauri`, and Cargo populated it. This is packaged-candidate evidence, not registry-release evidence.

The released alpha.2 Cargo crate also passed an exact registry `cargo check` for the iOS simulator. Its downloaded archive, sparse index and lockfile agree on SHA-256 `157b238cc6d5f79de4c86b6c9219eac83689def958224c12be2e0f3cbf43e938`, and the archive records source commit `b91266c`. [Cargo release evidence](../tests/release/crates-io-alpha2-consumer.json).

The final paired registry results above supersede the earlier publication-pending status. The baseline and local-package reports remain historical evidence, with their source and version stated separately.

## Version policy and remaining runtime gaps

Three versions have different roles. Tauri's current [`bundle.iOS.minimumSystemVersion`](https://v2.tauri.app/reference/config/#iosconfig) defaults to **15.0**, confirmed in the pinned `tauri-utils 2.10.2` source. activitykit's Swift is built for **iOS 15.0** or later, as the plugin's Swift package was. Since 0.5 Live Activity feature availability is **iPhone 16.2+ / iPadOS 17+**; in the alpha releases it was iPhone 16.1+, with `staleAt` from 16.2. The demo host deploys at **16.1** and its widget at **16.2**. A lower host deployment target does not make Live Activities available on that OS.

The published shared Swift module and generic WidgetKit template pass compiler availability checks for `arm64-apple-ios16.1-simulator`, `16.2` and `17.0`, including application-extension restrictions. All ActivityContent/stale-state API uses remain behind 16.2 guards and the legacy 16.1 API remains present. This confirms compile-time consistency, not execution of those older branches. [Availability evidence](../tests/ios/results/published-alpha2-availability.json).

The current host is **macOS 27.2 / Xcode 27.2**, with only **iOS 27.2** runtimes installed. Apple's [Xcode support matrix](https://developer.apple.com/xcode/system-requirements) lists simulator support from iOS 17 for this Xcode. More specifically, Apple's [official simulator catalog](https://devimages-cdn.apple.com/downloads/xcode/simulators/index2.dvtdownloadableindex) caps the iOS 16.1 and 16.2 runtime packages at host and Xcode version **26.99**. Their runtime tests need a compatible older Mac/toolchain; downloading them onto this host would not close that gap.

The same catalog lists a stable iOS 17.0 runtime (build 21A328, about 7.56 GB). The current Xcode download command reports 17.0 unavailable for both arm64 and universal variants, and 17.5 unavailable for universal. A HEAD request to the catalog's official 17.0 archive redirects to `developer.apple.com/unauthorized/`. No runtime was downloaded, and iPadOS 17 minimum-version execution remains unverified. See [runtime feasibility evidence](../tests/ios/results/old-runtime-feasibility.json). These environmental constraints do not justify raising the plugin's advertised API floor.

Apple describes [automatic forwarding to paired Apple Watch and Mac, and CarPlay](https://developer.apple.com/design/human-interface-guidelines/live-activities): those are presentations of an iPhone activity, not independent Tauri backends. [WWDC25 widget guidance](https://developer.apple.com/videos/play/wwdc2025/278/) documents Mac forwarding from iOS 18+ and the system's default compact presentations. Watch/Mac pairing and real CarPlay remain unverified here. The [Xcode 27.2 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27_2-release-notes) specifically require a USB-connected physical device for Device Hub CarPlay and state that iOS Simulator is unsupported (FB23101450); older Simulator external-display instructions are insufficient evidence for this toolchain.

## Actual Mochi presentation

The workspace alpha.2 demo embeds `examples/demo/widget/MochiWidget.swift`, a custom host widget using the plugin's shared attributes. The generic published template remains unchanged. The iPhone simulator displayed an actual 65% snack delivery and a live five-minute nap countdown; these are app-created activities, not a visual mock or test-results screen.

`docs/images/mochi-demo.png` shows the real Tauri UI. `mochi-ios-live-activity.png` shows the expanded Activity stack in Notification Center's Lock Screen presentation, with both snack and nap cards. `mochi-ios-dynamic-island.png` shows the expanded Island. The OS applies its own glass tint to the widget background. The original alpha.1 screenshots are preserved separately. The XCTest capture driver is `tests/ios/SimulatorHost/UITests/MochiScreens.swift`; use a fresh install of the demo on the recorded iPhone profile before running it.

The updated Mochi Developer tools lifecycle driver also passed 13/13 against the workspace app (`tests/ios/results/mochi-lifecycle.json`). The obsolete order-example capture test has been replaced by the Mochi capture driver.
