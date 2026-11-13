# 0.7.0 validation

0.7.0 moves the plugin to liveactivity 0.5.1 (activitykit 0.5.0, liveupdate 0.3.2): links, toggles, nodes that
follow staleness, scheduled and transient starts, alert sounds, the wider Android content, the states of an activity
on Android and the opened event. Rust, TypeScript and JSON change, so it is a minor release. Checked before the tag:

- The shared layout fixtures of activitykit 0.5, 246 valid, 1042 invalid, 41 updates and 6 ends: the Rust validator
  and the TypeScript reference validator agree on verdict, error code and weight. Beside the fixtures, 173 requests
  written for the review were given to liveactivity 0.5.1 and to the reference validator; they disagreed on the
  value key that liveactivity keeps for the templates, which the reference validator now refuses, and on what it
  checks only in outline, the presentation of an Android content.
- `npm test` (1744 tests in six suites) and `cargo test` (58), `cargo clippy` for the host and for Android,
  `tools/spec-coverage.sh` (77 requirements, each with a test).
- The Android library on a Galaxy S23 with Android 17: unit tests and lint, and the device tests, 7 of 7, with every
  Android content of the fixture posted and read back. The device tests on an Android 16 emulator as well, 7 of 7:
  the three contents of the progress style are posted there, which they were not before liveupdate 0.3.2.
- The demo on that phone: the lifecycle, the demo's 20 checks, a stale time that passed with no call of the app
  (`stale` after 6.1 s for a time 6 s ahead), an opening intent, and the states of an end.
- CI of the pull request and the main run of the release commit. CI runs the two simulator suites only when it is
  started by hand: they were, on the head of the pull request, and passed (7 tests on the built demo; 4 on
  `tauri ios dev`, one of them on a second try).

