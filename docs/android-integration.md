# Android integration and verification

The Android adapter requires API 24 or newer and compile SDK 37. The host app sets
its own target SDK and supplies its usual Tauri Android project. Register the Rust
plugin and grant the Tauri command permissions shown in the repository README.
The plugin manifest merges `POST_NOTIFICATIONS` and `POST_PROMOTED_NOTIFICATIONS`.
No foreground service, network client, custom `RemoteViews`, or background task
scheduler is installed.

## Display and permissions

Call `requestPermissions('notifications')` after a user action. Android
13+ can show the notification dialog once; a denied or channel-blocked state is
reported as `settingsRequired` on subsequent calls. Promotion is controlled by
Android settings, so requesting `promotion` returns its current state and does not
pretend to display a runtime permission dialog.

Progress uses a standard Android notification and timers use the system countdown
chronometer. The dedicated `tauri.live-activity.v1` channel starts at low importance.
Users retain control of channel importance and visibility. Updates request
`onlyAlertOnce`, and notification clicks open the host app. Custom click routes and
actions are not part of this alpha.

On Android 16+ the adapter checks `canPostPromotedNotifications()` and requests
promotion with the documented boolean notification extra. It avoids the framework
builder convenience method that first requires API 36.1. Older OS builds can
ignore unknown extras safely. The result reads `FLAG_PROMOTED_ONGOING` from
`NotificationManager.activeNotifications`; a request is never counted as proof
that the OS promoted it. `fallback: 'none'` rejects a start when promotion is
unavailable before posting. The OS can still decline or subsequently remove
promotion. Notification permission denial is always an error.

`end` supports `immediate` and `default`, both removing the Android notification.
The `after` policy returns `UNSUPPORTED_FEATURE` before removal.

## Ordering, dismissal, and recovery

Commands and dismissal handling share a process lock. Each activity has a random
UUID handle and dedicated `(tag, id)` pair. No hash-based notification identifier
allocation or `cancelAll()` is used. A duplicate start compares the original start
request, even after later updates. Revisions increase monotonically; equal content
is idempotent, conflicting content is rejected, and terminal handles never update
a replacement activity with the same application key.

Notification posting is asynchronous. An accepted request is persisted before
posting with `awaitingObservation`; its returned state can be `unknown`. Ordered
subsequent updates are allowed, but an older OS snapshot cannot overwrite the
accepted revision. `list()` reconciles the OS snapshot. Once observed, removal
becomes `dismissed`; the explicit non-exported deletion receiver also records
user dismissal. A missed native notification query is not treated as confirmation
that a pending request was shown. Native visibility remains `unknown`, because
posting cannot prove that the user saw the notification.

Metadata is stored in app-private SharedPreferences, including the original
request and last accepted snapshot so idempotence survives process recreation.
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

## Reproduce validation

From the repository root, with the Android SDK and a running emulator:

```sh
source tools/mobile-env.sh
cargo fetch
./tests/android/gradlew -p tests/android \
  :live-activity:testDebugUnitTest \
  :live-activity:connectedDebugAndroidTest \
  :live-activity:lintDebug \
  :live-activity:coverageVerification
```

The isolated Gradle harness compiles the actual plugin against Cargo's downloaded
Tauri 2.12.5 Android sources. It is not a mock Tauri implementation. JVM tests cover
lifecycle ordering, permissions/fallback policy, bounded history and shared input
fixtures. Instrumented tests execute real notifications, permission checks, Tauri
native response envelopes, persistence and dismissal. Combined JaCoCo line coverage
must reach 80%; the report is under `android/build/reports/jacoco/coverageReport`.
The full Tauri demo separately exercises JavaScript → Rust → Kotlin.

## Research sources

- [Tauri mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [Tauri notification plugin source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/android/src/main/java/NotificationPlugin.kt)
- [Android Live Update requirements](https://developer.android.com/develop/ui/views/notifications/live-update)
- [Android notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)

Emulators do not reproduce Samsung One UI/Now Bar, lock-screen policies of every
vendor, or physical-device battery/background limits. Those remain separate
checks before claiming a specific Galaxy device is verified.
