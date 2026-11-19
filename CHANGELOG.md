# Changelog

## Unreleased

- The documents say what a watch and a car show, on iOS and on Android each. They said that an Android watch and
  car show the notification by themselves, and that Android bridges no ongoing notification to a paired watch. By
  Android's documentation a phone's ongoing notification is not bridged, a Live Update is bridged to some watches
  by the Wear OS version and the maker, and Android Auto shows the notifications of messaging apps built for it.
  The usage guide's section is "A watch and a car" (`#a-watch-and-a-car`); the old anchor still leads there.

## 0.11.0

Built on liveactivity 0.8.1 and liveupdate 0.7.1, from 0.7.6 and 0.4.1, with activitykit 0.6.5 as before. It
brings what liveupdate added in eight releases, each part in the JavaScript and the Rust API. Breaking for a Rust
caller, so the version is a minor one: the contract's types are the liveactivity crate's, whose `Template` and
`EndPolicy` and liveupdate's enums are `#[non_exhaustive]` now. JSON written for 0.10 reads unchanged, and the
permissions are as they were.

- **An event of a kind that this version does not know** reaches JavaScript as `live-activity://unknown`
  (`onUnknown`, Rust `UNKNOWN_EVENT`) with `activityId` and `activityKey`. It is one that a later version of the
  plugin stored on Android, as after the app went back to an earlier version; liveupdate reads it for its
  activity since 0.7.0. The plugin dropped such an event.
- **A watch's Ongoing Activity**, as the liveactivity crate offers it: `android.wearOngoingActivity` in the
  options of a layout's start, `wearOngoingActivity` in the presentation of an Android content, and the
  capability `androidPresentation.wearOngoingActivity`. `false` keeps an activity off a watch's face; the
  activity carries one where neither the start nor the content turns it off. It has nowhere to show from a Tauri
  app: a Tauri app is a web view, which Wear OS does not offer, so an app with this plugin does not run on a
  watch, the capability is false wherever it runs, and the two members change nothing on a phone. They are in the
  contract so that a request is the same here and in the liveactivity crate.
- **Below Android 17 a metric style shows its metrics**: the numbers and the texts as lines under the status,
  a decimal with at most two fraction digits as Android 17 writes it, and the first stopwatch or countdown as the
  clock in the header. It showed the title and the status alone.
- **Below Android 12 the tap of an action that asks for the unlock is not taken from a locked device.** An
  action of an Android content with `authenticationRequired` asks for the unlock from Android 12; Android 8 to
  11 have no such setting and sent the tap at once. liveupdate's library now drops it while the device is
  locked, and the person taps again after unlocking.
- **liveupdate's store makes room.** A start and an update store liveupdate's receipts in at most 1,000,000
  bytes: ended activities go, the oldest first. With large contents the store used to fill and fail every later
  start with `NATIVE_ERROR`. A start or an update for which the live activities alone leave no room is
  `SYSTEM_LIMIT`: some thirty activities with the longest texts an Android content has.
- **Rust: code that compiles against the next version.** Build requests on the constructors, which take what
  is required: new are `StartInput::new`, `Snapshot::progress` and `Snapshot::timer`, `Timer::new`,
  `UpdateInput::new`, `EndInput::after`, `AndroidContent::new`, `ImageInput::new`,
  `AndroidOptions::with_wear_ongoing_activity`, and liveupdate's `ProgressStyle::new`, `ProgressSegment::new`,
  `ProgressPoint::new`, `BigTextStyle::new`, `TimerStyle::new`, `Metric::new`, `MetricStyle::new`,
  `PublicVersion::new` and `SamsungNowBar::default()`, beside `AndroidPresentation::new` and
  `NotificationAction::new`, which were there.
- **Rust: a progress style built on `ProgressStyle::new` is styled by its progress**, as Android's own default
  is: what is ahead of the progress is shown fainter. A caller who wants every segment in full says
  `styled_by_progress: false`. From JavaScript nothing changes: `styledByProgress` is false when a content leaves
  it out, and then Android 16 shows every segment in full: the bar is the same at 0 and at 100 unless the content
  shows the value itself, with a tracker icon or with two segments of two colors whose lengths it sets.
- **Rust: the plugin re-exports the liveupdate crate** it builds with, as `tauri_plugin_live_activity::liveupdate`.
  A `TimerStyle` takes liveupdate's `Timer`, whose name the contract gives to the template's timer: it was not
  reachable without a dependency of the app's own. `TimerStyle::new(liveupdate::Timer::new(started_at, ends_at),
  true)`.
- The plugin's Android library carries liveupdate 0.7.1's adapter: `WearOngoing` and `MetricFallback` are new.
  It compiles against `androidx.wear:wear-ongoing` and does not bring it, and its consumer rules keep R8 quiet
  in an app without that library. Where the adapter offers a watch's Ongoing Activity, it takes a shown
  notification away before it posts one without, so that the icon goes from the watch face with the update that
  turns it off and with the end; what a foreground service holds cannot be cancelled and keeps its icon until
  the activity ends. On a phone it cancels nothing.
- The documents say what liveupdate saw of One UI 9 on a Galaxy S23 with Android 17: a point at the full length
  of a progress track is not drawn, the status chip shows the first metric whatever `criticalMetric` names, and
  of three metrics a value longer than about seven characters is cut.
- An Android content may write `wearOngoingActivity: true`, the default, as it may write any other member at
  its default.
- The documents said that a timer more than two weeks old shows nothing on Android 16 and that the app is told
  nothing. Since 0.8.0 such a timer is refused with `INVALID_INPUT` from Android 15: the four places say so now,
  in the README, the usage guide, the Android guide and the compatibility notes.

When updating:

- In Rust a `match` on `Template`, `EndPolicy` or one of liveupdate's enums (`PresentationStyle`, `MetricValue`,
  `IconSource`, `SemanticStyle`) needs a `_` arm, and a struct literal of `AndroidPresentation` names the new
  member or builds on `AndroidPresentation::new`.
- An app that listens to every event of the plugin by name has one more: `live-activity://unknown`.
- Nothing changes in the permissions, in `setup` or on iOS.

## 0.10.3

On iOS the tap of a button comes without `on`, and a color pair behind a card is of the appearance of the card's
content. Built on liveactivity 0.7.6 and activitykit 0.6.5, with liveupdate 0.4.1 as before. Nothing changes in
the JavaScript and Rust APIs or in the permissions.

- On iOS the tap of a button reaches `on_action` and `onAction` without `on`, as the contract says: `on` is a
  toggle's alone. It came with `on: false`, on the simulator and on phones, as the tap of a toggle that asks to
  switch off: by activitykit's account since its 0.5.0, which is 0.7.0 here, the first version with toggles. The
  system hands the app a value that an intent never set as `false`, and activitykit's intent carried the state
  as one optional value. Since activitykit 0.6.4 the intent says beside the state whether the tap is a
  toggle's. A toggle's tap is as before, and so is Android.
