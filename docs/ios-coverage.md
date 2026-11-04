# iOS and iPadOS coverage

Research and validation date: 2026-11-04. This covers the iOS ActivityKit backend; forwarded Apple Watch, Mac, and CarPlay presentations are separate from a native backend on those platforms.

## Platform boundaries

| Environment | Plugin policy | Evidence |
| --- | --- | --- |
| iPhone, iOS 16.1 | Local progress and timer activities; `staleAt` requires 16.2 | Deployment/availability branches compiled; no 16.1 runtime installed |
| iPhone, iOS 16.2+ | ActivityContent with an optional stale date | Runtime validation on iOS 27.2 simulator |
| iPad, iPadOS 16.x | Unsupported | OS policy unit cases reject 16.1 and 16.7 |
| iPad, iPadOS 17+ | ActivityKit backend | OS policy cases accept 17.0 and 27.2; Runtime lifecycle passed 13/13 on iPadOS 27.2 simulator |
| iOS app running on Mac / Mac Catalyst | Unsupported by this plugin | Explicit platform gate; desktop Tauri has a separate unsupported implementation |
| Other idioms | Unsupported | OS policy unit case |
| Physical iPhone/iPad; Apple Watch, Mac forwarding, CarPlay | Not validated in this session | Requires physical devices and the relevant pairing/setup |

Apple introduced iPad Live Activities with iPadOS 17 in [Meet ActivityKit, WWDC23](https://developer.apple.com/videos/play/wwdc2023/10184/). A Swift `#available(iOS 16.1, *)` check alone is insufficient to distinguish older iPads. The same device/OS policy now controls capabilities, permission applicability, and command execution; native Swift availability checks remain in place for safe API use. Platform support is separate from the person's app settings.

Apple documents [Live Activity authorization](https://developer.apple.com/documentation/activitykit/activityauthorizationinfo) independently of ordinary notification permission. This plugin checks Live Activity settings; it does not fabricate a prompt or request unrelated notification permission.

## Behavior and limits

Apple's [Live Activity integration guide](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) specifies a combined 4 KiB limit for static attributes and dynamic content. The plugin checks the encoded combined payload before native calls. Local starts require a foreground app. Updating and ending from the background is possible while the app is executing; this is not a guarantee that suspended Tauri JavaScript continues running. Push starts/updates, interactive actions, and event subscriptions remain outside this alpha.

The guide specifies up to eight active hours and up to four further Lock Screen hours. [Dismissal policies](https://developer.apple.com/documentation/activitykit/activityuidismissalpolicy) determine removal after ending. Acceptance and content lifecycle do not prove a visible presentation: returned `visibility` remains `unknown`.

Apple documents that [`staleDate`](https://developer.apple.com/documentation/activitykit/activitycontent/staledate) changes an activity to stale. On iOS 27.2 simulator, an initial foreground-only published-package test did not observe that transition within 20 seconds of a deadline set two seconds after starting. This failed observation is retained in `tests/ios/results/published-alpha1-stale-observation.json`; it is not counted as passing runtime coverage. A second test backgrounded the app for eight seconds and returned before completing the same polling window; it also failed to observe stale (`published-alpha1-stale-background.json`). The bridge passes the stale date to ActivityKit and preserves observed OS lifecycle state. Android may derive content staleness from its deadline; iOS reports ActivityKit’s observed state. The strict stale probe remains separate from the other feature tests, and is not converted into a passing test by guessing an OS transition.

## Tests added after the first release

- Exact encoded Unicode title/status equality: NFC and NFD strings must conflict at the same revision, matching JS/Rust/Android contracts. Swift's default canonical string equivalence incorrectly accepted the changed text. A failing core test and the actual published alpha.1 consumer reproduced it; the local fix compares UTF-8 bytes.
- iPhone/iPad OS boundaries, unsupported device family, and iOS compatibility apps on Mac. The old policy failed on iPadOS 16.1 before the policy fix.
- Timer epoch milliseconds, observed stale-state preservation and updateability, four-hour dismissal boundaries, bounded terminal receipts, retained end idempotence after restart, and eviction of old terminal receipts.
- Trailing/leading newline activity keys: the existing Swift validator already rejected all added regression cases, so it needed no change.

`./tests/ios/run-core.sh` passes 60 assertions with 98.17% line, 96.15% function, and 95.31% region coverage across the shared/core Swift sources. This coverage does not include UIKit/ActivityKit adapters or the SwiftUI widget; those are compiled and exercised through native integration and the Tauri app. Red/green failures were observed before the two fixes. No older-runtime or physical-device claims are inferred from core coverage.

## Published consumer

The isolated consumer pins `tauri-plugin-live-activity-api@0.1.0-alpha.1` from npm and `tauri-plugin-live-activity = "=0.1.0-alpha.1"` from crates.io. It has no plugin path dependency or copied plugin implementation. Its widget imports `LiveActivityShared` and uses the template from the downloaded crate. A reused build target cache does not replace dependency resolution. The UI runner's local test-host app only provides XCTest automation; all plugin calls run inside the independently installed registry consumer.

- iPhone 18 Pro simulator, iOS 27.2: JS → Rust → Swift lifecycle suite passed 13/13 (`tests/ios/results/published-alpha1-iphone-lifecycle.json`).
- iPad mini (A20 Pro) simulator, iPadOS 27.2: the same exact published-package lifecycle suite passed 13/13 (`tests/ios/results/published-alpha1-ipad-lifecycle.json`).
- Both iPhone and iPad simulators passed the separate 10/10 feature suite: timer bounds/update/end, permissions, template enforcement, and default/after dismissal. See `published-alpha1-iphone-features.json` and `published-alpha1-ipad-features.json`. The strict stale transition probe is excluded and remains explicitly failed.
- The exact released npm/Cargo combination reproduced the Unicode conflict defect (`tests/ios/results/published-alpha1-unicode-red.json`). This is a known alpha.1 failure, not a failed assertion concealed by the UI automation test that captures it.
- The published Cargo archive checksum is `5e8b202f1dca8d3a1a68037cf035eb6827ba5ab0555ec1529075dcafcacf4305`; sparse index, lockfile, and downloaded archive agree. See `tests/release/crates-io-consumer.json` for the independent registry compile evidence.

The next release's renamed npm package (`tauri-plugin-live-activity`) and exact Cargo version must be installed into this same isolated consumer and rerun after publication. Local-source success is not final registry-release verification.

## Actual Mochi presentation

The workspace alpha.2 demo embeds `examples/demo/widget/MochiWidget.swift`, a custom host widget using the plugin's shared attributes. The generic published template remains unchanged. The iPhone simulator displayed an actual 65% snack delivery and a live five-minute nap countdown; these are app-created activities, not a visual mock or test-results screen.

`docs/images/mochi-demo.png` shows the real Tauri UI. `mochi-ios-live-activity.png` shows the expanded Activity stack in Notification Center's Lock Screen presentation, with both snack and nap cards. `mochi-ios-dynamic-island.png` shows the expanded Island. The OS applies its own glass tint to the widget background. The original alpha.1 screenshots are preserved separately. The XCTest capture driver is `tests/ios/SimulatorHost/UITests/MochiScreens.swift`; use a fresh install of the demo on the recorded iPhone profile before running it.
