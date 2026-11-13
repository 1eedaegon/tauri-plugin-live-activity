# Android OS coverage

This adapter implements progress and countdown activities, and since 0.2.0 layout activities, using
Android notifications. It does not start a foreground service, schedule background work,
or guarantee OEM lock-screen surfaces.

## Platform behavior

| Android API | Adapter behavior | Verification scope |
| --- | --- | --- |
| 24–25 | Unsupported by the current Tauri/Jackson dependency graph | Unchanged published alpha.2 APK installs on API 24, then fails before plugin initialization; API 25 not run |
| 26 | Dedicated low-importance notification channel; ordinary ongoing notification | Eight native tests pass, including real Tauri `Invoke`/Jackson calls; stock WebView 58 blocks the full JavaScript pipeline |
| 27–32 | Same channel and ordinary notification fallback | API 31 published npm + Cargo consumer passes 13 lifecycle checks and strict-fallback rejection |
| 33–35 | Runtime `POST_NOTIFICATIONS`; ordinary notification fallback | API 33 published consumer passes 13 lifecycle checks and five real permission-dialog checks |
| 36 | Requests promoted ongoing notifications using the documented extra | API 36 emulator lifecycle, permission dialogs and ordinary notification fallback |
| 36.1 | Same request; Android's full Live Update presentation requirements apply | Compile SDK 36.1 build verified; no separate 36.1 runtime claim |
| 37 | Same request, actual promotion read from `FLAG_PROMOTED_ONGOING` | Published consumer passes 13 lifecycle and five permission checks; actual promoted notification and dismissal observed |

## Minimum OS and WebView boundaries

