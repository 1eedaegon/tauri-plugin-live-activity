# OS compatibility

The minimum versions below took effect in `0.1.0-alpha.3`, which is published on npm and
crates.io. `0.1.0-alpha.4` added search metadata; it is published on both registries and
was checked in a real Tauri app. `0.2.0` is a regular release. It adds layouts (request
contract v2) and buttons. The OS minimums stay the same, and the table below gives the OS
requirements of the new features. 0.5 moves iOS onto the activitykit crate and raises the
iPhone minimum to iOS 16.2. 0.7 moves Android onto liveupdate 0.3.2 and adds the features whose
floors are in the table below: links and toggles, the scheduled and transient starts, and the
Android notification styles, each of which the device reports in `getCapabilities()`. Both registries use the name
`tauri-plugin-live-activity`. This page sets what is supported;
[platform coverage](platform-coverage.md) records the tests that actually ran.

## Supported versions

| Platform | Supported from | What it provides |
| --- | --- | --- |
| iPhone | iOS 16.2+ (16.1+ before 0.5) | ActivityKit start, update, end and list; progress and timer. Below 16.2 every command but the reads answers `UNSUPPORTED_PLATFORM` |
| iPhone `staleAt` | iOS 16.2+ | Passes the stale date in `ActivityContent`. The stale state returned is the one the OS reports |
| iPad | iPadOS 17+ | The same ActivityKit API; iPadOS 16.x is explicitly unsupported |
| Android | Android 8.0 / API 26+ | Ongoing progress and timer notifications as the fallback. API 24 is excluded: a Tauri startup crash was reproduced there |
| Android notification channels | Android 8.0 / API 26+ | Channel creation, blocked channels and importance checks |
| Android notification permission | Android 13 / API 33+ | Runtime request, cancellation, denial and the settings-required state |
| Android Live Updates | Android 16 / API 36+ | Promotion request after eligibility and user-setting checks; the result is read from the OS flag |
| iPhone layouts (v2) | iOS 16.2+ | activitykit's widget, `ActivityKitLayoutWidget`, draws the layout tree; on iPad the iPadOS 17+ rule above applies |
| iPhone layout buttons | iOS 17+ | activitykit's `ActivityKitActionIntent` brings the tap to the app process |
| iPhone layout toggles | iOS 17+ | The switch; before it the label alone. A tap comes as `on` |
| iPhone transient activity | iOS 18+ | `ios: { transient: true }`; `UNSUPPORTED_FEATURE` before |
| iPhone scheduled start | iOS 26+ | `scheduled`, the record is `pending` until it begins; `UNSUPPORTED_FEATURE` before, and on Android |
| Android layouts (v2) | Android 8.0 / API 26+ | Shown in part as a notification (title, body, progress bar, chronometer, up to three actions: buttons, links and toggles); the rest is listed in `degradedFeatures` |
| Android notification styles | Android 8.0 / API 26+, by the device | Standard and big text everywhere; the progress style with segments and points from Android 16 (`progressStyle`), the metric style from Android 17 (`metricStyle`). `getCapabilities().androidPresentation` says which the device draws and offers |
| Android links | Where the device offers `links` | A layout's `url` and a `link` open the app's URL; the app declares the scheme in an intent filter |
| Android alerts of an update | Where the device offers `alert` | An update's alert alerts again; elsewhere the update is silent and the record names `alert` |
| Android end `after` | Where the device offers `delayedEnd` | The last content stays until its time; elsewhere `UNSUPPORTED_FEATURE` |
| Samsung Now Bar extras | Android 17 / API 37+ | With `android.samsungNowBar` on, adds One UI's text extras. Does not put the app on Samsung's allow list |
| macOS, Windows, Linux | No activity backend | Capability queries and a stable unsupported error; no desktop notification fallback yet |
| watchOS, CarPlay, iPhone activities on a Mac | Not a target of their own | Secondary surfaces that the host widget and the OS forward to; they need their own device checks |
| visionOS | Unsupported | ActivityKit refuses starts from compatible iPhone and iPad apps. The plugin's detection of that mode has not run there |
| Browsers and other OSes | Unsupported | The plugin does not claim native activity support |

