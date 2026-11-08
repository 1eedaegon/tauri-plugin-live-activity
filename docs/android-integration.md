# Android integration and verification

The Android adapter requires API 26 (Android 8) or newer and compile SDK 37. The host app sets
its own target SDK and supplies its usual Tauri Android project. Register the Rust
plugin and grant the Tauri command permissions, as the [usage guide](usage.md#install) shows.
The plugin manifest merges `POST_NOTIFICATIONS` and `POST_PROMOTED_NOTIFICATIONS` and
two receivers that are not exported: one for dismissals and one for button taps.
No foreground service, network client, custom `RemoteViews`, or background task
scheduler is installed.

Template activities use [`1eedaegon/liveupdate-rs`](https://github.com/1eedaegon/liveupdate-rs).
Rust owns request validation, fallback selection, idempotency, revisions, limits, retry,
terminal states and reconciliation. The Android side is a framework adapter with only six
bounded operations: capabilities, read receipts, replace receipts, observe notifications,
post and cancel. Kotlin does not implement `start`, `update`, `end` or `list` for contract v1.
It stores Rust's receipt without interpreting lifecycle policy and projects an accepted receipt
onto `NotificationManager`.

Set `bundle.android.minSdkVersion` to `26` or higher in `tauri.conf.json`;
`npx tauri-plugin-live-activity setup` does this, and sets `minSdk` in an existing
`gen/android` project. Tauri's Jackson dependency fails before plugin initialization
below API 26. The host also
needs a WebView compatible with its Tauri/frontend JavaScript; the API 26 emulator's
stock WebView 58 is too old. See the [boundary evidence](android-coverage.md).

## Display and permissions

Call `requestPermissions('notifications')` after a user action. Android
13+ can show the notification dialog. A first denial can remain `prompt` when
Android allows another request; a repeated denial after an observed rationale is
`settingsRequired`. Tauri also caches cancelled dialogs as denied. When that cache
cannot distinguish cancellation from an external permanent denial, the adapter
returns `unknown` and permits an explicit request retry. A blocked channel with
runtime permission already granted returns `settingsRequired`. Promotion is controlled by
Android settings, so requesting `promotion` returns its current state and does not
pretend to display a runtime permission dialog.

Progress uses a standard Android notification and timers use the system countdown
chronometer. The dedicated `tauri.live-activity.v1` channel starts at low importance.
Users retain control of channel importance and visibility. Updates request
`onlyAlertOnce`, and notification clicks open the host app. Template (v1) activities
have no actions; layout (v2) activities can, see [Buttons](#buttons).

On Android 16+ the adapter checks `canPostPromotedNotifications()` and channel
importance above `IMPORTANCE_MIN`, then requests
promotion with the documented boolean notification extra. It avoids the framework
builder convenience method that first requires API 36.1. Older OS builds can
ignore unknown extras safely. The result reads `FLAG_PROMOTED_ONGOING` from
`NotificationManager.activeNotifications`; a request is never counted as proof
that the OS promoted it. `fallback: 'none'` rejects a start when promotion is
unavailable before posting. The OS can still decline or subsequently remove
promotion. An observed `notPromoted` result includes `nativeLiveActivity` in
`degradedFeatures`. Notification permission denial is always an error.

`end` supports `immediate` and `default`, both removing the Android notification.
The `after` policy returns `UNSUPPORTED_FEATURE` before removal.

## Ordering, dismissal, and recovery

Rust serializes commands with a process lock. Each activity has a random
UUID handle and dedicated `(tag, id)` pair. No hash-based notification identifier
allocation or `cancelAll()` is used. A duplicate start compares the original start
request, even after later updates. Revisions increase monotonically; equal content
is idempotent, conflicting content is rejected, and terminal handles never update
a replacement activity with the same application key.

Notification posting is asynchronous. An accepted request is persisted before
posting with `awaitingObservation`; its returned state can be `unknown`. Ordered
subsequent updates are allowed, but an older OS snapshot cannot overwrite the
accepted revision. `list()` reconciles the OS snapshot. Once observed, removal becomes
`dismissed`. Template activities need no Kotlin deletion receiver: Rust derives dismissal
from the adapter's current notification observations. A missed native notification query is not treated as confirmation
that a pending request was shown. Native visibility remains `unknown`, because
posting cannot prove that the user saw the notification.

The thin adapter stores Rust's receipts verbatim in app-private SharedPreferences, including
the original request and last accepted snapshot so idempotence survives process recreation.
Do not put credentials or secrets in activity text. At most 32 nonterminal records
and the latest 128 terminal records are retained. An evicted terminal handle
returns `NOT_FOUND`. Corrupted stored or owned notification metadata returns a
native error instead of being silently discarded. Native extras alone never grant
ownership to an unknown or evicted handle. Identity is committed before posting,
so process recovery reconciles only existing durable records. A write-ahead
posting-required flag means a known posting failure or failed follow-up metadata
write stays retryable; an identical retry attempts posting the same handle again.
A crash between persisting and posting can leave a pending `unknown` receipt;
explicitly end that
handle before restarting if it never becomes observable.

This storage key is new in 0.3.0. End running template activities before upgrading from a
release that used the former Kotlin lifecycle; old receipts are not imported, and Android can
otherwise leave an old notification posted. Layout receipts are unchanged.

## Layout activities (contract v2)

`startLayout`, `updateLayout`, `endLayout` and `listLayout` work on Android with the
rules of the [request contract](request-contract.md#request-contract-v2-layout). The
Kotlin side parses every request again with the same strict rules and weight as the
other layers; its unit tests run every case of `tests/fixtures/layout-requests.json`.
Contract v2 remains a Kotlin layout engine because it interprets the custom layout tree,
styles, images and actions; `liveupdate-rs` currently covers the fixed progress/timer templates.
Its lifecycle has the same public guarantees as v1: an idempotent start compares the whole start request
(`android` included), `CONFLICT`, `STALE_REVISION`, `NOT_FOUND`, tombstones after a
swipe or an end, and at most 32 active and 128 ended records per contract version. An
update must keep the keys and value types of the start, the stored layout's value rules
are checked again (the values of bound style members included), and the stored layout and
styles plus the new values must weigh at most 3584 (`PAYLOAD_TOO_LARGE`). The two versions do not see each other: layout records
live under their own preferences key (`layoutRecords`), and layout notifications use the
tag prefix `tauri.live-activity.layout:`, so template code never reads them. Stored layout
records are unchanged by the Rust template integration. The notification carries the handle, the
snapshot and the promotion request, not the layout.

A live layout record keeps its whole start request, so a retried start can be compared
with it. An ended or dismissed record keeps only what its record shows (key, snapshot,
state, promotion and `degradedFeatures`) and the action ids of its buttons, not the
layout, the styles or the start values, so 128 tombstones stay small. The plugin parses
the stored records once per process and then reads its own writes back from memory. A
post writes the file twice: once before posting, and once with the post confirmed and
what the system shows by then. A command writes once more first when the system's
notifications changed since the last write. A minus zero (`-0.0`, as Rust's
serde_json writes an f64 minus zero) is read as 0, as `JSON.stringify` writes it, so a
retry of the same request through Rust is idempotent.

A notification cannot draw a layout, so the plugin projects the lock screen tree onto
one. It walks the tree in document order (`children` order, depth first) with the
current values and the `if`/`unless` conditions applied:

| Layout | Notification |
| --- | --- |
| first `text` | title; the app's name when the layout shows no text, because a notification without a title cannot be promoted |
| second `text` | text, with `BigTextStyle` (the width of a line is not known before posting, so every body gets it; a short body looks the same) |
| first `progress` | progress bar, clamped to 0..1 |
| first `timerText` | chronometer: counting down to `end`, or up from `start` with `countsDown: false` |
| up to three `button`s | actions, labelled with the first text inside the button |
| first `image` with a `file` source | large icon: the PNG that `writeImage` wrote, scaled down by powers of two to at most 256 pixels; nothing when the file is missing |
| `android.visibility` | lock screen visibility: `public`, `private` (also when absent) or `secret` |

Texts inside a button only label it. A button without a shown text, a fourth button and
every other shown node are left out and named once in `degradedFeatures` as
`layout.<type>` (for example `layout.symbol`, `layout.spacer`, a third text as
`layout.text`, an asset image or a second file image as `layout.image`, a custom view
as `layout.custom`). A style's `fontFamily` is one of the styles, which a notification
does not draw. `layout.island`, `layout.styles`, `layout.background` and
`layout.keyline` are added when the request has them, bound or literal: a notification
draws no styles, so a bound color changes nothing on Android. A node hidden by its condition is
not listed. `nativeLiveActivity` follows the v1 rule. The list is computed from the
current values, so it can change with an update.

The large icon is the one picture a notification takes from a layout. Google's
[Live Update requirements](https://developer.android.com/develop/ui/views/notifications/live-update) list the
styles, the title, no custom views, not colorized, not a group summary and the channel importance; they do not
name the large icon, so a drawn image keeps promotion. OEMs can add rules of their own, and One UI was not
checked with a large icon. `writeImage` writes to `tauri-live-activity/images` in the app's private files
(`filesDir`): Android has no App Group, and the app posts the notification itself. Nothing on Android draws a
custom font, an asset image or a custom view.

The status chip text (`setShortCriticalText`, API 36+) is set only when the layout gives
one: with a progress bar and no timer it is the percentage (`65%`). With a timer it is
left out so that the chip shows the chronometer, and text alone gives none.

The notification keeps what a Live Update needs: ongoing, a title, the standard or
BigText style, no custom views, not colorized, not a group summary, the low-importance
channel and a content intent that opens the app. Promotion is requested as for v1.

## Buttons

Each projected button becomes a notification action. Its `PendingIntent` is explicit
and immutable and goes to the plugin's `ActionReceiver`, which is not exported; the
intent carries the activity handle and the action id. Actions call
`setAuthenticationRequired(false)` on API 31+. Android then decides whether a locked
phone asks for the keyguard; the plugin cannot force it.

The receiver reads the stored layout record. A known activity adds its `activityKey`
and must have a button with that action id, otherwise the tap is dropped; this holds for
an ended activity too. An unknown or evicted handle is sent without a key. Rust passes the channel to the native
`registerActions` command once, during plugin setup. Taps go to it on the plugin's own
thread (`live-activity-actions`), never the main thread, so an `on_action` handler may
call the plugin. Each tap waits there until Rust's handlers have run (at most 4 s), one
tap at a time. A tap that arrives before the channel is registered is kept in memory,
the newest 16, and sent when it is.

When the app's process was killed, a tap starts the process and runs the receiver, but
Android starts no activity for it, so the Tauri runtime and the plugin are not loaded.
The tap then waits in memory. It reaches `on_action` if the Tauri runtime starts in that
process, for example because the user opens the app; it is lost when the process ends.
Taps are never written to disk, so an old tap cannot fire in a later process. An action
that must work without the app's UI, such as a recording toggle handled by a foreground
service, needs a native target in the host app; the plugin does not provide one.
While the process lives without an activity (exit prevented, for example by a
foreground service), the tap still reaches Rust, but a handler cannot call the plugin:
Tauri needs an activity for every call into Kotlin.

## Samsung Now Bar

One UI decides on its own whether a Live Update appears in the Now Bar. What follows was
read from the system files of a Galaxy S23 on One UI 9 (Android 17) and seen on that
phone; nothing here comes from a Samsung developer document, because none was found.

Two surfaces differ. The Now bar settings list (Settings > Lock screen and AOD > Now bar
> Live notifications > See all) holds only apps on Samsung's allow-list. The Now Bar pill
on the lock screen and the status bar chip appear for an app outside the list only while
the user's developer option below is on, and only for a notification that Android
counts as a promotable Live Update.

What the app can do:

- Post a valid Live Update: ongoing, with a title, the standard, BigText, Progress or
  (API 37) Metric style, no custom views, not colorized, not a group summary, a channel
  above `IMPORTANCE_MIN`, a content intent that opens an activity, and the promotion
  request. The plugin does this and merges `POST_PROMOTED_NOTIFICATIONS` into the
  manifest.
- Opt in to One UI's text extras in the plugin configuration:

  ```json
  { "plugins": { "live-activity": { "android": { "samsungNowBar": true } } } }
  ```

  Layout notifications then carry `android.ongoingActivityNoti.style` = 1 (an `Int`),
  `primaryInfo` (`CharSequence`) and `nowbarPrimaryInfo` (`String`) with the title, and
  `secondaryInfo` and `nowbarSecondaryInfo` with the body, or with the status chip text
  when there is no body. With the developer option on, the pill then shows the body
  instead of the chip text. On One UI 9 the style extra does not cancel the developer
  option. Reports from One UI 8.5 (Android 16) say that it does there; that was not
  checked in code or on a device, so the plugin sends the extras on Android 17 (API 37)
  and later only. Template (v1) activities never carry them. The plugin never sends the
  undocumented `automation` extras, which show the pill under another app's name.
- Add `<meta-data android:name="com.samsung.android.support.ongoing_activity"
  android:value="true" />` to the app's `<application>`. It does nothing unless Samsung
  has listed the package; it is needed only if Samsung lists it without the `RON` flag.
  The plugin does not add it.
- Read the developer option with `Settings.Secure.getInt(resolver,
  "enable_notification_nowbar_test", -1)` (-1: absent). An app cannot change it.

What only Samsung can do: put the app on its allow-list, which decides the Now bar
settings list and the per-app switch there. The list is built into the firmware and
Samsung's servers can replace it. No manifest entry, extra, category, channel
importance, installer or permission adds an app, and the developer option does not
either. Samsung reviews apps; no public way to apply was found.

What only the user can do:

- Turn on the developer option "Live notifications for all apps"
  (`Settings.Secure enable_notification_nowbar_test` = 1; reported in Korean as "모든 앱의
  실시간 정보 보기", not checked against Samsung's own strings). It is off by default and a
  One UI update may turn it off again. It shows the pill and the chip for every app with a
  promotable Live Update; it does not add the app to the settings list.
- Allow lock screen notifications (Settings > Notifications > Lock screen notifications)
  and, for the app, notifications on the lock screen with their content shown.
- On One UI 9, Good Lock's QuickStar "Ongoing Chip" option can hide the status bar chip.

The chip and the card are held back while the app's own activity is in front; whether
the lock screen pill is too was not confirmed. The plugin changes none of these settings
and does not read them.

## Plugin configuration on Android

`android.samsungNowBar` is the only option that Android reads. `receipts` has no effect
on Android yet: records, layouts and values are stored in full in the app-private
preferences file.

## Reproduce validation

From the repository root, with the Android SDK and a running emulator:

```sh
source tools/mobile-env.sh
cargo fetch
./tests/android/gradlew -p tests/android -PliveActivityCoverage=true \
  :live-activity:testDebugUnitTest \
  :live-activity:connectedDebugAndroidTest \
  :live-activity:lintDebug \
  :live-activity:coverageVerification
```

The isolated Gradle harness compiles the actual plugin against Cargo's downloaded
Tauri 2.12.5 Android sources. It is not a mock Tauri implementation. JVM tests cover
lifecycle ordering, permissions/fallback policy, bounded history and shared input
fixtures of both contract versions (`tests/fixtures/requests.json` and every case of
`tests/fixtures/layout-requests.json`, with its error code and weight), the layout
projection, the action relay and the Samsung extras. Instrumented tests execute real
notifications, permission checks, Tauri native response envelopes, persistence,
dismissal and, for layouts, actions sent through their PendingIntent. Combined JaCoCo line coverage
must reach 80%; the report is under `android/build/reports/jacoco/coverageReport`.
The full Tauri demo separately exercises JavaScript → Rust → Kotlin.

`NativeLayoutHoldTest` is skipped unless `-e liveActivityHold <seconds>` is passed. It
then posts a layout notification for a person at the phone, updates its body every
5 seconds, logs every tap under the logcat tag `LiveActivityHold`, and ends the activity
at the end unless `-e liveActivityKeep true` is passed. `-e samsungNowBar true` adds the
One UI extras.
Verify a built demo's merged minimum SDK with:

```sh
node tests/android/verify-min-sdk.mjs "$ANDROID_HOME/build-tools/37.0.0/aapt" \
  examples/demo/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## Research sources

- [Tauri mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [Tauri notification plugin source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/android/src/main/java/NotificationPlugin.kt)
- [Android Live Update requirements](https://developer.android.com/develop/ui/views/notifications/live-update)
- [Android notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)

Emulators do not reproduce Samsung One UI/Now Bar, lock-screen policies of every
vendor, or physical-device battery/background limits. Those remain separate
checks before claiming a specific Galaxy device is verified.