The minimum Android SDK is **26 (Android 8)**. The alpha.2 manifest declared 24,
but an unchanged consumer installed from both registries crashed on API 24 inside
Tauri's Jackson initialization: `java.lang.BootstrapMethodError` does not exist
until API 26. This is an upstream host dependency boundary, so the build now
rejects older Android versions before launch. We do not force a global Jackson
downgrade. [Android API reference](https://developer.android.com/reference/java/lang/BootstrapMethodError),
[Tauri issue 8788](https://github.com/tauri-apps/tauri/issues/8788),
[Jackson's supported Android floor](https://github.com/FasterXML/jackson-databind/issues/4653).

API 26 passes all eight native instrumented tests, including Tauri `Invoke`
serialization, start/update/end, persistence, dismissal, timers and channel
permission denial. Its stock emulator WebView 58 cannot parse Tauri's injected
JavaScript. The app process starts successfully, but this is **not** a full API 26
JavaScript-to-Rust-to-Kotlin pass. A compatible, updated WebView is an independent
host requirement. The official API 33 image's WebView 109 APK has `minSdk=29` and
cannot update this API 26 emulator; no unofficial provider was installed.
[Tauri WebView requirements](https://v2.tauri.app/reference/webview-versions/).
Evidence: [API 24 failure](../tests/android/results/registry-alpha2-api24-boundary.json),
[API 26 native tests](../tests/android/results/native-api26-boundary.json),
[API 26 WebView limitation](../tests/android/results/registry-alpha2-api26-stock-webview.json).
The new merged demo APK declares API 26 and is actually rejected by API 24 with
`INSTALL_FAILED_OLDER_SDK`. The same build passes 13 full Tauri lifecycle checks
on API 37. [Minimum-SDK regression](../tests/android/results/min-sdk26-guard.json).

The release build keeps **compile SDK 37**. An isolated build of the published
Android sources failed with SDK 36 because `EXTRA_REQUEST_PROMOTED_ONGOING` is
defined in SDK 36.1; the same sources built successfully with SDK 36.1. This
compile-time requirement is separate from the API 26 runtime floor. The extra's
constant value is inlined and older Android versions may ignore it.
[Compile experiment](../tests/android/results/compile-sdk-boundary.json),
[Android 16 QPR2 SDK setup](https://developer.android.com/about/versions/16/qpr2/setup-sdk).

Android requires notification channels from API 26. Users control channel
importance after creation; the plugin does not raise a user's chosen importance.
`IMPORTANCE_NONE` prevents posting and `IMPORTANCE_MIN` cannot satisfy strict
promotion. [Android channel documentation](https://developer.android.com/develop/ui/views/notifications/channels).

Live Updates require an eligible standard notification, an ongoing flag, a title,
the promotion manifest permission and request, and sufficient channel importance.
The OS can still decline or demote the request. The adapter reports the observed
OS flag, keeps `visibility: 'unknown'`, and marks observed promotion rejection as
a degraded feature. [Android Live Updates requirements](https://developer.android.com/develop/ui/views/notifications/live-update).
API 36 exposes promotion permission and flag APIs; it does not establish the full
presentation required of API 36.1 handheld implementations. OS eligibility and OEM
policy still decide whether a particular activity is promoted.
[Android 16 compatibility requirements](https://source.android.com/docs/compatibility/16/android-16-cdd).

## Permission cancellation and denial

Swiping away a notification permission dialog leaves Android's permission state
unchanged. Tauri 2.12.5 can nevertheless cache this result as `denied`. The adapter
therefore uses the actual runtime grant and public rationale signal, and records
only an observed denial. It does not use privileged permission-flag APIs.
An ambiguous cached denial returns `unknown`; explicit permission requests remain
available. A first denial with a rationale is `prompt`, while a later false
rationale after that observed denial is `settingsRequired`. A disabled channel
with an already granted runtime permission requires settings.
[Android notification permission behavior](https://developer.android.com/develop/ui/views/notifications/notification-permission),
[Tauri permission implementation](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/crates/tauri/mobile/android/src/main/java/app/tauri/plugin/PluginHandle.kt).

## Regression and package evidence

Before 0.2.0 the suite had 22 JVM tests and eight native instrumented tests. Five
additional real permission-dialog checks run through an installed Tauri WebView
on APIs 33, 36 and 37. API 26 runs the same eight native tests with an API 31-only
test getter guarded and distinct MIN/NONE channels, because API 26 ignores the
test's previous attempt to lower an existing channel to NONE programmatically.
New regression tests cover observed promotion rejection, minimum/blocked channel
importance, permission ambiguity and retry policy, stale deadlines becoming active
after an update, and delivery of the immutable native deletion PendingIntent.
The existing tests cover revisions, duplicate starts, terminal generations,
process recovery, delayed OS observation, posting failures and bounded history.
Recomputing JaCoCo against the current, unchanged main Kotlin sources with the
retained JVM/API 31 execution data gives **315/338 lines (93.20%)** and **204/286
branches (71.33%)**. The 80% line gate passes. This report does not claim fresh
coverage collection on API 26 or 37.
[Coverage inputs and source hashes](../tests/android/results/coverage-alpha3.json).

## Layout activities (contract v2), 0.7.0

0.7.0 runs on liveupdate 0.3.2 and adds links, toggles, the wider Android content, the states of an activity and the
`onOpened` event (see [Android setup](android-integration.md#links)). Run on a Galaxy S23 with Android 17 (API 37):

- The Android library's device tests (`connectedDebugAndroidTest`), 7 of 7. Every content of
  `tests/fixtures/android/contents.json` was posted and read back: a progress with its segments, points and icons,
  the metrics with a stopwatch and a countdown, a header clock, the URL of the notification and of an action as
  activity intents, the channel that alerts, the public version and the branding. A stored tap woke the event sink,
  and an opening intent was stored once.
- The demo, through the plugin's commands in its web view: the lifecycle of a template, and the demo's own 20
  checks. A layout with a toggle and nodes that follow staleness started with `layout.ifStale` in its record;
  with its `staleAt` six seconds ahead and no call of the app, `onState` gave `active` after 0.2 s and `stale` after
  6.1 s; an intent with the marks of a link of that activity gave one `onOpened` with `actionId: "link:1"`; its end
  gave `ended`.

The device tests also ran on an Android 16 emulator (API 36), 7 of 7: all 19 contents were posted there, the three
of the progress style among them, whose posted progress was read back on Android 16 for the first time (the plain
bar of 1000, the segments and points with icons from the resources, and the icons from files). Android 16 draws no
metric, so the two that count are only taken there. That image promotes nothing, so promotion is not shown by it.

Not run: Android 15 and earlier with this version, a tap on a toggle or on a link by a person (the opening intent
came from the shell), the foreground placement with a service of the app, and an activity restored after Android
ended the process. Android 16 shows nothing of a notification whose time is more than two weeks past
([Android setup](android-integration.md#layout-activities-contract-v2)); that was measured on an Android 16
emulator when the device test of the Android contents was written, and not again.

## Layout activities (contract v2), 0.2.0

The v2 work adds 37 JVM tests (59 in all) and six instrumented tests (14 in all), one of
which is a check for a person at the phone that is skipped unless asked for. The JVM tests run every case of `tests/fixtures/layout-requests.json`
(178 valid, 716 invalid at the time of writing) through the Kotlin parser and compare
the verdict, the error code and, for a start or an update, the weight. A run with a
broken rule (one more allowed byte of weight, `spacing` allowed on a `zstack`) fails
that test for exactly the fixtures of those rules. Other JVM tests cover the lifecycle
of layout records (idempotent start, `CONFLICT`, `STALE_REVISION`, `NOT_FOUND`,
tombstones, the update rules and weight, isolation from v1, storage round trip, a minus
zero retried through stored JSON), the layout store over an in-memory preferences file
(small tombstones, its own writes read back without parsing, two writes per update,
corrupt tombstones), the projection onto a notification, the action relay (16 waiting
taps, delivery off the calling thread), the action receiver called without a
`PendingResult`, and the Samsung extras and configuration. The v1 tests are unchanged
and pass.

A JaCoCo report from the JVM tests alone (`coverageReport` with
`connectedDebugAndroidTest` excluded) covers 729 of 739 lines of the classes that do not
need Android. Of the 270 lines that do (the plugin class, the notification ports, the
receivers and the preferences stores) it covers 30: the layout store and the action
receiver run in the JVM over an in-memory preferences file. That is 759 of 1009 lines
(75.2%) in all. The 80% gate combines JVM and instrumented data.

The instrumented tests ran on 2026-11-06. Each runtime passed the gate with the JVM data:

| Runtime | Instrumented tests | Lines, JVM + this runtime | Branches |
| --- | --- | --- | --- |
| API 26 emulator (Android 8.0) | 13 passed, 1 skipped | 958/1009 (94.95%) | 81.12% |
| API 36 emulator (Android 16, SDK 36.0) | 13 passed, 1 skipped | 960/1009 (95.14%) | 82.01% |
| Galaxy S23, API 37 (Android 17, One UI 9) | 9 passed, 1 skipped, 4 left out | 895/1009 (88.70%) | 81.42% |
| All three together | | 971/1009 (96.23%) | 84.66% |

The skipped test is `NativeLayoutHoldTest`, which runs only when asked for. On the S23 the
four tests that open a test activity were left out, because an emergency alert was in
front of the locked phone, so `LiveActivityPlugin.kt` has no coverage from it. The first
API 36 run failed one test, which expected the promotion rules of 36.1 on 36.0; the test
was fixed and the plugin did not change. The
[validation record](validation.md#android-instrumented-tests) has the details.

Not verified on a device: how One UI shows a projected layout, promoted or not; a tap on
a locked phone; delivery after the process was killed. The Samsung extras in the Now Bar
were seen on a Galaxy S23 with One UI 9, as the
[Now Bar notes](android-integration.md#samsung-now-bar) describe, but no test recorded
them on screen. The S23 run checks only that the notification carries them.

`tests/android/results/registry-alpha1.json` records an isolated Tauri application
with both `tauri-plugin-live-activity-api@0.1.0-alpha.1` from npm and
`tauri-plugin-live-activity = "=0.1.0-alpha.1"` from crates.io. Its Cargo metadata
identifies the registry source and its npm lock records the registry URL and
integrity. These baseline results are separate from subsequent workspace fixes.

[The alpha.2 paired registry consumer](../tests/android/results/registry-alpha2.json)
uses the renamed `tauri-plugin-live-activity@0.1.0-alpha.2` npm package and exact
Cargo alpha.2 release. APIs 31 and 37 each pass all 13 bridge checks; the additional
[API 33 run](../tests/android/results/registry-alpha2-api33-lifecycle.json) also
passes all 13. These reports preserve package integrity, source hashes and APK
identity separately from local changes for the next release.

Remaining device checks include physical Samsung One UI/Now Bar behavior,
vendor battery restrictions, API 26 with a compatible WebView, and notification visibility on
locked devices. A standard notification or promoted OS flag does not prove that
the user saw the activity. API 37 also passed an actual horizontal swipe of a promoted notification:
`list()` reported `dismissed` and a late update returned `NOT_FOUND`. This is
recorded separately in `tests/android/results/mochi-api37-user-dismissal.json`.

The macOS 27.2 host encountered crashes in the platform-tools 37 adb daemon.
Runtime checks used an official platform-tools 36.0.2 daemon from a temporary
directory. The Android SDK, NDK and plugin compilation settings were unchanged.

The permission driver now waits for a drawn, visible OS dialog before cancelling
it and rejects stale UI hierarchy dumps. The hardened local WebView selector and
test-app allowlist passed another API 37 run: [five permission checks](../tests/android/results/permission-api37-helper.json)
and [13 lifecycle checks](../tests/android/results/mochi-api37-helper.json).
These historical reports verify the local alpha.2 demo and the then-current test
helpers. The additional [API 33 permission run](../tests/android/results/permission-api33-registry-alpha2.json)
uses Android Back for cancellation: API 33 ignores the earlier Escape key gesture.
All five real dialog assertions pass, including cancellation followed by a retry
that grants access. [API 37 also passes with the Back gesture](../tests/android/results/permission-api37-back-registry-alpha2.json).