Not checked: Android 15 and earlier with this version; a tap on a toggle or a link by a person; an activity that
Android restored after ending the process; on iOS, the new nodes on a Lock Screen and a scheduled start through
the plugin (an iPhone with iOS 18 ran liveactivity 0.5.0's contract through a test build of the demo:
[iOS coverage](ios-coverage.md#070-additions)).

The record of 0.3.0 follows.

# 0.3.0 validation

0.3.0 lets apps change styles with an update (bound style members), use their own fonts and
asset images, show images they draw (through the App Group) and register custom SwiftUI views.
Rust and Swift types change, so it is a minor release. Checked before the tag:

- Shared fixtures, 214 valid, 834 invalid and 34 update cases: Rust, the TypeScript reference
  validator, Swift and Kotlin agree on verdict, error code and weight; every new rule was shown
  failing before its code, and mutation checks caught a widened range and a removed rule.
- A fresh Tauri 2 app on an iOS Simulator: a bound color turning from green to red on update,
  and a bundled font, a drawn image, a custom view and an asset image on the Lock Screen,
  updated again.
- CI of the pull requests (#7 and this release) and the main run of the release commit.

Not checked: the App Group on a physical iPhone, and a drawn image as an Android notification's
large icon on a device.

The record of 0.2.1 follows.

# 0.2.1 validation (earlier)

0.2.1 adds the `npx tauri-plugin-live-activity setup` command and a short README; the plugin's
Rust, Swift, Kotlin and TypeScript code is the same as in 0.2.0. Checked before the tag:

- `tests/setup.test.mjs`: 28 tests (first run, a second run that changes nothing, dry run,
  files the user changed, plugin updates, errors), against a fixture from a fresh Tauri 2 app.
- End to end: a fresh Tauri 2 app with crates.io 0.2.0 and the packed npm package; `setup`,
  then `tauri ios dev` on an iOS Simulator built and started a layout activity.
- CI of the pull request that added the command (all four jobs), and the main run of the
  release commit, which the release guard requires.

Not checked: an Android build of a fresh app after `setup` raised its minimum to API 26.

The record of 0.2.0 follows.

# 0.2.0 validation (earlier)

0.2.0 adds request contract v2: layouts, values, styles and buttons. It also adds the
optional plugin configuration and moves iOS receipts to `receipts-v2.json`. Contract v1
is unchanged. 0.2.0 is a regular release, and npm publishes it under `latest`. The
previous record is the [alpha.4 validation](validation-alpha.4.md).

This record was written before the `v0.2.0` tag was pushed. It does not cover the
published packages yet.

## CI

- [PR #1 CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/42149775242)
  passed all four jobs at `be06bc5`: Rust/TypeScript/Swift on macOS, Android unit tests
  and lint, and the desktop contract on Windows and Linux.
- [CI on `main`](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/42152656891)
  passed the same four jobs at the merge commit `cacfd08`.
- The commit that sets version 0.2.0 needs its own successful CI run on `main`. The
  publish workflow rejects the tag without one.

## Local run of the CI steps

Run on 2026-11-06 on an Intel Mac with macOS 15.7.7 and Xcode 26.3, and run again with
the same results after the release review's fixes. The source was `cacfd08` with the
0.2.0 version, documentation and CI changes, not yet committed. The toolchain differs
from CI: Rust 1.95.0 instead of 1.99.1, Node 22.23.4 with npm 10.9.9
instead of Node 24, cargo-llvm-cov 0.8.7 instead of 0.9.1, and Zulu JDK 21.0.11 instead
of Temurin 21.

| CI step | Result |
| --- | --- |
| `npm test` | Request contracts: 1008 tests, validator coverage 100% (lines, branches, functions). API: 65 tests, 100%. Demo: 17 tests, lines and functions 100%, branches 96.51% |
| `npm run typecheck`, `npm run build:demo` | Passed |
| Release guards | 15 tests, 100% lines, branches and functions |
| `cargo fmt --check`, plugin and demo | Passed |
| `cargo clippy --locked --all-targets -- -D warnings` | Passed |
| `cargo llvm-cov --locked --fail-under-lines 80` | 43 unit and 10 contract tests passed. Lines 98.64%, functions 93.78%, regions 98.47% |
| Demo `cargo test --locked` | 3 tests passed |
| `tests/ios/run-core.sh` | 1934 assertions passed. Lines 98.99%, functions 97.61%, regions 98.73% |
| `npm pack --dry-run` | 12 files, 20.3 kB |
| `cargo package --locked --allow-dirty` | 100 files; the packaged crate builds |
| `cargo test --locked` (the desktop job's command, run on macOS) | 43 unit and 10 contract tests passed |
| Gradle `testDebugUnitTest`, `lintDebug`, `assembleDebugAndroidTest`, all tasks rerun | 59 JVM tests passed. Lint: 0 errors, 6 warnings (`ObsoleteSdkInt`, `InlinedApi`, `NewerVersionAvailable`). The instrumented test APK builds |
| `verify-min-sdk.mjs` | Merged minimum SDK is 26 |

`--allow-dirty` was needed only because the changes were not committed. CI runs
`cargo package --locked` on a clean checkout. `actionlint` 1.7.12 found nothing in
`ci.yml` and `publish.yml`; CI does not run it.

The publish workflow's checks were run without publishing. For tag `v0.2.0` and both
manifests at 0.2.0, the release guard returns npm dist-tag `latest`. It rejects
`v0.1.0-alpha.4`, `v0.2.0-rc.1`, `v0.2`, `0.2.0`, `v0.2.00`, `V0.2.0` and `v0.2.0` with
a trailing newline. The CI check accepts the `main`
run for `cacfd08` and rejects the pull request run for `be06bc5`. Packaging,
`release.mjs archive` and `release.mjs inspect` ran against a scratch directory, and
the registries reported 0.2.0 as missing on npm and crates.io. `release.mjs prepare`
itself was not run, because it checks out the tagged commit and needs the tag and a
GitHub token.

## Native runs

These ran separately from the local run above.

- iOS: the native harness in `tests/ios/SimulatorHost` ran on an iPhone 17 Pro
  simulator with iOS 26.3. Every layout fixture took the plugin path, every region of
  every valid start rendered, the Lock Screen showed the layout, and a tap on Stop
  reached the action hub. See the
  [iOS validation record](ios-integration.md#validation-record).
- iOS: a separate Tauri app that uses the plugin ran the layout path in the iOS
  Simulator. Its acceptance test passed 20 of 20 checks, and its Lock Screen UI test
  passed. That app keeps these results in its own repository. They were not reproduced
  here, and this record does not link them.
- iOS: the same app on an iPhone 16 with iOS 27.0.1 (2026-11-06). Its acceptance test
  passed 18 of 18 checks (two run only in a simulator); the app's journals show the
  layout started, updated with each new sentence and ended through the plugin. Its Lock
  Screen UI test has not passed on the phone yet, so how SpringBoard draws a layout on a
  physical lock screen and a tap while locked are not shown by a test.
- Android: the instrumented tests ran on API 26 and API 36 emulators and on a Galaxy S23
  with Android 17. See [Android instrumented tests](#android-instrumented-tests).

## Android instrumented tests

Run on 2026-11-06 with Zulu JDK 21.0.11, the Gradle harness in `tests/android` and
`-PliveActivityCoverage=true`: `connectedDebugAndroidTest`, then `testDebugUnitTest` and
`coverageVerification`. There are 14 instrumented tests: the eight from contract v1 and six
for layouts. One of the six, `NativeLayoutHoldTest`, is for a person at the phone and is
skipped unless `-e liveActivityHold` is passed, so every run skipped it.

| Runtime | Instrumented tests | Lines, JVM + this runtime | Branches |
| --- | --- | --- | --- |
| Emulator, API 26 (Android 8.0, `google_apis` x86_64) | 13 passed, 1 skipped | 958/1009 (94.95%) | 825/1017 (81.12%) |
| Emulator, API 36 (Android 16, SDK 36.0, build `BE2A.250530.026.F3`) | 13 passed, 1 skipped, after a test fix | 960/1009 (95.14%) | 834/1017 (82.01%) |
| Galaxy S23 SM-S911N, API 37 (Android 17, One UI 9) | 9 passed, 1 skipped, 4 left out | 895/1009 (88.70%) | 828/1017 (81.42%) |
| All three runtimes together | | 971/1009 (96.23%) | 861/1017 (84.66%) |
| JVM tests only (59 passed) | | 759/1009 (75.22%) | 722/1017 (70.99%) |

The 80% line gate counts JVM and device data together. It passed for each runtime and
for all three together.

The first API 36 run failed one test,
`NativeLayoutTest.theLockScreenTreeBecomesAPromotableNotification`, with an
`AssertionError` at `NativeLayoutTest.kt:70`. The test expected Android's own check,
`hasPromotableCharacteristics()`, to accept the layout notification. On Android 16 36.0
that check follows earlier rules, which want a colorized notification. From 36.1 Android
follows the published Live Update rules, which forbid a colorized one, and so does the
plugin. The test was wrong for 36.0; the plugin's code did not change. The test now
checks on every API level that the notification is not colorized. On 36.1 and later it
still expects the check to pass. On 36.0 it expects the check to fail, and to pass once
only `EXTRA_COLORIZED` is added, so nothing else in the notification stands in the way.
The second run passed. After the fix, the JVM tests, lint and the test APK build ran
again with the same results as in the local run: 59 tests passed, and lint reports 0
errors and the same 6 warnings.

On the Galaxy S23 the tests ran while the phone was locked and had not been used for
about 28 minutes. An emergency alert, a system dialog, was showing over the lock screen.
Four tests open a test activity, which would have pushed that alert into the background,
so they were left out with the runner's `notClass` argument: the three in
`NativeBridgeTest` and `NativeLayoutTest.theBridgeAnswersTheLayoutCommands`. They passed
on both emulators. Because of that, `LiveActivityPlugin.kt` has no coverage from the S23
(0 of 93 lines). The phone was not unlocked. The tests ran no settings command, but while
they used UiAutomation, Android briefly turned on the phone's `accessibility_enabled`
setting; it was back to 0 afterwards. The test package was removed after the run.

## Not verified

- On a physical iPhone: the Lock Screen drawing of a layout and a button tap while the
  phone is locked (see Native runs).
- On the Galaxy S23: the four instrumented tests that open a test activity (see above).
- Android 16 QPR1 (36.1). The test's branch for 36.1 and later ran only on the S23
  (API 37), and it assumes Android's `uiRichOngoing` feature flag is on.
- On Android: how One UI shows a projected layout, a tap on a locked phone, and a tap
  that starts a killed process. The instrumented tests send a button's intent
  themselves; nobody tapped. The [Now Bar notes](android-integration.md#samsung-now-bar)
  come from reading a Galaxy S23's system files and looking at that phone. They are
  not a test result.
- On iOS: a button tap on a locked device, iOS 16.1 and 16.2 runtimes, iPad, and
  forwarded Watch, Mac and CarPlay surfaces. The strict stale-transition probe stays a
  failed observation, as in earlier releases.
- A fresh install of the published npm and crates.io packages in a Tauri app.

Desktop backends remain unsupported. Windows and Linux CI check the unsupported
answers.

## Reproduce

```sh
npm ci
npm test && npm run typecheck && npm run build:demo
node --test --experimental-test-coverage --test-coverage-include=tools/release-guard.mjs \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  tests/release/release-guard.test.mjs
cargo fmt --all -- --check
cargo fmt --manifest-path examples/demo/src-tauri/Cargo.toml -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo llvm-cov --locked --summary-only --fail-under-lines 80
cargo test --locked --manifest-path examples/demo/src-tauri/Cargo.toml
bash tests/ios/run-core.sh
npm pack --dry-run
cargo package --locked
cd tests/android
./gradlew :live-activity:testDebugUnitTest :live-activity:lintDebug \
  :live-activity:assembleDebugAndroidTest --no-daemon
# One emulator or device attached, named by ANDROID_SERIAL:
./gradlew -PliveActivityCoverage=true :live-activity:connectedDebugAndroidTest \
  :live-activity:testDebugUnitTest --rerun :live-activity:coverageVerification
cd ../..
node tests/android/verify-min-sdk.mjs "$ANDROID_HOME/build-tools/37.0.0/aapt" \
  android/build/outputs/apk/androidTest/debug/live-activity-debug-androidTest.apk
```