- On iOS a layout's `background` that is a light and dark pair is of the appearance its content is drawn in.
  The pair was the system's tint of the activity, and a card could come with the pair's light color behind
  content of the dark appearance: white text on a light card, as the documents of 0.10.2 showed for the
  simulator's Lock Screen. Since activitykit 0.6.5 its widget draws a pair itself, behind the content, on the
  Lock Screen and in the small family. A color name and a hex color are the system's tint as before. It was
  seen on simulators only. On an iPhone 16 (iOS 27.2) and an iPhone XS (iOS 18.7) the card of the demo's Buttons
  example came in one appearance at its start before the correction too: dark with light text on the one, light
  with dark text on the other.
- The glance of the demo's Watch and car example shows its whole title: its ring is 36 points wide, and the
  title may shrink. The demo's README shows it in the Smart Stack of a paired Apple Watch simulator, the first
  picture here of the `small` region where it is drawn. No watch has been tried.
- The iOS pictures of the documents are taken again from this version, on the iPhone 17 Pro simulator with iOS
  26.3: none of the 21 cards came light at its first start, and the picture of a light card is gone from the
  usage guide and the demo's README.

When updating:

- Run `setup` again, as after every update: both corrections are in activitykit's Swift package, which the
  widget extension and the app's intent are built from, and `live-activity.yml` names the folder of the earlier
  one until then. An Xcode project that names the package by hand takes the new folder by hand.
- With a pair as `background`, the system's own parts of a card, such as its question whether the app may go on
  showing Live Activities, have the system's colors and no longer the pair's.
- An app that told a toggle by its action id needs no change. One that builds `ActivityKitActionIntent` itself
  needs none either: its initializer is the same. Its property `isOn` is a `Bool` now, beside the new
  `isToggle`.
- A widget of the app's own that draws layouts, in place of `ActivityKitLayoutWidget`, does with
  `LayoutDocument.drawnBackground(values:)` and `backgroundTint(values:)` what that widget does.

## 0.10.2

On Android 16 and later the bar of a layout shows its value, and `setup` says what is wrong with input it cannot
read. Built on liveactivity 0.7.4, with activitykit 0.6 and liveupdate 0.4.1 as before. Nothing changes in the
JavaScript and Rust APIs or in the permissions.

- On Android 16 and later the bar of a layout shows its value. Android's progress style drew its one segment
  full at any value, because liveactivity's projection of a layout left `styledByProgress` off. liveactivity
  0.7.4, which the plugin requires now, turns it on: the bar is thick as far as the value goes, with a thin
  line ahead of it. The progress template and Android 15 and earlier are as before. A content that the app
  gives (`snapshot.android` with the `progress` style) says `styledByProgress` for itself, as before: one that
  leaves it out is drawn full.
- `setup` is written in TypeScript and compiled to the files that the package always had: its 33 files have the
  names they had. On input that is not what its writer documents, `setup` says what is wrong where it used to
  fail by accident:
  - cargo's metadata with a package that lacks its id, name, version or manifest path is "not its JSON", and a
    resolve graph in another form counts as none. The first was a `TypeError` or a wrong package, the second a
    `TypeError`.
  - A `tauri.conf.json` that holds a list "is not valid JSON", and a capability file that holds one is left to
    the person. A string where `bundle` or `bundle.android` should be an object is passed over; its characters
    were spread into the file.
  - An app with no identifier in `tauri.conf.json` and no `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` stops
    `setup` with a message before anything is written. The widget extension's identifier came out as
    `undefined.widget`.
  - A copy of the package without the template of the custom views file stops `setup` with a message, where the
    step was planned and then failed at the write.
  - An App Group in a spec changed by hand that is no JSON string names no group. It was a `SyntaxError`.
- The demo's page draws the flower of its wordmark and the spark of its Layouts tab itself. An iOS Simulator has
  no glyph for the two characters and showed a boxed question mark in their place.
- The demo's README shows how to use the demo, with pictures of the page, the Lock Screen, the Dynamic Island and
  the Android notification, and the usage guide's captures of the demo are of the current engines. Two scripts
  take them again: `DemoScreens` among the UI tests, and `tests/android/screens.ts`.

When updating:

- One case on Android, while an app is updated with such an activity running. An activity of a layout with a
  `progress` that an earlier version started and that Android has not shown yet answers `CONFLICT` to a repeat
  of its start: liveupdate keeps the projection of that start and compares it, and the projection of the same
  request now has the flag. End the activity and start it again. An activity that Android shows answers the
  repeat as before, and updates are not affected.

