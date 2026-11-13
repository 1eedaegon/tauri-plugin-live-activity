# Android integration and verification

The Android adapter requires API 26 (Android 8) or newer and compile SDK 37. The host app sets
its own target SDK and supplies its usual Tauri Android project. Register the Rust
plugin and grant the Tauri command permissions, as the [usage guide](usage.md#install) shows.
The plugin manifest merges `POST_NOTIFICATIONS` and `POST_PROMOTED_NOTIFICATIONS` and
liveupdate's two receivers, which are not exported: one for button taps and one for
dismissals. The plugin installs no foreground service, network client, custom `RemoteViews` or
background task scheduler. A foreground service for the `foreground` placement is the app's own
([A foreground service](#a-foreground-service)).

Every activity, template or layout, runs on the [`liveupdate`](https://crates.io/crates/liveupdate)
crate, driven by the Android backend of the [`liveactivity`](https://crates.io/crates/liveactivity)
crate, of which the plugin is an adapter. Rust owns request validation, fallback selection,
idempotency, revisions, limits, retry, terminal states and reconciliation. The plugin's Android
library carries liveupdate's own Android adapter, copied from the crate
(`node tools/sync-liveupdate.mjs`, which a test checks; the copy only renames liveupdate's `R` to
the plugin's): a framework adapter with seven bounded operations, which stores Rust's receipts,
posts and cancels notifications, observes them, and drains the taps and dismissals its
receivers stored. The plugin's own Kotlin is the permission commands, the image folder and a
channel that wakes Rust when an event is stored, and the hand-over of the intent that opened the app from
a notification ([Opened](#opened)). Kotlin implements no lifecycle and draws no layout of its own, and it reads the notification settings through liveupdate's adapter alone.

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
pretend to display a runtime permission dialog: `notApplicable` below Android 16, `granted`
when the settings allow promoted notifications, `settingsRequired` otherwise.

The dialog needs an Activity, so the permissions are the plugin's Kotlin and not liveactivity's.
What they rest on, whether notifications and promotion are allowed, the plugin reads from
liveupdate's adapter, the `capabilities` that `getCapabilities` reads too, and nowhere else:
`notifications` is `granted` exactly when liveupdate may post. The first such read creates
liveupdate's channel, as `getCapabilities` does; for an app that targets Android 12L or lower,
Android 13 shows its own dialog when an app creates its first channel.

Progress uses a standard Android notification and timers use the system countdown
chronometer. liveupdate's channel, `liveupdate-rs.v1`, starts at low importance; an update that alerts
posts on its alert channel, `liveupdate-rs.alerts.v1` ("Live update alerts", high importance).
Users retain control of channel importance and visibility. Updates request
`onlyAlertOnce`, and notification clicks open the host app, or the URL of `layout.url` or of a
presentation's `openUrl` where the device offers `links`. Template (v1) activities
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

`end` supports `immediate` and `default`, both removing the Android notification. The `after` policy
keeps the last content on screen, no longer ongoing, until its time, where the device offers `delayedEnd`;
elsewhere it returns `UNSUPPORTED_FEATURE` before removal.

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

This storage key is new in 0.4.0. End running template activities before upgrading from a
release that used the former Kotlin lifecycle (0.3 and earlier); old receipts are not imported, and
Android can otherwise leave an old notification posted. Layout receipts are unchanged.

## Layout activities (contract v2)

`startLayout`, `updateLayout`, `endLayout` and `listLayout` work on Android with the
rules of the [request contract](request-contract.md#request-contract-v2-layout), checked
in Rust as on every platform. A notification cannot draw a layout, so the liveactivity
crate, on which the plugin runs, projects the lock screen tree onto one of liveupdate's
schema-v2 presentations, and liveupdate keeps the lifecycle, the receipts and the
notification. What liveupdate does not keep, the layout request and its latest values,
liveactivity stores under liveupdate's id in the file the plugin names,
`tauri-live-activity/layouts.json` of the app's private files; it forgets an activity once
liveupdate no longer lists it.

The lifecycle has the public guarantees of v1: an idempotent start compares the whole start
request (`android` included) and answers `CONFLICT` for another request under a running
key, `STALE_REVISION` for a lower revision, `CONFLICT` for the same revision with other
values, `NOT_FOUND` for an unknown, ended or dismissed id, tombstones after a swipe or an
end, `UNSUPPORTED_FEATURE` for `after` where the device does not offer `delayedEnd`, and
liveupdate's limits (32 active records and 128 tombstones, templates and layouts together). An
update must keep the keys and value types of the start. The record carries the layout snapshot
the app sent, not the projection.

The template of a notification is fixed when it is posted, so liveactivity chooses it from
the tree, conditions aside, and keeps it for the generation: the first `progress` gives
liveupdate's Progress style, else the first `timerText` Timer, else two or more texts
BigText, else Standard. It walks the tree in document order (`children` order, depth
first) with the current values and the `if`/`unless` conditions applied:

| Layout | Notification |
| --- | --- |
| first shown `text` | title, cut to 120 code points; the app's name when the layout shows no text, because a notification without a title cannot be promoted |
| second shown `text` | the status line, cut to 240; with `BigTextStyle` for a BigText template. Without a second text the status is the chip text, then the title |
| first shown `progress` | the progress bar, clamped to 0..1; 0 while the node is hidden |
| first shown `timerText` | the chronometer: counting down to `end`, or up from `start` with `countsDown: false`; the tree's first timer while it is hidden. Beside a progress it is the clock in the header, where the device offers `chronometer` |
| up to three `button`s, `link`s and `toggle`s, in document order | actions, titled with the first shown text inside the node (cut to 64), or with the label of the first node inside that has a text, then the node's own label. A `link` opens its URL; a `toggle` has a check mark before its title while its value is on |
| `layout.url` | the URL a tap on the notification opens, where the device offers `links` |
| a shown `symbol`, `path`, `gauge`, `custom`, `spacer`, `divider` or asset `image` with an `accessibility` label or value | a text in its place among the texts, from the label, the value, or both |
| first `image` with a `file` source | large icon: the PNG that `writeImage` wrote, when it is at most 1024 pixels a side and 1 MiB; nothing when it is missing |
| `android.visibility` | lock screen visibility: `public`, `private` (also when absent) or `secret` |

Texts inside an action only label it. A button, link or toggle without a title, a fourth action or
with an `actionId` that is taken, a second progress or timer, a timer under a Progress template where
the device has no `chronometer`, and every other shown node are left out and named once in
`degradedFeatures` as `layout.<type>` (for example `layout.symbol`, `layout.spacer`, a third text as
`layout.text`, an asset image or a second file image as `layout.image`, a custom view as
`layout.custom`). Among the other names, `layout.ifStale` is listed when a node has `ifStale`, since
Android draws the layout as it is while fresh; `layout.transition` for a shown node with a
`transition`; and `layout.privacy` for a shown node with `privacy` when `android.visibility` is
`public`. `layout.island`, `layout.styles`, `layout.background` and `layout.keyline` are added when the
request has them: a notification draws no styles, so a bound color changes nothing on Android. A node
hidden by its condition is not listed. liveupdate's own `nativeLiveActivity` comes first. The list is
computed from the current values, so it can change with an update.

The status chip text (`setShortCriticalText`, API 36+) is the percentage (`65%`) when a
progress shows and no timer. With a timer it is left out so that the chip shows the
chronometer, and text alone gives none. `writeImage` writes to `tauri-live-activity/images`
in the app's private files (`filesDir`); liveupdate reads the icon from there. Nothing on
Android draws a custom font, an asset image or a custom view.

A snapshot may say what Android shows in Android's own terms instead: an `android` content with
a title, a status and one of liveupdate's presentations (a progress with segments and points,
metrics, the chip text, actions with icons). It replaces the projection for that snapshot, its
record lists nothing of the layout in `degradedFeatures`, and a tap on one of its actions comes
through `on_action` like a button's; an action with `openUrl` opens its URL and sends no tap. A
snapshot may have another notification style than the activity's first where the device offers
`styleChange`; elsewhere a content of another style answers `UNSUPPORTED_FEATURE`.
`getCapabilities().androidPresentation` reports which styles the device draws and which members it
offers ([usage](usage.md#android-content)).

An update's `alert` alerts again where the device offers `alert`; elsewhere the update is silent and
the record names `alert` in `degradedFeatures`. Android alerts with the sound of its channel, so a
`sound` is not played, and the record names `alert.sound`.

Layouts with a `progress`, and contents of the `progress` style, are posted on Android 16. The adapter
the plugin carries is liveupdate 0.3.2's, which does not call the method that only Android 17 has. Below
Android 16 liveupdate posts the plain bar, as the progress template does on every Android.

Known: on Android 16 a notification whose time is more than two weeks past is not shown, and the app is
told nothing: the post is answered as shown. liveupdate sets the time of a timer alone, its end when it
counts down and its start when it counts up, so a timer that ended or began more than two weeks before
the post shows nothing. Measured on an Android 16 emulator: a time 13 days ago shows, one 15 days ago does
not.

The notification keeps what a Live Update needs, as liveupdate posts it: ongoing, a title,
a system style, no custom views, not colorized, not a group summary, liveupdate's
low-importance channel (`liveupdate-rs.v1`) and a content intent that opens the app, or the URL of
`layout.url` or of the presentation's `openUrl` where the device offers `links`.
Promotion is requested when the settings allow it; `fallback: 'none'` fails the start with
`UNSUPPORTED_FEATURE` otherwise.

## Buttons

Each projected action of a button, a link or a toggle becomes a notification action. A button's action
carries an immutable `PendingIntent` to liveupdate's `LiveUpdateActionReceiver`, which is not exported.
The receiver stores the tap in liveupdate's durable event queue (the newest 128) and calls the listener
that the plugin registered (`LiveUpdateEvents.setListener`), which wakes a thread of the plugin
(`live-activity-events`). That thread drains `LiveUpdate::events()`, adds the `activityKey` of a known
activity, drops a tap on an action id that neither the activity's layout nor an Android content it has
shown declared, and hands each tap to the handlers of `on_action` on the plugin's actions thread, never
the main thread, so a handler may call the plugin. The thread drains once more when the plugin starts,
so a tap stored while the app did not run arrives when it does.

A toggle's tap has `on`: the state the person asked for, the other one than the value of the activity's
latest snapshot, read when the tap is handed over. A link's action sends no tap; it opens its URL
([Links](#links)).

The dismissal of a notification is stored and drained the same way, and the plugin reports it as the
state `dismissed` (`live-activity://state`, `onState`). Each state that an activity has when the plugin
looks is reported once: `active`, `stale`, `ended` and `dismissed`, for templates and layouts alike. The
events thread also wakes at an activity's stale time, so `stale` arrives while the app runs. `list` and
`listLayout` reconcile both with the notifications Android shows.

When the app's process was killed, a tap starts the process and runs liveupdate's receiver,
which stores the tap; Android starts no activity for it, so the Tauri runtime is not
loaded. The tap reaches `on_action` when the Tauri runtime starts in a later process, for
example because the user opens the app. An action that must work without the app's UI,
such as a recording toggle handled by a foreground service, needs a native target in the
host app; the plugin does not provide one.

## Links

A layout's `url` is what a tap on the notification opens, and each `link` node is an action that opens its
URL. Both need no Kotlin in the app, only one of its activities that declares the URL's scheme: liveupdate
opens a URL with `ACTION_VIEW` inside the app's own package, so the activity needs an intent filter for it:

```xml
<activity android:name=".MainActivity" android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:scheme="myapp" />
    </intent-filter>
</activity>
```

A URL has a lowercase scheme, and it is none of `intent`, `content`, `file`, `javascript`, `data` and
`android-app`. Without such an activity a layout's links are left out and named (`layout.url` and
`layout.link` in `degradedFeatures`), and a tap opens the launch activity. A content whose URL no activity
opens is `INVALID_INPUT`, and nothing is posted.

### Opened

The person opened the app from a notification of an activity: the notification itself, or an action that
opens a URL. The plugin's Kotlin hands the intent of each opening to liveupdate (`LiveUpdateEvents.opened`),
when the activity is created with a new intent and when a running one gets a new intent, so an app writes no
Kotlin for it. liveupdate stores the opening with the activity and the action, and the events thread reports
it as `live-activity://opened` (`onOpened`, Rust `OPENED_EVENT`) with the activity's id and key. The action is
absent when the person tapped the notification itself; otherwise it is `link:<n>` for the nth `link` of the
lock screen tree, or the id of an action of an Android content. The URL itself reaches the app as any deep
link, through the activity that declares its scheme.

## A foreground service

A start with `android: { placement: 'foreground' }` asks for the notification to be the one that a foreground
service of the app holds, so that the service shows no second one. The service, its type and its permission
are the app's; the plugin's library declares none. The service attaches the activity's notification with
`LiveUpdateForeground.attach(service, foregroundServiceType)`, which answers false when no activity holds the
placement, and the app's `LiveUpdateForeground.setListener` stops the service when the notification is released
(an end). One running activity holds the placement at a time: a second is `SYSTEM_LIMIT`. A device that does not
offer `foregroundPlacement` answers `UNSUPPORTED_FEATURE`. Without a service the notification is an ordinary one.

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

  Layout notifications then carry, through liveupdate's Samsung mapping,
  `android.ongoingActivityNoti.style` = 1 (an `Int`), `primaryInfo` (`CharSequence`) and
  `nowbarPrimaryInfo` (`String`) with the title, and `secondaryInfo` and
  `nowbarSecondaryInfo` with the status line, or with the status chip text when there is no
  second text. With the developer option on, the pill then shows the body
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
on Android yet: liveupdate stores its records in full in an app-private preferences file,
and the plugin its layouts and values in `tauri-live-activity/layouts.json`.

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
Tauri 2.12.5 Android sources. It is not a mock Tauri implementation. The JVM tests cover
what the plugin's own Kotlin decides: the notification permission's state over what Android
and Tauri answer, and the permissions over what liveupdate's adapter observes. The
instrumented tests (`NativeBridgeTest`) run on an emulator or a phone: liveupdate's bounded
protocol through the plugin's command, with a real notification posted, observed and
cancelled, the plugin's permissions beside what the adapter observes, a tap on an action
through its PendingIntent, which wakes the event sink and drains through the bridge, and every
Android content of `tests/fixtures/android/contents.json` posted and read back from the
notification that Android holds. JaCoCo
line coverage of the plugin's own classes must reach 80%; liveupdate's copied adapter is
left out, since liveupdate tests it. The report is under
`android/build/reports/jacoco/coverageReport`. The lifecycle, the layout projection and the
Samsung extras are tested where they live, in the liveactivity and liveupdate crates; the
fixtures of both contract versions by this repository's Rust and node tests. The plugin's
Android transport in Rust (`src/android.rs`) is compiled for Android alone and runs in no host
test: the full Tauri demo exercises JavaScript → Rust → Kotlin.

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