ActivityKit supports iPad from iPadOS 17
([Apple's ActivityKit session](https://developer.apple.com/videos/play/wwdc2023/10184/)).
On visionOS, compatible iPhone and iPad apps cannot start activities either
([ActivityKit](https://developer.apple.com/documentation/activitykit)).

That API 36 has the promotion APIs does not mean a notification will be promoted. The
compatibility rules for handheld devices on API 36.1 and later require promoted
notifications to show on the lock screen. They do not promote every app's notifications.
Both cases were tested: promotion refused on an API 36 emulator, and promotion granted on
API 37. When channel importance, user settings, the notification's form or OEM rules do
not allow promotion, the plugin falls back to an ordinary notification and says so.
[Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update),
[Android 16 compatibility definition](https://source.android.com/docs/compatibility/16/android-16-cdd).

## Build requirements and runtime checks

The version that introduced an API, the setup that can build this package and the
versions that actually ran are three different things. A version without a test is not
listed as tested.

| Item | Requirement |
| --- | --- |
| Rust | MSRV 1.90, edition 2024; release checks use Rust 1.99.1 |
| Tauri | Tauri 2: Rust `^2.12.5`, JS API `^2.12.4` |
| Apple Swift package | activitykit's: Swift tools 5.9, built for iOS 15+; activity features need the OS versions in the table above. The plugin has no Swift of its own since 0.5 |
| Demo and Widget Extension | The demo app's deployment target is iOS 16.1, the widget extension's 16.2; the 17+ rule applies on iPad |
| Apple toolchain for checks | Xcode 27.2 / iOS SDK 27.2 for the alpha releases; Xcode 26.3 for the 0.2.0 checks |
| Android package | `minSdk = 26` since alpha.3; `compileSdk = 37` |
| Android toolchain for checks | JDK 21, Android SDK 37, NDK 30 |

Xcode 27.2 builds for deployment targets from iOS 15, but it runs apps on devices and
simulators from iOS 17 only. Compile checks and unit tests of the iOS 16.1 and 16.2
branches of 0.3 and earlier, and of the iOS 16.2 branches since, are not reported as runs on
those versions. Running them needs a compatible
Xcode and host of their own.
[Apple's Xcode support table](https://developer.apple.com/xcode/system-requirements/).

An Android host app also needs a supported WebView that meets its own front end's
browser requirements. Whether an old emulator's WebView runs the current bundle is
checked apart from the native notification tests.

The alpha.2 manifest allowed API 24, but an app built from the registry packages crashed
on API 24 while Tauri initialized Jackson, because `BootstrapMethodError` does not exist
there. Tauri also gives Android 8 as its minimum. A lower manifest value alone does not
make an app work on Android 7. On API 26 the real Tauri `Invoke` and Jackson path and
eight native notification tests passed, and the minimum was corrected to 26. That
emulator's stock WebView 58 cannot parse Tauri's JavaScript, so it does not count as a
pass of the full WebView path. The full app path was checked on APIs 31, 33, 36 and 37.
[Tauri issue](https://github.com/tauri-apps/tauri/issues/8788).

## Desktop requirements

Tauri 2.12.5 requires Windows 10+, macOS 10.15+ and WebKitGTK 4.1 on Linux. That does not
mean this plugin implements desktop activities. Which Linux versions an app can ship to
depends on the glibc of the build machine and on the packaging format.
[Tauri's platform table, pinned version](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/README.md#platforms).

A desktop fallback backend has to do more than start: update and remove the same
activity, report errors, handle permissions and reconcile state after a restart. A
general notification library whose removal does nothing on some OSes does not meet this
contract. A desktop backend will not be described as equal to ActivityKit.

## Release rules

The mobile minimums took effect in alpha.3. New test results or docs alone do not change
the package version. A change to native behavior, the supported range or a required build
setting ships as a new version, with the same version on both registries. A published
version is never overwritten. A desktop fallback enters the table above only after its
backend and contract are tested.

Before 1.0 a minor version may change the public API; 0.7 changes Rust callers and TypeScript members as its
changelog lists. The [0.2.0 validation record](validation.md) separates what was checked from what was not,
including old Apple runtimes, physical iPhones and iPads, and how Samsung One UI shows, permits and dismisses
activities. The Android changes of 0.7 have no validation record in this folder yet. A simulator pass does not
stand in for a device check.

## Display and lifetime

- A success response does not prove that the user saw anything. `visibility` is `unknown`.
- JavaScript in the WebView is not guaranteed to keep running while the app is suspended
  or after it is killed.
- The plugin does not get around a dismissal by the user or a revoked permission by
  posting again. After a restart it reconciles stored IDs with the OS state.
- Pushes are iOS only, and FCM and background work are not in this release: the plugin runs no background task.
  Since 0.2.0, buttons, links and toggles work in layout activities only.
- On Android 16 a notification whose time is more than two weeks past shows nothing, and the app is told nothing:
  a timer whose start or end lies that far before the post. The post is answered as shown.
- The plugin picks the notification fallback only with `fallback: "notification"`.
  `none` does not stop the OS from hiding the activity or demoting it later.
- iOS `staleAt` is passed to ActivityKit. An automatic stale transition that the current
  simulator did not show is not counted as a passed test.
