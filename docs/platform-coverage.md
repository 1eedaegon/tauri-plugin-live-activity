# Platform coverage

Researched on 2026-11-04; the layout section was added for 0.2.0. This page keeps three
things apart: what the OS offers, what the plugin implements and which tests actually
ran. Detailed results are in the [validation record](validation.md). Minimum versions are
in [OS compatibility](compatibility.md), and desktop options in
[desktop coverage](desktop-coverage.md).

## Templates (contract v1)

| Platform | Implemented | Tested, and what remains |
| --- | --- | --- |
| iPhone / iOS 16.2+ (16.1+ before 0.4) | ActivityKit progress and timer: start, update, end, list; since 0.4 as layout activities through activitykit | Ran on the iOS 27.2 simulator before 0.4. 16.1 and 16.2 had availability branches and build checks only; no run on a device with those versions |
| iPadOS 17+ | ActivityKit progress and timer; iPadOS 16.x is unsupported | 13 lifecycle checks and 10 further checks passed on the iPadOS 27.2 simulator. Older versions have policy unit tests |
| Android API 24–25 | Unsupported; the minimum was raised to API 26 | On API 24 the published alpha.2 app crashed in Tauri's Jackson initialization. API 25 was not run on its own |
| Android API 26–32 | Ongoing progress and timer notifications | API 26: real Tauri `Invoke` and 8 native notification tests passed; its stock WebView 58 cannot parse Tauri's JavaScript. API 31: 13 full app lifecycle checks passed |
| Android API 33–35 | The above, plus the runtime notification permission | API 33: 13 full app lifecycle checks and 5 real permission dialog checks passed. API 34 and 35 were not run on their own |
| Android API 36+ | Live Update promotion request for eligible notifications; an explicit fallback when it is refused | API 37: promotion flag observed. API 36 emulator: ordinary notification fallback while promotion was refused. Real permission dialog checks passed on both |
| macOS | Explicitly unsupported | Checks that the host's Tauri IPC does not advertise unsupported features and returns a stable error |
| Windows / Linux | Explicitly unsupported | The same Tauri IPC contract passes in CI on each OS. No native notification UI is implemented or tested |

## Layouts and buttons (contract v2), 0.2.0

Layouts and their buttons are new in 0.2.0 and have been tested less than templates.

- iOS: the native harness ran every layout fixture on an iPhone 17 Pro simulator with
  iOS 26.3. The Lock Screen showed the layout, and a tap on a button reached the plugin's
  action hub. Buttons need iOS 17.
- Android: JVM tests cover the parser, the layout lifecycle, the projection onto a
  notification, the action relay and the Samsung extras. The instrumented tests passed on
  API 26 and API 36 emulators and on a Galaxy S23 with Android 17 (One UI 9), apart from
  one test that runs only when asked for. On the S23 four tests that open a test activity
  were left out. With the JVM data, line coverage was 88.70% to 95.14% per runtime, above
  the 80% gate. Nobody looked at how One UI shows a layout.
- No physical iPhone run of 0.2.0 is recorded here. The
  [validation record](validation.md#not-verified) lists what remains.

## Apple's secondary surfaces

ActivityKit can show an activity that an iPhone started on other screens too, such as
Apple Watch, a Mac or CarPlay. That is not this Tauri plugin running on those OSes. A Mac
shows iPhone activities only through iPhone Mirroring and the user's settings. The
simulator results here do not prove delivery or interaction on those surfaces.
[ActivityKit](https://developer.apple.com/documentation/activitykit),
[Apple's guide to Live Activities on a Mac](https://support.apple.com/en-ie/120684).

## What to keep apart on Android

A newer Android version does not guarantee promotion. Check the notification permission,
the channel importance, the notification's form, the user's promotion setting and what
the OS actually did. An ordinary ongoing notification is not recorded as a Live Update. A
promotion on an emulator is not a check of Samsung One UI's Now Bar.
[Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update).

## Other desktop APIs

Windows has a progress notification API that updates through data binding. The plugin's
current backend does not use it.
[Windows progress notifications](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar).

On Linux, freedesktop notifications and the XDG Notification portal can replace a
notification that has the same ID. How it looks and what it can do depend on the
notification server, and the portal does not report whether the user saw it. This is not
an implemented backend either.
[freedesktop specification](https://specifications.freedesktop.org/notification/latest-single/),
[XDG Notification portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html).

## Scope of the alpha.2 checks

- The two alpha.2 packages from npm and crates.io, linked into a real Tauri app and run on
  iPhone and iPad simulators and on Android emulators. The alpha.1 results are kept
  separately as the earlier baseline.
- Timers, stale dates, end policies, restarts and concurrent requests, besides progress.
- Android permission dialog cancellation, channel importance changes, and promotion both
  allowed and refused.
- Capability queries on macOS, Windows and Linux, and the unsupported error for permitted
  IPC calls.
- Captures of Mochi's snack delivery and nap demo, in the app and on the real OS surfaces.

Availability compile checks of the published shared module and the plain widget were
added for iOS 16.1, 16.2 and 17.0. Xcode 27.2 cannot run those versions and Apple limits
runtime downloads, so these checks do not replace runs on an old OS.
[Old runtime research](../tests/ios/results/old-runtime-feasibility.json).

A device, OS or surface without a real test result is not listed as supported.

The Windows and Linux contract tests passed in the Desktop contract jobs of the
[alpha.2 release CI run](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/41894264762).
macOS ran the same tests locally. For 0.2.0, see the [validation record](validation.md#ci).
