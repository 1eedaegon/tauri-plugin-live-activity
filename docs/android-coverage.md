# Android OS coverage

This adapter implements local progress and countdown activities using Android
notifications. It does not start a foreground service, schedule background work,
or guarantee OEM lock-screen surfaces.

## Platform behavior

| Android API | Adapter behavior | Verification scope |
| --- | --- | --- |
| 24–25 | Legacy standard notification builder; low priority; countdown chronometer | Minimum SDK and lint checks; no runtime claim |
| 26–32 | Dedicated low-importance notification channel; ordinary ongoing notification | API 31 emulator lifecycle and fallback tests |
| 33–35 | Runtime `POST_NOTIFICATIONS`; ordinary notification fallback | Runtime permission transitions exercised on later API 37; no API 33 device claim |
| 36 | Requests promoted ongoing notifications using the documented extra | API 36 emulator lifecycle, permission dialogs and ordinary notification fallback |
| 37 | Same request, actual promotion read from `FLAG_PROMOTED_ONGOING` | API 37 real notification and Tauri bridge checks |

Android requires notification channels from API 26. Users control channel
importance after creation; the plugin does not raise a user's chosen importance.
`IMPORTANCE_NONE` prevents posting and `IMPORTANCE_MIN` cannot satisfy strict
promotion. [Android channel documentation](https://developer.android.com/develop/ui/views/notifications/channels).

Live Updates require an eligible standard notification, an ongoing flag, a title,
the promotion manifest permission and request, and sufficient channel importance.
The OS can still decline or demote the request. The adapter reports the observed
OS flag, keeps `visibility: 'unknown'`, and marks observed promotion rejection as
a degraded feature. [Android Live Updates requirements](https://developer.android.com/develop/ui/views/notifications/live-update).

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

The current suite has 22 JVM tests and eight native instrumented tests. Five
additional real permission-dialog checks run through an installed Tauri WebView
on both API 36 and API 37.
New regression tests cover observed promotion rejection, minimum/blocked channel
importance, permission ambiguity and retry policy, stale deadlines becoming active
after an update, and delivery of the immutable native deletion PendingIntent.
The existing tests cover revisions, duplicate starts, terminal generations,
process recovery, delayed OS observation, posting failures and bounded history.

`tests/android/results/registry-alpha1.json` records an isolated Tauri application
with both `tauri-plugin-live-activity-api@0.1.0-alpha.1` from npm and
`tauri-plugin-live-activity = "=0.1.0-alpha.1"` from crates.io. Its Cargo metadata
identifies the registry source and its npm lock records the registry URL and
integrity. These baseline results are separate from subsequent workspace fixes.

Remaining device checks include physical Samsung One UI/Now Bar behavior,
vendor battery restrictions, API 24–25 rendering, and notification visibility on
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
These verify the local alpha.2 demo and test helpers, not the pending renamed npm release.