Known, on iOS, and not new in this release: the tap of a button reaches `onAction` with `on: false`, where the
contract gives `on` to a toggle alone. It is so on the simulator and on phones (iOS 18.7 and 27.2), since 0.9.0
at least. Tell a toggle by its action id, as the [usage guide](docs/usage.md#links-and-toggles) says.

## 0.10.1

On Android, a call that Tauri cannot make no longer ends the plugin's thread. Built on liveactivity 0.7.2, with
activitykit 0.6 and liveupdate 0.4.1 as before.

- A Tauri app's process lives some seconds after its last activity, and longer when the app prevents its exit.
  Until it has an activity again, Tauri panics on a call to the plugin's Kotlin side. The plugin now catches that
  panic at the call: a start, an update, an end or a list of the Rust API answers `NATIVE_ERROR`, and the thread
  that drains lives on. Before, in an app that prevents its exit, a tap on a notification's button in that
  state ended the thread, and no tap reached `on_action` for the life of the process. A tap that Android stored
  meanwhile is handed over with the next one once the app has an activity again, or in the next process.
- liveactivity 0.7.2 takes the lock of its layouts again after a panic under it. With 0.7.1 such a panic left
  every later call for a layout and every drain an error.
- A build with `panic = "abort"` ends at that panic, which the plugin cannot catch.

Nothing changes in the JavaScript API, in the permissions or on iOS.

## 0.10.0

A command that takes the person to Android's setting for exact alarms. The engines are those of 0.9.0:
liveactivity 0.7.1, activitykit 0.6 and liveupdate 0.4.1.

- `openExactAlarmSettings()` (in Rust `open_exact_alarm_settings`) takes the person to Android's setting for exact
  alarms, "Alarms & reminders", which a scheduled start needs to begin at its time, and answers when they are
  back, with the capabilities as they are then: `androidPresentation.exactStart` says whether they allowed it.
  Android has no dialog for this permission, and from Android 14 it is off until the person allows it. Where exact
  alarms are allowed already, or need no permission (before Android 12), the call answers at once and opens
  nothing.
- A start that already waits gets its exact alarm when the person is back with the permission.
- The permission stays the app's to declare. Where exact alarms are not allowed and the app's own manifest lacks
  `SCHEDULE_EXACT_ALARM`, the call is `CONFIGURATION_REQUIRED`; while the app is not on screen it is
  `NOT_FOREGROUND`; on a device without the setting, and on iOS, which begins a scheduled start itself, it is
  `UNSUPPORTED_FEATURE`, and on desktop `UNSUPPORTED_PLATFORM`.
- The demo's Scheduled start example offers the setting, and the demo declares the permission.

When updating:

- The command needs its own grant, `live-activity:allow-open-exact-alarm-settings`. `setup` adds it: run it again,
  or add the permission to the app's capability.
- The plugin's Android library depends on `androidx.appcompat:appcompat:1.6.0`, the version that Tauri's own
  library brings into every app, for the call that tells a plugin that the app is in front again.

## 0.9.0

Built on liveactivity 0.7.1, activitykit 0.6 and liveupdate 0.4.1: a layout's region for a paired Apple Watch
and CarPlay, and an alarm that stays for a scheduled start on Android.

- A layout takes `small`: what the activity shows in the Smart Stack of a paired Apple Watch (iOS 18 with watchOS
  11) and in CarPlay (iOS 26). It is one tree of at most 12 nodes, without buttons, links or toggles, on the
  layout's `background`, and a tap opens the layout's `url`. A request that breaks its rules is `INVALID_INPUT` on
  every platform. `Layout` has the member in TypeScript and in Rust.
- `npx tauri-plugin-live-activity setup --small-family` has the widget extension draw that family: it writes
  `ActivityKitSmallFamily: true` into the extension's Info.plist in `live-activity.yml`, and later runs keep it.
  With the key the widget draws `small` on the watch and in the car, and for a layout without the region its
  compact parts in a row. Without the key iOS shows the compact parts itself, as until 0.8, and the record of a
  layout with `small` names `layout.small` in `degradedFeatures`.
- Android draws nothing of the region, which a notification has no place for, and names `layout.small`, after
  `layout.island`.
- A scheduled start on Android still begins when the person takes the permission for exact alarms back while it
  waits. Android then removes every exact alarm and stops the app; with 0.8.0 no alarm was left, and the activity
  began when the app next ran. The plugin's Android library, with liveupdate 0.4.1's adapter, sets an inexact alarm
  beside the exact one, and that one stays. Nothing changes for an app without exact alarms.
- The documents say how late a scheduled start can be on Android without exact alarms, by liveupdate's
  measurements: up to three quarters of the wait, ten minutes at most while the device is awake and an hour
  while it dozes.

When updating:

- Nothing changes for an app that sends no `small` and runs setup without the option.
- In Rust, `Layout` (activitykit's `LayoutRegions`, which liveactivity re-exports) has the new member `small`: a
  struct literal has to name it, `small: None` for a layout without the region.
- A widget extension of the app's own, and a `live-activity.yml` that was changed by hand, take the key by hand:
  [iOS integration](docs/ios-integration.md#infoplist-keys).

## 0.8.0

Built on liveactivity 0.6.0 and liveupdate 0.4.0: a scheduled start on Android.

- A start with `scheduled` is taken on Android. The plugin's Android library, which carries liveupdate's adapter,
  sets an alarm, and a receiver posts the notification at the time, also while the app does not run. Until then
  the record is `pending`, as on iOS 26: the same start again answers it, whatever its time; an update is
  `CONFLICT`; an end ends it, and nothing is shown. Until 0.7 Android answered `UNSUPPORTED_FEATURE`.
- `getCapabilities().androidPresentation` has `scheduledStart` and `exactStart`: whether a start can be scheduled,
  and whether it begins at its time or when Android chooses, which is within about ten minutes while the device is
  awake.
- The notification alerts when it begins, where the device offers `alert`; the alert's title and body are iOS's.
- `onState` reports `pending` once on Android. An activity that began while the app did not run is `active` in
  the list of the app that opens afterwards; one that the person removed meanwhile, or that could not be posted,
  is `dismissed`.
- A scheduled start with the foreground placement is `UNSUPPORTED_FEATURE`.

When updating:

- The plugin's manifest has one more receiver, `io.github.eedaegon.liveupdate.LiveUpdateStartReceiver`, not
  exported. The library declares no permission for alarms. For a start on the minute an app declares
  `SCHEDULE_EXACT_ALARM` itself, and for one that survives a restart of the device it declares that receiver for
  `BOOT_COMPLETED`: [Android integration](docs/android-integration.md#a-scheduled-start) has both.
- An app that counted on Android refusing a scheduled start, and started the activity itself when the time came,
  now gets an activity that waits. Read `scheduledStart`, or drop the app's own timer.
- In Rust, liveupdate's `StartRequest` and `ActivityRecord`, which liveactivity re-exports, have a new member: a
  struct literal has to name it.

Also, with liveupdate 0.3.3 and 0.4.0:

- `LiveUpdateForeground.attach` answers true again for an activity that the plugin started. liveupdate 0.3.0 to
  0.3.2 answered false, and the plugin's 0.7 versions carried 0.3.2: a foreground service could not take the
  activity's notification there.
- From Android 15 a content whose header clock is more than 14 days old is refused with `INVALID_INPUT`, at a
  start, an update and when a service attaches. By liveupdate's account Android dropped such a notification
  without a word.

## 0.7.2

Built on liveactivity 0.5.2, which corrects the answer of an end on iOS. The defect showed when the demo ran on an
iPhone 16 with iOS 27.2, the first iPhone with iOS 26 or later to run the plugin.

- On iOS `end` and `endLayout` answer the record as `ended`, as the contract says, also when the system has
  already reported the activity as `dismissed`. After an end with the `immediate` policy that report can come
  before the answer was read, and the answer then said `dismissed`: in 6 of 12 runs of the demo's lifecycle test
  on that phone. `onState` and the lists are unchanged. They say what the system says, so a page can hear
  `dismissed` before the answer of its end comes: take either of `ended` and `dismissed` as the end there.

Also:

- A scheduled start has begun on a phone. With the app ended before the time, the system began the activity, and
  it launched the app in the background at that time. [Usage](docs/usage.md#scheduled-and-transient-starts) says
  so.
- The demo's lifecycle test names the state that an end answered when it is not `ended`.

## 0.7.1

Two defects of 0.7.0 kept an opening of the app from a notification from reaching `onOpened` (Android). Both showed
when the demo ran on a phone.

- An opening that came before the page listened was lost. The opening that launched the app is reported when the
  plugin starts, before the page has loaded, and an event reaches only the listeners there are. The plugin now keeps
  every opening until a page has handed it to a handler, the newest 16, and `onOpened` asks for them: its handler
  first gets those that waited, oldest first, and then each one as it comes, each once. An opening that found no
  handler waits for the next one, and one whose page was reloaded before it could say that a handler got it is
  heard once more by the next page. `take_openings()` takes them in Rust.
- When Android had ended the app's process in the background and a notification brought the app back, no opening was
  stored. Android delivers that intent before Tauri has loaded the plugin, and the plugin was what handed intents to
  liveupdate. The plugin's Android library now watches the app's activities from the start of the process, through a
  provider in its manifest (`OpeningsProvider`, with the authority `<applicationId>.live-activity-openings`; it
  holds no data). It leaves out the intents that Android hands out again: to an activity it restores from its saved
  state, and to one it starts when the person brings the app back from the recent apps, which 0.7.0 counted as a
  second opening.

When updating:

- A capability that lists the plugin's commands one by one, instead of `live-activity:default`, needs
  `live-activity:allow-openings` for `onOpened`, which rejects without it.
- An app writes no Kotlin and no manifest entry for either change.

Also:

- With `samsungNowBar` on, One UI 9 draws a card of its own for the notification, in the shade and under the status
  bar chip, with the title and the text and without the notification's actions: a button, a switch or a link of a
  layout cannot be tapped there, and a tap on the card opens the app. With the option off, the same notification
  has its actions. That is One UI's doing, seen on a Galaxy S23, and is now in the documents; the plugin sends what
  it sent.
- The demo has four more layout examples (Switch, Link, Staleness, Scheduled start), its lifecycle test takes in
  the new nodes and a scheduled start, and the launch argument `--self-test` runs it on a phone that has no UI
  test. The simulator suite has four more tests: a switch, a link, stale content and a scheduled start, on the
  Lock Screen.

## 0.7.0

The plugin is an adapter of the [`liveactivity`](https://crates.io/crates/liveactivity) crate 0.5.1, which runs iOS on
activitykit 0.5.0 and Android on liveupdate 0.3.2. The contract and its checks, the lifecycle, the two backends and the
projection of a layout onto a notification are that crate's; the plugin keeps Tauri's commands, events and
configuration, the Android permissions and their dialog, the Kotlin side and the JavaScript API.
`tauri_plugin_live_activity` re-exports the crate's contract, so the Rust names and the JSON are the same.

Layouts:

- Two nodes are new. `link` is a tap that opens its URL (`layout.link(url, child)`, JSX `<Link url>`), and `toggle` is a
  switch beside its label that shows a boolean value (`layout.toggle(actionId, key, child)`, JSX `<Toggle actionId bind>`).
  A tap on a toggle comes through `onAction` with `on`, the state the person asked for; the switch moves only with an
  update.
- Every node takes `accessibility`, `transition`, `privacy` and `ifStale` through the builders' options and as JSX props.
  `ifStale` is drawn on iOS without the app running. Android draws the layout as it is while fresh and names
  `layout.ifStale`.
- `layout.url` is what a tap on the activity opens. A style takes `contentTransition`. The Dynamic Island takes `priority`,
  `belowIfTooWide` and `margins`.
- On Android a `link` is an action that opens its URL, and `layout.url` is what a tap on the notification opens, where the
  device offers `links`. The app declares the URL's scheme in an intent filter of its activity; without one the record
  names `layout.link` and `layout.url`.
- A timer beside a progress is the clock in the notification's header. An accessibility label stands in for a node that a
  notification cannot draw. A toggle is an action titled by its label, with a check mark before it while the value is on.

Snapshots:

- A layout snapshot takes a `relevance` (iOS: which of the app's activities the Dynamic Island shows first) and an
  `android` content: what the notification shows in Android's own terms, in place of the projection of the layout (a
  progress with segments and points, metrics, the text of the status chip, action icons).
  `getCapabilities().androidPresentation` says which styles the device draws and what it offers beyond them.
- `updateLayout` takes an `alert` with a title and a body. On iOS the device lights up and an Apple Watch shows it.

Starts:

- `scheduled` (`{ at, alert }`) starts the activity at a later time. On iOS 26 the record is `pending` until then, an update
  before it began is `CONFLICT`, and `onState` reports `active` when it begins. Android and older iOS answer
  `UNSUPPORTED_FEATURE`, and nothing is kept.
- `ios` (`{ transient }`, iOS 18) asks for a transient activity; before iOS 18 it is `UNSUPPORTED_FEATURE`. Android ignores
  it. The React hook `useLiveActivity` takes `ios` as well.
- The Android start options are `publicVersion`, what a secure lock screen shows of a private activity, and `placement`,
  `foreground` for a notification that a foreground service of the app holds. A device that does not offer
  `foregroundPlacement` answers `UNSUPPORTED_FEATURE` to the placement.

Android content (`snapshot.android`):

- A presentation takes `openUrl`, and an action takes `openUrl` too: an action that opens a URL sends no tap, and
  `onOpened` reports it. Also new are `chronometer`, `alert`, `publicVersion`, `smallIcon`, `accentColor` and `subText`.
  Each is behind a capability in `getCapabilities().androidPresentation`, and a content that uses a member the device
  does not offer is `UNSUPPORTED_FEATURE`.
- A snapshot may have another notification style than the activity's first where the device offers `styleChange`.
  An end with the policy `after` keeps the last content on screen until its time where the device offers `delayedEnd`.
- A metric's `stopwatch` and `countdown` values are written `startedAt` and `endsAt` and are posted.
- A `progress` layout and an Android content of the `progress` style are posted on Android 16.

Alerts:

- `alert.sound` names a file of the app's bundle on iOS. Android alerts with the sound of its channel, which the person
  chooses; the record names `alert.sound` in `degradedFeatures`.
- An update's alert alerts again on Android where the device offers `alert`. Before 0.7.0 every Android update was silent.

Events:

- New events: `onStarted` (a layout activity began, also one a push started; iOS), `onState` (a new lifecycle state)
  and `onPermissions` (the permissions after a change in Settings; iOS). Their names are public in Rust:
  `STARTED_EVENT`, `STATE_EVENT`, `PERMISSIONS_EVENT`.
- The backend's events reach the plugin one at a time: on liveactivity's events thread on iOS; on Android on the
  plugin's events thread, or on the thread of a command whose call made a state due. A tap holds its thread until the
  handlers of `on_action` have run, at most 4 seconds, so an event behind a tap comes after that tap's handlers, where
  0.6 sent a push event at once. A Rust listener of an event that panics is caught in the plugin's sink, as in 0.6:
  the thread, the taps and the events to JavaScript go on, but Tauri then delivers nothing more to any Rust listener
  of the app.
- An `onAction` payload has `on` for a toggle. It is absent for a button.
- On Android `onState` reports `active`, `stale`, `ended` and `dismissed`, each once, for templates and layouts, with the
  activity's key. The plugin's events thread wakes at an activity's stale time, so `stale` arrives while the app runs
  without a call. On iOS an end that removes an activity at once may be reported as `dismissed` alone.
- `onOpened` (`live-activity://opened`, Rust `OPENED_EVENT`) reports that the person opened the app from an activity's
  notification (Android), and by which action when it was one that opens a URL. The plugin hands the opening intents to
  liveupdate itself, so an app writes no Kotlin for it. The URL comes to the app as any deep link.

Android library:

- The plugin's Android library carries liveupdate 0.3.2's adapter. Its Gradle file adds `androidx.activity:activity:1.6.0`,
  which Tauri's own activity already brings.
- The plugin's permissions read the notification settings through liveupdate's adapter alone, the `capabilities` that
  `getCapabilities` reads, so `notifications` is `granted` exactly when liveupdate may post, and the first
  `checkPermissions` creates liveupdate's notification channels when they were not there. The plugin's own reading of
  the channel is gone, with a validator of ids that nothing called since 0.5 and Gradle properties of fixture tests
  that left with it; the R8 rule that kept `ActionRegistration`, a class that 0.5 renamed, keeps `EventRegistration`.

Checks:

- The reference validator `tools/validate-request.mjs` follows activitykit 0.5's schema and checks what liveactivity
  takes beside it: a relevance, the outline of an Android content, an alert with its sound, and the `ios`, `scheduled`
  and Android options of a start. One of activitykit's fixtures, which uses `relevance` as its example of an unknown
  member, is valid here.
- `docs/spec.md` lists what the plugin proves itself and, apart, the promises that liveactivity's tests prove. New
  there: TP-ANDROID-13, the Android permissions, with the Kotlin tests of their policy; TP-ANDROID-14, one fixture of
  Android contents of every style, which the TypeScript declarations, the Rust models and, on a device, liveupdate's
  Android side are each compared with; TP-ANDROID-15, the events thread that follows liveupdate's next check;
  TP-ANDROID-16, the opening intents; and TP-EVENT-2, the opened event.

Known:

- On Android 16 a notification whose time is more than two weeks past is not shown, and the app gets no error. This is a
  timer whose start or end lies that far before the post. liveupdate answers the post as shown.

Breaking:

- TypeScript: the members of `AndroidMetricValue` are camelCase, `startedAt` and `endsAt`.
- `onState` reports more on Android: `active`, `stale` and `ended` as well as `dismissed`. An app that took its only
  Android state for `dismissed` must handle the others.
- An update's alert alerts on Android where the device offers `alert`, so an Android app that counted on a silent update
  now alerts.
- Rust: `ActionEvent` has `on`, `Alert` has `sound`, `LayoutStartInput` has `ios` and `scheduled`, the layout (`LayoutRegions`)
  has `url`, `Element` has the variant `Toggle`, `Node` has `if_stale`, and `AndroidPresentation` has more members, built
  with `AndroidPresentation::new(style)`. A struct literal of any of these names the new members, and a match over
  `Element` needs an arm for `Toggle`. `LayoutSnapshot`, `LayoutUpdateInput` and `Capabilities` have members more than
  in 0.6, `Alert` and `AndroidOptions` are built with `new`, and the state enums are `#[non_exhaustive]`, so a `match`
  on them needs a `_` arm. `LayoutSnapshot::new`, `LayoutStartInput::new`, `LayoutUpdateInput::new` and
  `LayoutEndInput::new` build the requests.


## 0.6.0

- Pushes on iOS, on activitykit 0.3. A layout start may ask for a push token (`push: 'token'`) or subscribe to a
  broadcast channel (`push: { channel }`, iOS 18); Android ignores the member. A token, new or changed, reaches
  JavaScript as `live-activity://push-token` (`onPushToken`); with `pushToStart: true` in the plugin configuration
  the app's push-to-start token comes as `live-activity://push-to-start-token` (`onPushToStartToken`, iOS 17.2);
  content a push delivers comes as `live-activity://updated` with the activity's record (`onUpdated`), and the
  plugin's records carry it. `checkPermissions` reports `frequentPushes`, `getCapabilities` reports `push`. The
  React hook's state carries `pushToken` and takes pushed content. The server builds payloads with activitykit's
  `push::Payload`; the plugin sends nothing. Without the Push Notifications capability and APNs, as in the
  simulator, a start that asks for a token fails with `CONFIGURATION_REQUIRED`.
- A token can come before the page listens, the push-to-start token at launch above all: the plugin keeps the newest
  token of each of the last 32 activities and the push-to-start token (`pushTokens`, the command `push_tokens` in the
  `default` permission, `push_tokens()` in Rust), and `onPushToken` and `onPushToStartToken` deliver what it holds
  right after subscribing, each token once. The hook listens for pushes only when its options carry `push`. The
  event names are public in Rust (`PUSH_TOKEN_EVENT`, `PUSH_TO_START_TOKEN_EVENT`, `UPDATED_EVENT`); a Rust
  listener runs inline on the plugin's events thread, and one that panics no longer ends the events, nor does a
  panicking listener of `live-activity://action` end the taps.
- The hook sends the next change of its values above every revision it saw: a pushed one, the one a repeated keyed
  start answered with, and the one an update in flight was answered at.
- The request contract is activitykit 0.3's, with the `push` member and its fixtures.
- Breaking: `LayoutStartInput`, `Capabilities`, `Permissions` and `Config` have a member more in Rust (`push`,
  `push`, `frequent_pushes`, `push_to_start`), so a struct literal or an exhaustive pattern of them needs it; in
  TypeScript `Capabilities.push`, `Permissions.frequentPushes` and the hook state's `pushToken` are required
  members, so a test double of them needs them too. An app that grants the plugin's commands one by one, without
  `live-activity:default`, needs `live-activity:allow-push-tokens` for `onPushToken` and `onPushToStartToken`.

## 0.5.1

- iOS runs on activitykit 0.2, whose records carry nothing of other platforms any more: the plugin adds `backend`,
  `visibility`, `promotionRequested` and `promotionState` to its own records as before, so nothing changes for an app.
  activitykit 0.2 also fails a call that its Swift layer never answers after 10 seconds instead of waiting forever.

## 0.5.0

iOS moves onto the [activitykit](https://crates.io/crates/activitykit) crate, which was split out of this plugin's iOS
code. The plugin has no Swift of its own any more: its Rust commands call activitykit, whose build script builds its
Swift bridge into the app's Rust library, and the widget extension links activitykit's Swift products. Requests,
records, revisions and taps keep the behaviour of 0.3. On Android every activity moves onto the
[liveupdate](https://crates.io/crates/liveupdate) crate, run from the plugin's Rust, which projects layouts onto its
notification styles; the plugin's own Kotlin lifecycle and renderer are gone. Layouts can be written in TSX, and a
React hook keeps an activity in step with a component. Desktop works as before.

On an iPhone 16 with iOS 27.2 the layouts, updates while locked and buttons ran from an app on this release. A button
on a locked phone that Face ID has not matched waits for an unlock, as a native app's `.alwaysAllowed` intent does
([iOS integration](docs/ios-integration.md#buttons)).

- `tauri-plugin-live-activity/jsx`: layouts in TSX. The entry is a JSX import source of its own, with one component per
  node that returns the node of its builder, so TSX needs no React. It imports neither Tauri nor React, so a server
  can build the same layout. There are no HTML elements and no fragments.
- `tauri-plugin-live-activity/react`: `useLiveActivity` starts a layout activity on mount, sends changed values as
  updates one at a time, and ends it on unmount or when `enabled` turns false; `onAction` gets this activity's taps.
  React 18 or later is an optional peer dependency.
- CI runs the two simulator suites only when started by hand (`gh workflow run ci.yml -f simulator=true`); a push or
  a pull request no longer waits 30 to 50 minutes for a hosted runner to rebuild the demo. They run on a Mac before
  the push.
- iOS: the commands call activitykit 0.1 directly. The Tauri Swift plugin and the copied Swift packages (`ios/`,
  `LiveActivityShared`, `LiveActivityCore`, `LiveActivityUI`, `LiveActivityPlugin`) and the templates under
  `templates/ios` are gone. activitykit also fixes what 0.3's Swift got wrong: ActivityKit's `unsupported`,
  `unsupportedTarget` and `visibility` refusals keep their codes, the start's preflight no longer depends on the app's
  state, `pending` is a state, `End::after` takes any time, an end can carry final content, and every content has a
  timestamp.
- Revisions, repeated starts and receipts work as in 0.3: each start, update and end goes out at the request's
  revision, the same keyed start returns the running activity (also after a relaunch), and `receipts: "redacted"`
  keeps a digest instead of the values. After a relaunch, a redacted activity's record has the values that ActivityKit
  shows, where 0.3 reported none.
- On iOS a blocking method of `app.live_activity()` called on the main thread, where activitykit answers, returns
  `NATIVE_ERROR` at once instead of waiting for an answer that cannot come.
- A tap's intent, and so an app that the system launched for the tap, waits until the `on_action` handlers have run
  and the tap has gone to JavaScript, at most 4 seconds, on iOS as on Android. JavaScript listeners are not awaited.
- Breaking: iOS needs 16.2 on an iPhone (iPadOS 17 on an iPad). Below it every command but the reads answers
  `UNSUPPORTED_PLATFORM`, and `getCapabilities()` reports the features as unsupported.
- Breaking: an end can carry final content. `end_layout` takes `LayoutEndInput { id, policy, snapshot }` in Rust, and
  `endLayout` takes `LayoutEndInput`, which is `EndInput` with an optional `snapshot`, in TypeScript. On iOS an end
  without a snapshot ends with the last accepted values at the next revision, so its record has one revision more.
- Breaking: `LayoutSnapshot` has an optional `timestamp`, the time the content was made, which ActivityKit uses on
  iOS 17.2 to drop older content, and which iOS records carry. A struct literal needs `timestamp: None`.
- Breaking: `ActivityState` has `Pending`, and the Rust enum is `#[non_exhaustive]`: a match needs a `_` arm.
  TypeScript's `ActivityState` adds `'pending'`.
- Breaking: the error code `NOT_FOREGROUND`, for a start that ActivityKit refuses while the app is not in the
  foreground (it was `NATIVE_ERROR` or `PERMISSION_DENIED`). `UNSUPPORTED_FEATURE` and `SYSTEM_LIMIT` messages name
  the feature and the limit.
- Breaking: the extension's Info.plist keys are activitykit's, `ActivityKitLayout` and `ActivityKitAppGroup`, and
  activitykit keeps receipts in `activitykit/receipts-v2.json` and drawn images in `activitykit/images` of the App
  Group. Activities that 0.3 started are not listed by 0.5: end them before the update, or the system ends them
  within 8 hours.
- Breaking: the progress and timer templates of contract v1 are layout activities on iOS, with a fixed layout like
  0.3's template widget, so `ActivityKitLayoutWidget` draws them and a widget of the app's own for them no longer
  applies. `start`, `update`, `end` and `list` keep their requests and records. A v1 and a v2 activity can no longer
  share an activity key.
- Breaking: the plugin's setup fails when the process already runs activitykit with other receipts than the plugin
  configuration names.
- Breaking: on an app whose `live-activity.yml` was changed by hand, setup keeps the spec and the old
  `LiveActivityActionIntent.swift` and `LiveActivityCustomRegistry.swift` that it names, and reports how to finish
  the migration by hand.
- Breaking: the value key `liveActivityTemplate` is the plugin's, which marks the progress and timer templates on iOS.
  A layout start, update or end whose values hold it answers `INVALID_INPUT` on every platform.
- Breaking: after a relaunch, ending again an activity that ended at once in an earlier launch, and that the system no
  longer lists, is `NOT_FOUND`; 0.3 answered the record. Within a launch, ending again answers the record for the
  last 64 activities that ended; an older one that the system no longer lists is `NOT_FOUND` too.
- `npx tauri-plugin-live-activity setup` finds activitykit's folder with `cargo metadata` and writes
  `live-activity.yml` on its Swift package: the widget extension (iOS 16.2) links `ActivityKitWidget` and
  `ActivityKitViews`, and the app target links `ActivityKitIntent` and `ActivityKitViews` and compiles the custom
  views file. It writes activitykit's widget template as `LiveActivityWidget.swift`. On an app that 0.2 or 0.3 set
  up, it removes `LiveActivityActionIntent.swift` and `LiveActivityCustomRegistry.swift`, replaces the old widget
  file, gives `LiveActivityCustomViews.swift` activitykit's names (your views stay), and writes the new Info.plist
  keys with the App Group it had. A file changed by hand is kept and reported as a step to do. A second run changes
  nothing.
- Rust: the layout types (`Node`, `Element`, `Style`, `Island`, `Bound`, `Bindable`, `Color`, `Value` and the rest)
  are activitykit's, under the same names and with the same JSON, and gain activitykit's builder methods. `Layout` is
  activitykit's `contract::LayoutRegions`. The plugin's validator is activitykit's; `LayoutStartInput::validate_end`
  is new.
- Request contract v2 is activitykit's: `contracts/request.schema.json` and `tests/fixtures/layout-requests.json`
  are its files, which `node tools/sync-contract.mjs --write` copies and a test compares. They add `timestamp` to
  snapshots, final content to `end_layout` and the `ends` fixtures. The reference validator adds
  `validateLayoutEnd`.
- Android: every activity runs on the liveupdate crate (0.1.2). The progress and timer templates of contract v1
  become its schema-v1 requests. Layouts become its schema-v2 presentations: the plugin's Rust chooses a template from
  the tree (Progress, Timer, BigText or Standard), projects the shown texts, progress, timer, up to three buttons, the
  first file image and the Samsung Now Bar lines, and keeps the layout request and its values in a file of its own;
  liveupdate keeps the lifecycle, the receipts and the notification. The plugin's Android library carries liveupdate's
  Android adapter, copied from the crate (`node tools/sync-liveupdate.mjs --write`); its own Kotlin lifecycle,
  renderer, receivers and validator are gone, with the notification channel `tauri.live-activity.v1` and the tag
  prefixes. Taps come from liveupdate's durable event queue: a tap stored while the app did not run arrives when the
  plugin starts, and the native side no longer waits for the handlers.
- Breaking: on Android, end running template activities before the update. 0.5 does not read the receipts that 0.3's
  Kotlin lifecycle stored, and a notification of 0.3 may stay posted.
- Android takes a snapshot's `timestamp` and keeps it in the record, and ends a layout activity with the final
  content of `end_layout`, checked as an update.
- The demo's widget is activitykit's template, its own Mochi widget for the templates is gone, and its Rust handler
  takes a second to count a pet, which the tap waits for. Launched with `--start-buttons`, it starts the Buttons
  example from Rust. The debug build of `tauri ios dev` on a simulator works as the build of `tauri ios build`: the
  page starts layouts, the widget draws them and their buttons reach Rust and the page.
- `docs/spec.md` lists every requirement with its tests, checked by `tools/spec-coverage.sh` in CI. The demo runs on
  an iOS Simulator of its own with `tests/ios/run.sh` (`MODE=dev` for `tauri ios dev`, with connected iPhones hidden
  from Tauri).
- CI caches the Rust builds and installs cargo-llvm-cov as a binary, and pins the Rust toolchain and XcodeGen (a
  release checked against its SHA-256). Two new macOS jobs run the simulator suite, on the demo of `tauri ios build`
  and on the demo of `tauri ios dev`. The built demo and UI tests are cached under a key of the tracked files they are
  built from, Xcode and the tools. A suite that passed in full is recorded as an artifact named after its inputs, the
  workflow file, what selects the suite (its mode, `ONLY` and the retries), the runner image and the simulator runtime
  (`tests/ci/cache.sh`, as in activitykit), and a later run with the same inputs, the push to main that merges a tested
  pull request included, skips it.

## 0.3.0

- Add bound style members to request contract v2. `{ "bind": "<value key>" }` can stand for a literal `color`, `background`, `tint`, `opacity`, `size`, `weight` or `cornerRadius` in a style, and for the layout's `background` and `keyline`. The member reads that value on every render, so `updateLayout` and `update_layout` change it while the activity runs. A bound color is a color name or a hex color, never a light and dark pair. The tree and the other members stay fixed at start.
- Rust, the reference validator, Swift and Kotlin check the value at start, and the native layers check it again on every update, with `INVALID_INPUT` when it does not fit. The fixture file adds start cases and an `updates` list of start and update pairs that all four run.
- TypeScript: `layout.bind(key)` and the types `LayoutBound` and `LayoutBindable<T>`. The reference validator adds `validateLayoutUpdate`.
- Rust: `Bound`, `Bound::key`, `Bindable<T>` and `LayoutStartInput::validate_update`. Breaking: the bindable `Style` fields and `Layout::background` and `keyline` are `Option<Bindable<_>>`; wrap a literal with `.into()`.
- iOS: the bindable members of `LayoutStyle` and `LayoutRegions` are `LayoutBindable`. `LayoutDocument.style(_:values:)`, `background(values:)` and `keyline(values:)` resolve them; `LayoutView` draws bound style members with the current values. The widget template passes the values to the two tints. A widget copied from the earlier template still compiles and draws a bound tint as absent; `setup` keeps a copy that differs: delete it and run `setup` again to take the new template.
- Android still draws no styles and lists them in `degradedFeatures`.
- A 0.2.x crate rejects bindings with `INVALID_INPUT`. Keep the npm package and the crate on the same minor version.
- The demo's Layouts tab adds **Changing styles**: an update turns the status red and bold when the snack runs late.
- Add custom fonts to request contract v2: the style member `fontFamily`, the PostScript or family name of a font that the widget extension bundles. With `font` the font takes that text style's size and scales with Dynamic Type, with `size` that size. It excludes `design` and takes no binding. A name the extension lacks draws the system font.
- `npx tauri-plugin-live-activity setup --font <file>` copies a font into `gen/apple/LiveActivityWidget/Fonts` and lists every font there under `UIAppFonts` in the extension's Info.plist, and prints the names a style can give. `--asset <file>` puts a PNG, JPEG, PDF or SVG into the extension's asset catalog, with `name@2x` and `name@3x` as scales of one asset. Both are repeatable and copy a file again only when it changed.
- Add images that the app draws: `image({ file: 'badge.png' })` in TypeScript, `ImageSource::file` in Rust, `{ "source": { "file": name } }` on the wire. `writeImage(name, png)` and `app.live_activity().write_image(name, &png)` check a PNG (at most 1 MiB and 1224 x 480 pixels, Apple's largest Lock Screen presentation at @3x) and write it into the App Group container, where the widget reads it on start and on every update. `check_image` checks one without writing it. The new command `write_image` has the permissions `allow-write-image` and `deny-write-image`; `setup` grants the first.
- `setup --app-group[=<id>]` gives the app target and the widget extension an App Group, `group.<app identifier>` unless named, through `live-activity.yml`, and names it in the extension's Info.plist under `TauriLiveActivityAppGroup`. Later runs keep it. Without one, `writeImage` fails with `CONFIGURATION_REQUIRED`. A device build needs the group in the Apple Developer account once; automatic signing registers it.
- Add the `custom` node: a SwiftUI view that the app registers by name in `LiveActivityCustomViews.swift`, which `setup` creates once and never writes again. Its `props` are literals or bindings, so an update redraws the view with new values. The validators check the name and the props; an unknown name draws nothing and is listed in `degradedFeatures` as `layout.custom.<name>`. TypeScript: `layout.custom(name, { props })` and `LayoutCustomNode`; Rust: `Element::Custom`.
- The widget template draws custom views through the new `templates/ios/LiveActivityCustomRegistry.swift`, which `setup` copies and which belongs in both targets, like the custom views file. A widget copied from an earlier template still compiles and draws custom nodes as nothing; delete it and run `setup` again to take the new template.
- Rust, the reference validator, Swift and Kotlin check `fontFamily`, `file` sources and `custom` nodes with the same rules; the shared fixtures add 23 valid starts, 62 invalid ones and 5 update pairs.
- Breaking: Rust's `ImageSource` is an enum (`ImageSource::Asset { asset }`, `ImageSource::File { file }`, with `ImageSource::asset` and `ImageSource::file`), `Style` has the field `font_family`, and `Element` has the variant `Custom`. Swift: `LayoutContent.image` and `LayoutRenderContent.image` take a `LayoutImageSource`, and both enums have a `custom` case.
- Android: the first shown image drawn from a file becomes the notification's large icon. Google's Live Update requirements do not name the large icon, so promotion stays. Custom views, fonts and asset images are left out and listed in `degradedFeatures`.

## 0.2.1

- Add `npx tauri-plugin-live-activity setup`, a command in the npm package with no dependencies. Run in a Tauri 2 app, it adds the plugin's permissions to the capability file and raises the Android minimum to API 26 in `tauri.conf.json` and in an existing `gen/android`. On a Mac with `src-tauri/gen/apple`, it sets `NSSupportsLiveActivities` in `src-tauri/Info.ios.plist`, copies the widget templates from the crate, writes `gen/apple/live-activity.yml` with the widget extension target and the button intent in both targets, includes it in `project.yml`, prepares the crate's Swift package and runs XcodeGen. A second run changes nothing. It keeps files that differ from what it would write and says so. `--dry-run` writes nothing; `--ios-only` leaves the capabilities and `tauri.conf.json` alone.
- The README is short: the demos, four install lines, one example and the layout nodes. The per-feature sections and the setup by hand moved to [docs/usage.md](docs/usage.md).

## 0.2.0

- Breaking: `init()` returns `TauriPlugin<R, Option<Config>>`. `Capabilities` has a new public `layout` field, so code that builds it with a struct literal no longer compiles. After 0.2.0 has run once on iOS, `receipts-v1.json` is gone, and an app that goes back to 0.1.x starts with no iOS receipts.
- Add request contract v2: a layout tree of nodes, a style table and a map of values. Rust, Swift and Kotlin apply the same rules and limits, including a weight limit of 3584 for layout, styles and values together, and are tested against one fixture file. The layout is fixed at start and updates send values only. Contract v1 is unchanged, and the two versions do not see each other's activities.
- Add the `start_layout`, `update_layout`, `end_layout` and `list_layout` commands with `allow-`/`deny-` permissions, the JavaScript functions `startLayout`, `updateLayout`, `endLayout` and `listLayout`, the JavaScript node builders under `layout`, and Rust methods of the same names. `live-activity:default` now also allows `list_layout`.
- Deliver taps on layout buttons to Rust `on_action` handlers and then to `onAction` listeners through the `live-activity://action` event. `onAction` uses Tauri's event permissions (`core:event:default`). `getCapabilities()` reports `actions` as supported on iOS 17+ and Android, and adds `layout`.
- Draw layouts on iOS with the new `LiveActivityUI` package product and the `LiveActivityLayoutWidget` widget in the template. The extension's Info.plist needs `TauriLiveActivityLayout` = `2`; without such an extension `startLayout` fails with `CONFIGURATION_REQUIRED`. Buttons need iOS 17 and `templates/ios/LiveActivityActionIntent.swift` in both the widget extension and the app target.
- Show layouts on Android as notifications: title, body, progress bar, chronometer and up to three actions. Everything else is listed in `degradedFeatures`. `android.visibility` sets the lock screen visibility.
- Add the optional plugin configuration `plugins.live-activity`: `receipts` (`full` or `redacted`) chooses what iOS receipts keep, and `android.samsungNowBar` adds One UI's Now Bar text extras to layout notifications on Android 17+. Neither puts an app on Samsung's Now Bar allow list. An unknown key or a wrong type makes plugin setup fail when the app starts.
- Move iOS receipts to `receipts-v2.json`, which holds both contract versions; the earlier `receipts-v1.json` is converted and deleted on first load.
- On desktop, the layout commands check their input and then return `UNSUPPORTED_PLATFORM`, like the v1 commands.
- Enable serde_json's `float_roundtrip` feature, so Rust reads a number as JavaScript wrote it. Cargo turns it on for every crate in the app's build that uses serde_json.
- The publish workflow now also moves npm's `next` tag to a stable release when `next` is missing or lower, so after a stable release `tauri-plugin-live-activity@next` installs that release or a newer prerelease. This step never moves `next` back.

Push updates, lifecycle event subscriptions and desktop backends are not included.

Android's instrumented tests passed on API 26 and API 36 emulators and on a Galaxy S23 with Android 17, and the 80% Android line coverage gate passed on each. On the S23, four tests that open a test activity were left out. [The 0.2.0 validation record](docs/validation.md) lists what was and was not tested.

## 0.1.0-alpha.4

- Add npm search keywords and crates.io keywords/categories for Tauri, Live Activities, ActivityKit and Android notifications.
- Add a guarded GitHub Actions release workflow for npm and crates.io.
- Native behavior and the public API are unchanged from alpha.3.

## 0.1.0-alpha.3

- Require Android 8.0 / API 26 in the plugin and demo manifests. The previous API 24 minimum allowed installation on a version where Tauri's Jackson dependency crashes during startup.
- Document OS feature floors, build requirements, desktop limitations and actual boundary-test results separately.
- Refine Mochi's ears and face, using the same silhouette in the app and iOS widget.
- Make Android permission-dialog tests work across API 33 and 37 and native tests run on API 26.

## 0.1.0-alpha.2

- Rename the npm package to `tauri-plugin-live-activity`, matching the crate name.
- Replace the demo with Mochi's snack delivery and nap timer, including a custom iOS widget.
- Keep Android permission requests retryable after the system dialog is cancelled.
- Check notification channel importance before requesting Live Update promotion and report rejected promotion as a degraded feature.
- Reject conflicting iOS updates whose text differs only in Unicode encoding.
- Require iPadOS 17 for iPad and exclude iOS app compatibility mode on Mac.
- Add native permission, timer and lifecycle tests, registry-backed Tauri consumers, and Windows/Linux IPC checks.

## 0.1.0-alpha.1

- Start, update, end and reconcile local progress/timer activities from Tauri 2.
- iOS ActivityKit backend and shared Widget Extension template.
- Android ongoing notifications with explicit fallback and Live Update promotion checks.
- Typed JavaScript API, read-only default Tauri permissions and strict request validation.
- Runnable mobile demo and native lifecycle tests.

Desktop backends, push updates and event subscriptions are not included.
