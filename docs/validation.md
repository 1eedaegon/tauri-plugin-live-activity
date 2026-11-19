# 0.10.3 validation

0.10.3 is a patch release. It brings what main has since 0.10.2: liveactivity 0.7.5 and 0.7.6 with activitykit
0.6.4 and 0.6.5, whose two corrections are in activitykit's Swift package. On iOS the tap of a button reaches the
app without `on` (#60), and a layout's color pair as `background` is of the appearance its content is drawn in
(#61). Beside them the glance of the demo's Watch and car example shows its whole title, the iOS pictures of the
documents are taken again (#61), and the documents say that One UI's own card has no bar (#59). Nothing changes
in the JavaScript and Rust APIs or in the permissions, and nothing in the plugin's own Rust, Kotlin, Swift,
TypeScript or `setup`: of what the crate and the npm package ship, the versions, the requirement of liveactivity
0.7.6 and one document of the crate (`docs/android-integration.md`, by #59) differ from 0.10.2. Checked before
the tag:

- An iPhone 16 with iOS 27.2 and an iPhone XS with iOS 18.7.12, on a build of #60's head (activitykit 0.6.4): the
  UI tests of the button's tap and of the switch passed on both. After the tap on a button on the Lock Screen the
  page's record read `{"actionId":"pet","activityId":"la-ios-layout-…","activityKey":"mochi:buttons"}` and its
  message named no state; the switch's taps came with `"on":true` and then `"on":false`. No phone had run
  activitykit's correction before.
- The same two phones on a build of this release's pull request (activitykit 0.6.5): the lifecycle test passed
  twice on each, 31 of 31 and 27 of 27. On the iPhone XS the UI tests of a bound style, of the button's tap and
  of the switch passed, and its cards have the pair's light color under dark text to their four rounded
  corners, as they had with 0.6.4. On the iPhone 16 the UI tests did not start, at three attempts on two builds
  ("Failed to initialize for UI testing … Timed out while enabling automation mode", before any test); the same
  runner had started there ninety minutes before, and why it no longer did is not known. So one phone's cards
  were seen on 0.6.5. [iOS coverage](ios-coverage.md#0103-on-two-iphones) has the runs.
- A Galaxy S23 with Android 17 (One UI 9), unlocked, on a build of this release's pull request: the demo's
  lifecycle test passed, 30 of 30 in 3 of 3 runs. Nothing of Android changes in this release: liveupdate 0.4.1
  and the plugin's Kotlin library are those of 0.10.2, and liveactivity 0.7.5 and 0.7.6 change nothing of that
  library's Rust. So the Android library's device tests were not run again; CI ran its unit tests and lint.
  [Android coverage](android-coverage.md#0103-on-a-phone) has the run.
- The simulator, for the documents' pictures, on #61 before its last commit: all of `DemoScreens` on the iPhone
  17 Pro simulator with iOS 26.3, where 21 cards were started and each was dark at its first look, none started
  again; and by hand the glance of the Watch and car example in the Smart Stack of a paired Apple Watch Series
  11 simulator with watchOS 26.2, which showed the pair's dark color and the title whole. Each picture was
  looked at before it was committed.
- `npm test` (306 tests in six suites) and `cargo test` (52 unit and 7 integration tests), `cargo clippy`,
  `tools/spec-coverage.sh` (91 requirements, each with a test). The npm package has 33 files with the names of
  0.10.2's, counted with the npm of the Publish workflow (11.20.0), and the crate has 68.
- CI: the pull requests' runs, and the two simulator suites, started by hand on the head of #60 (run
  44365704038) and of #61 (run 44399984222), both on iOS 26.2. `test2` compares the whole of what the page heard
  since #60: its message and its record of the tap. In the first run the suite on the built demo passed its 12
  tests, each at its first try, after its runner had once failed to start ("Timed out waiting for AX loaded
  notification") and `tests/ios/run.sh` ran it once more; the one on `tauri ios dev` passed its 4. In the
  second run both passed, 12 and 4, each test at its first try and the runner at its first start. The seven
  methods that take the documents' pictures are skipped there. The main run of the release commit.

Not checked: a card of the iPhone 16 on activitykit 0.6.5; the dark appearance on the iPhone XS; the system's
question under a card on a phone, whose colors change with a pair; a watch and CarPlay; and `setup` run again in
an app of its own after the update, which is how an app takes the new Swift package: the demo's build links
activitykit's folder itself. The lifecycle test asks the plugin and reads its answers: it does not look at the
Lock Screen.

The light card under white text was seen on simulators only, by this project in its pictures for 0.10.2 and by
activitykit in its own tests. Before the correction the two phones showed the Buttons card in one appearance at
its start: dark with light text on the iPhone 16, light with dark text on the iPhone XS.

Added two hours after the tag, on the same build: the UI tests ran on the iPhone 16. Its runner timed out once
more and started at the next attempt, and the tests of a bound style, of the button's tap and of the switch
passed. Its cards have the pair's dark color under light text to their four rounded corners. So both phones'
cards were seen on activitykit 0.6.5, and the first item of the list above is closed.
[iOS coverage](ios-coverage.md#0103-on-two-iphones) has what the phone's process list showed of the attempts.

The record of 0.10.2 follows.

# 0.10.2 validation

0.10.2 is a patch release. It brings what main has since 0.10.1: liveactivity 0.7.4, with which the bar of a
layout shows its value on Android 16 and later (#56); `setup` written in TypeScript and compiled to the files
that the package always had, with messages for input it cannot read (#53); and the demo's page with its two
ornaments drawn by itself, beside the documents' pictures of the current engines (#57). Nothing changes in the
JavaScript and Rust APIs or in the permissions. Of what the crate and the Android library ship, comments alone
differ from 0.10.1, beside the requirement of liveactivity 0.7.4. Checked before the tag, on a build of the
release's pull request:

- A Galaxy S23 with Android 17 (One UI 9), unlocked: the demo's lifecycle test passed, 30 of 30 in 3 of 3 runs,
  and the Android library's device tests 10 of 10. The bar of the Progress layout at 0, 0.15, 0.65 and 1: the
  notification held the value each time with `styledByProgress=true`, and in a build with
  `android.samsungNowBar` off the shade drew the bar as far as the value, with a thin line ahead of it. With the
  Now Bar extras on, as the demo ships, One UI drew its own card, which has no bar.
  [Android coverage](android-coverage.md#the-bar-of-a-layout-0102) has the runs.
- An iPhone XS with iOS 18.7: the lifecycle test passed, 27 of 27, twice.
- `npm test` (306 tests in six suites) and `cargo test` (52 unit and 7 integration tests), `cargo clippy`,
  `tools/spec-coverage.sh` (91 requirements, each with a test). The npm package has 33 files with the names of
  0.10.1's, counted with the npm of the Publish workflow (11.20.0), and the crate has 68.
- The Publish workflow, started by hand on main for the tag v0.10.1 with `publish` off (run 44275787277): its
  release controller had not run since it became TypeScript (#54). The package job passed, and the package it
  built from v0.10.1 has the checksums that npm and crates.io hold. The two jobs that publish do not run without
  `publish`, so they run in TypeScript for the first time at this release's tag.
- CI: the pull request's run, and the two simulator suites, started by hand on its head before this record was
  added (run 44280336474, iOS 26.2), the first hosted run of them since `setup`, the tools and the tests became
  TypeScript (#53 to #55). The suite on the built demo passed its 12 tests, each on its first try; the seven
  methods that take the documents' pictures are skipped there. The one on `tauri ios dev` passed its 4: `test2`
  found no "Pet Mochi" button on the Lock Screen at its first try (`DemoTests.swift:260`) and passed at its
  second. The log of that first try has what one earlier run had: chronod's watchdog ended the widget
  extension's session (`CHSErrorDomain Code=1001 "Watchdog provision violated for getActivities(1)"`) and the
  activity's content failed to load; the picture kept at the failure shows the Lock Screen without the card. The
  main run of the release commit.

The bar itself was first seen on an emulator of Android 16 (API 36), in a build on liveactivity's correction
before 0.7.4 was published, and the documents' pictures from main show it.

Not checked: the iPhone 16, which was not connected; the UI tests on a phone; a content of the app's own with
the `progress` style on a device; and on a device, the case of the changelog in which a repeat of a start
answers `CONFLICT`, which liveactivity tests in its own repository. The lifecycle test asks the plugin and reads
its answers: it does not look at the Lock Screen.

Known and not new: on iOS the tap of a button comes with `on: false`, where the contract gives `on` to a toggle
alone. After the tap, the page of this run's `test2` reads "Mochi felt “pet”, asked off", and so do the pictures
that the UI tests kept on phones: on the iPhone XS with iOS 18.7 for 0.9.0 and on the iPhone 16 with iOS 27.2
for 0.10.0. The test compares the beginning of that line only.

The record of 0.10.1 follows.

# 0.10.1 validation

0.10.1 is a patch release. It brings the correction of TP-ANDROID-19, which main had since its pull request
(#44), and moves the plugin to liveactivity 0.7.2. A call to the plugin's Kotlin side that panics inside Tauri,
as each does while the process has no activity, answers `NATIVE_ERROR` and ends no thread. liveactivity 0.7.2
takes the lock of its layouts again after a panic under it; with 0.7.1 such a panic left every later call for a
layout and every drain an error. Nothing changes in the JavaScript API, in the permissions or on iOS. Checked
before the tag, on a build of the release's pull request:

- A Galaxy S23 with Android 17 (One UI), which showed its lock screen all the while: the demo's lifecycle test
  passed, 30 of 30 in 3 of 3 runs. The Android library's device tests passed 8 of 10 there. The two that failed
  bring an activity to the front, which a locked phone does not: `anIntentThatAndroidHandsOutAgainIsNotCountedAgain`
  ("Android did not create the activity again") and
  `theSettingForExactAlarmsOpensOnceForTheCallsThatWaitAndAnswersThemWhenThePersonIsBack`. The library's Kotlin is
  that of 0.10.0, whose ten tests passed on this phone while it was unlocked.
- An iPhone XS with iOS 18.7: the lifecycle test passed, 27 of 27, twice. An iPhone 16 with iOS 27.2: 31 of 31,
  twice.
- `npm test` (285 tests in six suites) and `cargo test` (52 unit and 7 integration tests), `cargo clippy`,
  `tools/spec-coverage.sh` (86 requirements, each with a test).
- liveactivity 0.7.2 has the test of its lock in its own repository: a transport whose call panics under each of
  the five calls for a layout, after which the same call and every other are answered.
- CI: the pull request's run, and the two simulator suites, started by hand on its head before this record was
  added (run 43792276862, iOS 26.2): the suite on the built demo passed its 11 tests and the one on
  `tauri ios dev` its 4, each test on its first try. The main run of the release commit.

The correction itself was seen on an emulator of Android 16, in a build of the demo that prevents its exit, with
liveactivity 0.7.1: the spec's note on TP-ANDROID-19 has that run.

After the tag the Galaxy S23 was unlocked, and what had waited for that ran there. The Android library's device
tests passed, 10 of 10, the two above among them. A tap while the process has no activity ran twice, in the
release's demo built to prevent its exit: the tap changed nothing then, wry's panic was in the log twice and the
plugin's threads lived on, and with an activity again the next tap brought the one that had waited with it, from
"1 pet so far" to "3 pets so far". [Android coverage](android-coverage.md#a-process-without-an-activity-0101)
has the runs.

Not checked: a call of the Rust API while the process has no activity, a tap in the seconds before a process
that the app does not keep ends, and a build with `panic = "abort"`.

The record of 0.10.0 follows.

# 0.10.0 validation

0.10.0 adds a command, `openExactAlarmSettings()`, which takes the person to Android's setting for exact alarms
and answers when they are back. The engines are those of 0.9.0. The command has a permission of its own, and the
plugin's Android library has one more dependency: a minor release. Checked before the tag:

- A Galaxy S23 with Android 17 (One UI): the Android library's device tests, 10 of 10, the one for the setting
  among them; the demo's lifecycle test, 30 of 30; and the command through the demo. Two calls at once opened One
  UI's screen once, and both answered `exactStart: true` after a touch on the switch and the back key. A start
  that waited got its exact alarm. With the permission a call answered at once and opened nothing, and a
  scheduled start 30 s ahead with the process ended was there at the first look after its time. The page's button
  did what the raw call did. [Android coverage](android-coverage.md#the-setting-for-exact-alarms-0100) has the
  runs.
- On the same phone, what 0.9.0 could not show of liveupdate 0.4.1: the permission taken back while a start
  waited. Android stopped the app and removed the exact alarm, the inexact one stayed, and the start began by it
  7 minutes 11 seconds after its time.
- The release commit differs from what those runs had by the versions. It was built again: on the S23 the
  lifecycle test passed, 30 of 30, and the command opened the setting once for two calls and answered both; on an
  iPhone XS with iOS 18.7 the lifecycle test passed, 27 of 27, twice.
- `npm test` (269 tests in six suites) and `cargo test` (48 unit and 7 integration tests), `cargo clippy`, which
  now also refuses an `unwrap` or `expect` outside tests (TP-BUILD-2), `tools/spec-coverage.sh` (84 requirements,
  each with a test), the Android library's unit tests (11) and lint.
- CI: the pull request of the command (#37) and main's run of its merge (run 43715798371), and the two simulator
  suites, started by hand on the head of the release's pull request before this record was added (run
  43719400174, iOS 26.2): the suite on the built demo passed its 11 tests and the one on `tauri ios dev` its 4,
  each test on its first try. The pull request's own run and the main run of the release commit.

After the tag, when the iPhone 16 with iOS 27.2 was connected again, the build of the release commit ran there:
the lifecycle test passed, 31 of 31 in 3 of 3 runs, and a scheduled start 30 s ahead began with the app ended.
The demo's UI tests ran there too, for the first time on a phone with iOS 26 or later: 11 of 11, the scheduled
start on the Lock Screen among them. A start of them earlier that day had stopped where the phone turns UI
automation on, as it had with 0.9.0; this time the phone was picked up while it ran, by its owner's word.
[iOS coverage](ios-coverage.md#0100-on-two-iphones) has the runs.

Also after the tag, a Galaxy Note10 with Android 12 (One UI 4.1) ran the same build, on a new install, which
holds the permission for exact alarms: the command answered two calls at once and opened nothing, the lifecycle
test passed, 30 of 30, the Android library's device tests passed, 9 with the one for the setting not run there,
and a scheduled start 30 s ahead with the process ended was there at the first look after its time. With the
permission taken away the command opened the setting as the list of all apps, not as a screen of the app, and
answered both calls after a touch on the app's switch there and the back key. Taken back while a start waited,
the start began by the inexact alarm, 2 minutes 16 seconds after its time.
[Android coverage](android-coverage.md#android-12-on-a-phone-0100) has the runs.

Not checked: the command's refusal on a phone, which is all that 0.10.0 changes on iOS and which no run asked
for. Android 13; a device without the setting; an activity that Android destroys while the setting is open. A
restart of the device and a doze. The command also ran on an emulator of
Android 16: the spec's note on TP-ANDROID-18 has that run.

The record of 0.9.0 follows.

# 0.9.0 validation

0.9.0 moves the plugin to liveactivity 0.7.1, with activitykit 0.6 and liveupdate 0.4.1. A layout takes a `small`
region for a paired Apple Watch and CarPlay, setup has the option `--small-family`, and the plugin's Android
library carries liveupdate 0.4.1's adapter, whose scheduled start keeps an inexact alarm beside the exact one.
`Layout` has a new member, in TypeScript and in Rust: a minor release. No paired Apple Watch and no car was at
hand, so nothing below shows the region drawn. Checked before the tag:

- An iPhone 16 with iOS 27.2 and an iPhone XS with iOS 18.7, on the demo, whose widget extension sets
  `ActivityKitSmallFamily`: the lifecycle test, 3 of 3 runs with 31 checks each and 2 of 2 with 27. A layout with
  a small region starts there with nothing left out. Built without the key, the demo passed on the iPhone 16 with
  the record naming `layout.small`. [iOS coverage](ios-coverage.md#090-on-two-iphones) has the runs.
- The demo's UI tests on a phone, for the first time: on the iPhone XS, with a copy that signs its runner, 10 of
  11 with the demo of 0.8.0 and again with that of 0.9.0. The eleventh is the scheduled start, which iOS 18
  refuses.
- A Galaxy S23 with Android 17: the Android library's device tests, 9 of 9, on liveupdate 0.4.1's adapter; the
  lifecycle test, 30 of 30; the demo's example for a watch and a car, whose record lists `layout.island`,
  `layout.small`, `layout.styles` and `layout.background` and whose notification is the Lock Screen tree's; and a
  scheduled start 30 s ahead with the process ended, shown 25 s after its time, as with 0.8.0.
  [Android coverage](android-coverage.md#the-small-region-and-liveupdate-041-090) has them.
- The release commit differs from what the first of those runs had by liveupdate 0.4.1's adapter, by the label
  of the demo's new example and by the versions. It was built again for the three phones: the lifecycle test
  passed on each, 31 of 31 twice on the iPhone 16, 27 of 27 twice on the iPhone XS and 30 of 30 on the S23, where
  the example gave the same record. The demo's UI tests on the iPhone XS gave the same 10 of 11 with that build.
- `npm test` (264 tests in six suites) and `cargo test` (47 unit and 7 integration tests), `cargo clippy`,
  `tools/spec-coverage.sh` (82 requirements, each with a test), the Android library's unit tests and lint. Rust
  judged the requests that the demo's new example and lifecycle check build, with the liveactivity of the lock
  (TP-CONTRACT-9). The rules of the setup option (TP-SETUP-8) were changed in place 17 times, and a test failed
  each time: the key never or always written, or written as text; not kept, or always set, by a later run;
  `false`, a comment or text after `true` counting as set; the flag or its line of help gone; a widget of the
  app's own not told; the option lost on its way to the spec; a spec changed by hand kept without a word, or left
  to do though it has the key or though nobody asked; the demo's spec without the key, and its Info.plist with
  text.
- CI with the two simulator suites, started by hand on the head of the pull request before this record was
  added (run 43702820805, iOS 26.2): the suite on the built demo passed its 11 tests and the one on
  `tauri ios dev` its 4, each test on its first try. The lifecycle test among them starts a layout with a small
  region; the run does not show which of the two answers the record gave there. The pull request's own run and
  the main run of the release commit.

Not checked: a paired Apple Watch and CarPlay, on a device or in a simulator. A start whose exact alarm the person
takes back while it waits, on a phone: the demo declares no exact alarms, and liveupdate saw the alarm that stays
on an emulator. A restart of the device and a doze; Android 16 and earlier with this version. The demo's UI tests
on a phone with iOS 26 or later: on the iPhone 16 the runner stopped where the phone turns UI automation on.
A finger on the glass, on either system.

The record of 0.8.0 follows.

# 0.8.0 validation

0.8.0 moves the plugin to liveactivity 0.6.0 and liveupdate 0.4.0, with which a scheduled start waits on Android
and an alarm posts it at its time. The plugin's Android library declares one more receiver and carries one more
file of liveupdate's adapter, the capabilities have two more members, and an activity can be `pending` on Android:
a minor release. Checked before the tag:

- A Galaxy S23 with Android 17, on the demo as it ships, which asks for no exact alarms: the Android library's
  device tests, 9 of 9; the demo's lifecycle test, 28 of 28, with a scheduled start that is pending, holds its
  key, takes no update and can be ended; a scheduled start 30 s ahead, shown 1.7 s after its time with the app in
  front and 25 s after it with the app's process ended; one that was ended before its time and one whose
  notification permission was taken away, nothing in 13 minutes each, and the second `dismissed` in the app that
  was opened afterwards. [Android coverage](android-coverage.md#a-scheduled-start-080) has each run, and those of
  a build with exact alarms.
- An iPhone 16 with iOS 27.2 and an iPhone XS with iOS 18.7, where nothing changes: the lifecycle test, 5 of 5
  runs with 29 checks each and 3 of 3 with 25.
- The release commit differs from what those runs had by one text of the demo. It was built again for the three
  phones, and the lifecycle test passed on each: 28 of 28 on the S23, and the last 2 and the last 1 of the runs
  above on the iPhones.
- `npm test` (1762 tests in six suites) and `cargo test` (65), `cargo clippy`, `tools/spec-coverage.sh` (83
  requirements, each with a test), the Android library's unit tests and lint. What the new test of the library
  holds (TP-ANDROID-17) was changed in place seven times, and a test failed each time: the receiver undeclared or
  exported, a permission for exact alarms or the one for a restart in the library's manifest, either member gone
  from the capabilities' type, the adapter's file of the alarm gone.
- CI with the two simulator suites, started by hand on the release commit (run 43627060836, iOS 26.2). The suite
  on the built demo passed its 11 tests, two of them on a second try: the scheduled start with the app ended,
  whose app was first not launched in time, and the bound style, whose new values first did not show on the Lock
  Screen in time. Of liveactivity's files that an iPhone builds, 0.6.0 changes comments only. The suite on
  `tauri ios dev` passed its 4 on the first try, in a second attempt of its job: the first was cancelled eight
  minutes in, and the run's record names no cause.
- Main has since gained a Rust cache for CI, two changes of the simulator tests' harness and the removal of the
  plugin's copies of activitykit's schema and fixtures, which alter nothing an app runs; the suites were not run
  again for them. Merged with that main, `npm test` (1763), `cargo test` (65) and `tools/spec-coverage.sh` pass.
  The pull request's own run and the main run of the release commit.

Not checked: a restart of the device, with and without the receiver declared for it; a doze; a start whose alarm
could not be set; Android 16 and earlier with this version. On a device, what 0.8.0 takes over from liveupdate
beside the scheduled start: a foreground service that attaches to an activity of the plugin, and the refusal of a
header clock more than 14 days old. The demo's UI tests on a phone, which still wait for a person to allow UI
automation on it, and a finger on the glass, on either system.

The record of 0.7.2 follows.

# 0.7.2 validation

0.7.2 moves the plugin to liveactivity 0.5.2, which corrects the answer of an end on iOS. The defect showed when
0.7.1 ran on an iPhone 16 with iOS 27.2, the first iPhone with iOS 26 or later to run the plugin. None of the
plugin's own code changes, so it is a patch release. Checked before the tag:

- 0.7.1 on the iPhone 16, launched with `--self-test`: the demo's lifecycle test failed in 6 of 12 runs. Each
  time an end with the `immediate` policy had not answered `ended`: five times a template's, which answered
  `dismissed` in the two runs of a build that named the state, and once that of a layout that waited for its
  scheduled start.
- 0.7.2 on that phone: the lifecycle test passed in 6 of 6 runs, 29 checks each. A build of 0.7.1 on the
  corrected liveactivity, before its release, had passed in 10 of 10.
- A scheduled start on that phone, once with 0.7.1 and once with 0.7.2: launched with `--start-later`, Rust
  scheduled a start 30 s ahead, and the app was ended. No process of the app ran until the time. Then one did,
  which the system had launched, and the app that was launched afterwards listed the activity as `active`.
  [iOS coverage](ios-coverage.md#072-on-two-iphones) has the times.
- 0.7.2 on an iPhone XS with iOS 18.7: the lifecycle test, 2 of 2 runs, 25 checks each.
- 0.7.2 on a Galaxy S23 with Android 17, the first phone since Rust alone names the plugin's files: the device
  tests, 9 of 9; installed over 0.7.1, the layouts of that version listed; the lifecycle test, 24 of 24; a touch
  on the notification of an app whose process had ended, one opening; with the Now Bar extras off, touches on a
  switch, a link and the notification through the system's shade.
  [Android coverage](android-coverage.md#072-on-a-phone) has each run.
- `npm test` (1761 tests in six suites) and `cargo test` (65), `cargo clippy`, `tools/spec-coverage.sh` (82
  requirements, each with a test).
- CI with the two simulator suites, started by hand on the change (run 43615577650, iOS 26.2): the suite on the
  built demo passed its 11 tests on the first try, and the one on `tauri ios dev` its 4. Main has since gained one
  Rust test and two lines of the specification, which alter nothing an app runs; the suites were not run again
  for them. The pull request's own run and the main run of the release commit.

Not checked: the demo's UI tests on a phone. A copy of them that signs its runner was started on the iPhone 16
and stopped where the phone turns UI automation on, which a person allows on the phone: so no touch has reached
a phone's Lock Screen, and nothing has looked at what it draws. A finger on the glass, on either system. Android
15 and earlier with this version. What the app does when the system launches it for a scheduled start.

The record of 0.7.1 follows.

# 0.7.1 validation

0.7.1 corrects two defects of 0.7.0 that kept an opening of the app from a notification from reaching `onOpened`
on Android, and adds the demo examples and the tests that showed them. The JavaScript API and the Android library
change and one command is new, so it is a patch release with a note for capabilities that list commands one by
one. Checked before the tag:

- `npm test` (1761 tests in six suites) and `cargo test` (63), `cargo clippy` for the host and for Android,
  `tools/spec-coverage.sh` (82 requirements, each with a test). Each rule of `onOpened` was changed in place, eleven
  in all, and a test failed each time.
- The Android library on a Galaxy S23 with Android 17: unit tests and lint, and the device tests, 8 of 8. Each of
  the four rules of the watch for opening intents was changed in place, and a device test failed each time.
- The demo on that phone, with touches through the system's own shade: a switch asked for on and then for off, and
  Rust's update moved it; a link and the notification itself each gave one opening; `stale` came 2.2 s after the
  stale time with no call of the app; a scheduled start was refused. With the app's process ended in the
  background, a touch on the notification brought the app back and its page heard one opening, where a build with
  0.7.0's Kotlin heard none; launched anew from a link, the page heard one, and brought back from its icon after
  the process had ended again, no second one. [Android coverage](android-coverage.md#openings-and-touches-071) has
  each run.
- An iPhone XS with iOS 18.7, launched with `--self-test`: the demo's lifecycle test through the plugin, 25 of 25,
  with a layout of a switch, a link and nodes that follow staleness, and a scheduled start refused as below iOS 26.
- CI of the pull request and the main run of the release commit. The two simulator suites, started by hand on the
  head of the pull request: the one on the built demo passed its 11 tests on the first try, on iOS 26.2, among them the four new ones (a switch, a link,
  stale content and a scheduled start that began with the app ended); the one on `tauri ios dev` passed them on the first try.

Not checked: a finger on the glass, on either system: every touch was injected, by `adb shell input tap` through
the system's shade on Android and by a UI test on the simulator. Android 15 and earlier with this version. An
iPhone with iOS 26 or later: the one at hand went offline while the demo was built for it, so no phone has begun a
scheduled start. What an iPhone's Lock Screen draws: the phone runs the lifecycle test and nothing looks at its
screen.

The record of 0.7.0 follows.

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

The commands as they run today. 0.2.0 also ran the plugin's own Swift tests, with `tests/ios/run-core.sh`: they
went with the plugin's Swift and are activitykit's now.

```sh
npm ci
npm test && npm run typecheck && npm run build:demo
node --experimental-strip-types --test --experimental-test-coverage --test-coverage-include=tools/release-guard.ts \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  tests/release/release-guard.test.ts
cargo fmt --all -- --check
cargo fmt --manifest-path examples/demo/src-tauri/Cargo.toml -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo llvm-cov --locked --summary-only --fail-under-lines 80
cargo test --locked --manifest-path examples/demo/src-tauri/Cargo.toml
npm pack --dry-run
cargo package --locked
cd tests/android
./gradlew :live-activity:testDebugUnitTest :live-activity:lintDebug \
  :live-activity:assembleDebugAndroidTest --no-daemon
# One emulator or device attached, named by ANDROID_SERIAL:
./gradlew -PliveActivityCoverage=true :live-activity:connectedDebugAndroidTest \
  :live-activity:testDebugUnitTest --rerun :live-activity:coverageVerification
cd ../..
node --experimental-strip-types tests/android/verify-min-sdk.ts "$ANDROID_HOME/build-tools/37.0.0/aapt" \
  android/build/outputs/apk/androidTest/debug/live-activity-debug-androidTest.apk
```
