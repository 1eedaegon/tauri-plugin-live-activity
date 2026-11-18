# Mochi — Live Activity demo

A Tauri 2 app that follows a cat named Mochi: a snack on its way, a nap, and one small example of each
thing a layout can hold. Every button goes the whole way, from TypeScript through Rust to ActivityKit on
iOS and to a notification on Android. Nothing is behind it but the app: it makes up its own state, and no
service sends it anything.

<table>
  <tr><th>The app</th><th>What it starts</th></tr>
  <tr>
    <td rowspan="3"><img src="../../docs/images/ios-demo-snack.png" width="250" alt="The demo's page on an iPhone: Mochi the cat, the Snack delivery tab open, a delivery at 65% and the buttons The snack is here and Finish delivery"></td>
    <td><img src="../../docs/images/ios-v1-progress.png" width="400" alt="Mochi's snack delivery, On the way to Mochi, with a bar at 65% on the iOS Lock Screen"><br>iOS Lock Screen</td>
  </tr>
  <tr>
    <td><img src="../../docs/images/ios-island-compact.png" width="300" alt="A paw and 9 min in the compact Dynamic Island"><br>Dynamic Island, of the example of that name</td>
  </tr>
  <tr>
    <td><img src="../../docs/images/android-v1-progress.png" width="400" alt="Mochi's snack delivery, On the way to Mochi, with a bar at 65% as an Android notification"><br>Android notification</td>
  </tr>
</table>

The pictures of this page are the demo of this folder on the iPhone 17 Pro simulator with iOS 26.3 and on
an emulator of Android 16 ([how they were taken](#the-pictures)).

## Run it

You need Node 22.12 or later and Rust with the target of your device. iOS needs a Mac with Xcode and
[XcodeGen](https://github.com/yonaskolb/XcodeGen); Android needs the Android SDK, the NDK and Java, which
Android Studio brings. From the repository root:

```sh
npm ci
source tools/mobile-env.sh      # cargo, Java and the Android tools for this shell
npm run build:demo
cd examples/demo
npm run tauri -- ios dev        # or: npm run tauri -- android dev
```

- **iOS.** Run `npm run build:demo` before the first `ios dev` and after an update of the plugin's
  activitykit dependency, so that the Xcode project finds activitykit's package. It asks cargo where the
  package is, and in a shell without cargo it only warns. On a Mac without the Android tools,
  `source tools/rust-env.sh` sets up cargo alone.
- **Android.** With more than one device attached, name the device (`android dev <name>`) and set
  `ANDROID_SERIAL` to its serial: Tauri's CLI asks adb for the app's process without naming the device,
  and waits for an answer that never comes. It also waits for the boot animation to have stopped, which
  an emulator started with `-no-boot-anim` never reports.
- **A Galaxy.** This app turns on `android.samsungNowBar`, and with it One UI 9 drew the notification of a
  layout as a card of its own on a Galaxy S23: the title and the text, with no bar and no actions to tap.
  The Android pictures of this page are an emulator's, but the one of the Now Bar. Take the option out of
  `src-tauri/tauri.conf.json` to see the same on a Galaxy
  ([Samsung Now Bar](../../docs/usage.md#samsung-now-bar)).
- **Desktop.** A desktop build shows the page and says that the device has no backend: the start buttons
  stay off.

The generated Android and iOS projects are under `src-tauri/gen`.

### The first start

<table>
  <tr><th>Android</th><th>iOS</th></tr>
  <tr>
    <td><img src="../../docs/images/android-permission.png" width="250" alt="Android asks: Allow live-activity-demo to send you notifications? over the demo's page, which shows One small thing first and the button Request notification permission"></td>
    <td><img src="../../docs/images/ios-question.png" width="400" alt="Under the first card on the Lock Screen iOS asks: Allow Live Activities from live-activity-demo? with Don't Allow and Allow"></td>
  </tr>
</table>

- **Android** 13 and later shows nothing until the app may send notifications. The page says so under the
  card, "One small thing first", and **Request notification permission** brings Android's question.
- **iOS** asks nothing in the app. The system asks under the app's first card on the Lock Screen whether
  it may show Live Activities ("Allow"), and under its second whether it may go on ("Always Allow").
  Where Live Activities are off for the app in Settings, the page says so and offers **Check Live Activity
  settings**.

## Use it

The page has three tabs. What a tab starts lives outside the page: on the Lock Screen and in the Dynamic
Island, or among the notifications. The line with the green dot under the buttons says where to look. The
label at the top right of the card follows the activity's state: `WAITING FOR ITS TIME` while a scheduled
start is pending, `NEEDS A LITTLE UPDATE` once its content is stale, `SENT TO YOUR PHONE` while the system
has not reported a state.

<table>
  <tr><th>iOS: a snack and a nap</th><th>iOS: new values change a style</th><th>Android: a snack on the lock screen</th></tr>
  <tr>
    <td><img src="../../docs/images/ios-demo.gif" width="250" alt="The page sends Mochi's snack on its way and the Lock Screen shows its card with a bar at 65%, under the system's question at first; then a nap is started and snoozed, and its card counts down on the Lock Screen"></td>
    <td><img src="../../docs/images/ios-styles.gif" width="250" alt="The page starts the Changing styles example and the Lock Screen shows On time in green; Send new values, and the card says Running 5 min late in red and bold"></td>
    <td><img src="../../docs/images/android-snack.gif" width="250" alt="The page starts Mochi's snack delivery; the phone is locked and its lock screen shows the notification, whose bar moves with each update; a swipe unlocks and the delivery ends"></td>
  </tr>
</table>

### Snack delivery

The progress template of request contract v1: a title, a status and a share from 0 to 1.

1. **Start snack delivery** starts the activity at 15 %, "Packing a tiny treat".
2. **Send it on its way** updates it to 65 %, and **The snack is here!** to 100 %. Each update sends the
   whole snapshot again with the next revision.
3. **Finish delivery** ends it, and the card and the notification go at once. At 100 % the same button reads
   **All done. Happy Mochi!**

<table>
  <tr><th>The page</th><th>iOS Lock Screen</th><th>Android notification</th></tr>
  <tr>
    <td><img src="../../docs/images/android-demo-snack.png" width="220" alt="The demo's page on Android with a delivery at 65%"></td>
    <td><img src="../../docs/images/ios-v1-progress.png" width="330" alt="Mochi's snack delivery with a bar at 65% on the iOS Lock Screen"></td>
    <td><img src="../../docs/images/android-v1-progress.png" width="330" alt="Mochi's snack delivery with a bar at 65% as an Android notification"></td>
  </tr>
</table>

### Nap timer

The timer template: a title, a status and the two ends of a timer. Choose 1, 5 or 15 minutes and tap
**Start a little nap**. The system counts down by itself; the app sends nothing per second, and the clock
on the page only follows the same end time. **Snooze for one more minute** moves the end by a minute with
an update, and **Wake up, sleepyhead** ends the nap.

<table>
  <tr><th>The page</th><th>iOS Lock Screen</th><th>Android notification</th></tr>
  <tr>
    <td><img src="../../docs/images/ios-demo-nap.png" width="220" alt="The Nap timer tab with Mochi asleep, a clock counting down and the buttons Snooze for one more minute and Wake up, sleepyhead"></td>
    <td><img src="../../docs/images/ios-v1-timer.png" width="330" alt="Mochi's nap counting down on the iOS Lock Screen, after one more minute"></td>
    <td><img src="../../docs/images/android-v1-timer.png" width="330" alt="Mochi's nap with the countdown in the header of an Android notification"></td>
  </tr>
</table>

### Layouts

One example for each feature of request contract v2, where the app designs the card itself: a tree of
nodes, a table of styles and a map of values. Each example is one complete `startLayout` request in
[src/layouts.ts](src/layouts.ts).

<table>
  <tr><th>Choose an example</th><th>While it runs</th><th>The request</th><th>A start that waits</th></tr>
  <tr>
    <td><img src="../../docs/images/ios-demo-picker.png" width="200" alt="The Layouts tab: the Text example chosen among eighteen chips, what Android shows of it, and the button Start this example"></td>
    <td><img src="../../docs/images/ios-demo-layouts.png" width="200" alt="The Changing styles example under way: the label On your phone now, and the buttons Send new values and End this example"></td>
    <td><img src="../../docs/images/ios-demo-request.png" width="200" alt="The request of the Changing styles example opened: its JSON with activityKey, schemaVersion, fallback and the layout's tree"></td>
    <td><img src="../../docs/images/ios-demo-pending.png" width="200" alt="The Scheduled start example after its start: the label Waiting for its time, and the button End this example"></td>
  </tr>
</table>

1. Choose an example by its chip. The card says what it shows and, in the line that begins "On Android",
   what a notification makes of it.
2. **Start this example** starts it, and ends the other examples first, so that the Lock Screen has one
   card to look at.
3. **Send new values** sends the example's next values, where it has any: the layout stays as it started,
   and every update carries all values again. While the example runs, "Left out on this device" names
   what the platform did not draw (`degradedFeatures` of the record).
4. **End this example** ends it.
5. **The request** opens the start request as JSON, as `startLayout` gets it.

What each example shows:

<table>
  <tr><th>Example</th><th>iOS Lock Screen</th><th>Android notification</th></tr>
  <tr>
    <td><b>Text</b><br>A literal or a bound value in a named style. A node with <code>if</code> or <code>unless</code> shows only while a value is truthy, or is not: two updates later the status gives way to a line in bold coral.</td>
    <td><img src="../../docs/images/ios-layout-text.png" width="300" alt="A title and a status on the iOS Lock Screen"><br><img src="../../docs/images/ios-layout-text-arrived.png" width="300" alt="The status replaced by Snack time! Made it home in bold coral"></td>
    <td><img src="../../docs/images/android-layout-text.png" width="300" alt="The title and the status as an Android notification"><br>The first text is the title and the second the body. Styles are left out.</td>
  </tr>
  <tr>
    <td><b>SF Symbols</b><br>A symbol by its name, in multicolor, and one that a number fills.</td>
    <td><img src="../../docs/images/ios-layout-symbols.png" width="300" alt="A cat, a multicolor heart and a speaker with two of its three waves beside a title and a status"></td>
    <td>No symbols: the record names <code>layout.symbol</code>.</td>
  </tr>
  <tr>
    <td><b>Image</b><br>A picture from the asset catalog of the widget extension.</td>
    <td><img src="../../docs/images/ios-layout-image.png" width="300" alt="Mochi's portrait beside a title and a status"></td>
    <td>No images of the widget: <code>layout.image</code>.</td>
  </tr>
  <tr>
    <td><b>Paths</b><br>SVG path data in a box, filled or stroked.</td>
    <td><img src="../../docs/images/ios-layout-paths.png" width="300" alt="Mochi's sleeping face drawn from four paths"></td>
    <td>No paths: <code>layout.path</code>.</td>
  </tr>
  <tr>
    <td><b>Gauge</b><br>A number between a minimum and a maximum, as a ring and as a bar.</td>
    <td><img src="../../docs/images/ios-layout-gauge.png" width="300" alt="A ring and a bar at 80 of 100"></td>
    <td>No gauges: <code>layout.gauge</code>.</td>
  </tr>
  <tr>
    <td><b>Progress</b><br>A number from 0 to 1, as a ring and as a bar. Here after one update, at 0.65.</td>
    <td><img src="../../docs/images/ios-layout-progress.png" width="300" alt="A ring and a bar at 65%"></td>
    <td><img src="../../docs/images/android-layout-progress.png" width="300" alt="The first progress view as the bar of an Android notification, at 65%"><br>The first progress is the notification's bar.</td>
  </tr>
  <tr>
    <td><b>Timer</b><br>A text that counts down to its end, redrawn by the system every second.</td>
    <td><img src="../../docs/images/ios-layout-timer.png" width="300" alt="A countdown under Mochi's nap"></td>
    <td><img src="../../docs/images/android-layout-timer.png" width="300" alt="The countdown as the chronometer in the notification's header"><br>The first timer is the notification's chronometer.</td>
  </tr>
  <tr>
    <td><b>Stacks</b><br>Nodes in a column, in a row and on top of each other, with a spacer and a divider.</td>
    <td><img src="../../docs/images/ios-layout-stacks.png" width="300" alt="A paw badge, a title and a time in a row, a line, and From and To below"></td>
    <td><img src="../../docs/images/android-layout-stacks.png" width="300" alt="Snack route and 4 min as an Android notification"><br>The first two texts, as the title and the body.</td>
  </tr>
  <tr>
    <td><b>Buttons</b><br>A button reports its action to the app. Rust takes a second to count each pet, and <b>All done</b> ends the activity.</td>
    <td><img src="../../docs/images/ios-layout-buttons-before.png" width="300" alt="Pet Mochi and All done under No pets yet"><br><img src="../../docs/images/ios-layout-buttons-after.png" width="300" alt="After a tap on Pet Mochi: Purring. 1 pet so far"></td>
    <td><img src="../../docs/images/android-layout-buttons-before.png" width="300" alt="Pet Mochi and All done as actions of the notification"><br><img src="../../docs/images/android-layout-buttons-after.png" width="300" alt="After a tap on Pet Mochi: Purring. 1 pet so far"></td>
  </tr>
  <tr>
    <td><b>Switch</b><br>A toggle shows a flag and reports the state the person asked for. Only Rust's update moves it.</td>
    <td><img src="../../docs/images/ios-layout-switch-off.png" width="300" alt="The switch Purr alerts, off, under Quiet as a mouse"><br><img src="../../docs/images/ios-layout-switch-on.png" width="300" alt="After a tap: the switch on, under Purring out loud"></td>
    <td><img src="../../docs/images/android-layout-switch-off.png" width="300" alt="Purr alerts as an action of the notification"><br><img src="../../docs/images/android-layout-switch-on.png" width="300" alt="After a tap: a check mark before Purr alerts"></td>
  </tr>
  <tr>
    <td><b>Link</b><br>A line that opens the app with a URL, here <code>mochi://treats</code>.</td>
    <td><img src="../../docs/images/ios-layout-link.png" width="300" alt="Open the treat jar as a link under Three treats left"></td>
    <td><img src="../../docs/images/android-layout-link.png" width="300" alt="Open the treat jar as an action of the notification"><br>An action that opens the URL in the app; <code>onOpened</code> reports it.</td>
  </tr>
  <tr>
    <td><b>Changing styles</b><br>A style member that names a value: an update turns the status red and bold.</td>
    <td><img src="../../docs/images/ios-layout-styles-before.png" width="300" alt="On time, in green, with a green bar"><br><img src="../../docs/images/ios-layout-styles-after.png" width="300" alt="After an update: Running 5 min late, red and bold, with a red bar"></td>
    <td><img src="../../docs/images/android-layout-styles.png" width="300" alt="Running 5 min late as plain text over the bar of an Android notification"><br>The text changes, its color does not.</td>
  </tr>
  <tr>
    <td><b>Staleness</b><br>A node that shows only while the content is fresh, and one only while it is stale. The content is stale 45 seconds after its start; on a simulator a card that was drawn fresh turned two minutes after its start.</td>
    <td><img src="../../docs/images/ios-layout-staleness-fresh.png" width="300" alt="Left the kitchen, while the content is fresh"><br><img src="../../docs/images/ios-layout-staleness-stale.png" width="300" alt="Waiting for news of the snack, once the content is stale"></td>
    <td>The notification stays as it was posted, and the record names <code>layout.ifStale</code>. The page hears of the stale state through <code>onState</code>.</td>
  </tr>
  <tr>
    <td><b>Scheduled start</b><br>A start that begins 30 seconds later, with an alert. Until then it is pending: it takes no update and can be ended.</td>
    <td><img src="../../docs/images/ios-layout-later.png" width="300" alt="Mochi's dinner bell, Dinner is served, once the system has begun the activity"></td>
    <td><img src="../../docs/images/android-layout-later.png" width="300" alt="Mochi's dinner bell as a notification that an alarm posted"><br>An alarm posts it, also with the app closed. It may come minutes late until exact alarms are allowed, which the page offers.</td>
  </tr>
  <tr>
    <td><b>Dynamic Island</b><br>The island's own nodes for its expanded regions, its compact sides and its minimal form, and a color for its edge.</td>
    <td><img src="../../docs/images/ios-island-compact.png" width="220" alt="A paw and 9 min in the compact Dynamic Island"><br><img src="../../docs/images/ios-island-expanded.png" width="300" alt="Mochi's portrait, the title, 9 min, the status and a bar in the expanded Dynamic Island"></td>
    <td>No island: the notification shows the lock screen tree, and the record names <code>layout.island</code>.</td>
  </tr>
  <tr>
    <td><b>Watch and car</b><br>The <code>small</code> region, a glance for a paired Apple Watch and CarPlay.</td>
    <td><img src="../../docs/images/ios-layout-small.png" width="300" alt="The lock screen tree of the example on the iPhone: title, status and a bar"><br>The iPhone itself draws the lock screen tree. The glance is not captured: the simulator has no watch, and its CarPlay display shows no Live Activity.</td>
    <td>A watch and a car show the notification by themselves: <code>layout.small</code>.</td>
  </tr>
  <tr>
    <td><b>Android</b><br>What a notification takes of a layout: title, body, the bar and up to three actions.</td>
    <td><img src="../../docs/images/ios-layout-android.png" width="300" alt="The same tree on the iOS Lock Screen: a moon, Mochi's nap, Fast asleep, a bar and Wake Mochi"></td>
    <td><img src="../../docs/images/android-layout-android.png" width="300" alt="Mochi's nap, Fast asleep, a bar and the action Wake Mochi as an Android notification"></td>
  </tr>
  <tr>
    <td><b>Now Bar</b><br>With <code>android.samsungNowBar</code> on, which this app's <code>tauri.conf.json</code> has, One UI's Now Bar shows the title and the body.</td>
    <td><img src="../../docs/images/ios-layout-nowbar.png" width="300" alt="The same layout on the iOS Lock Screen: title, status and a bar"></td>
    <td><img src="../../docs/images/samsung-now-bar.png" width="300" alt="Mochi's snack delivery and On the way to Mochi in the One UI Now Bar of a Galaxy S23"><br>A Galaxy S23, 2026-11-06. One UI shows the Now Bar for apps on Samsung's allow list, or for all while the developer option is on.</td>
  </tr>
</table>

### Taps

Rust handles the taps ([src-tauri/src/actions.rs](src-tauri/src/actions.rs)), so they also work while the
page does not run: the system can launch the app for a tap with no web view yet. `pet` counts a pet and
`purr` sets the flag that the switch asked for, each with an update after a pause of a second that the
tap's intent waits for; `done` and `wake` end the activity. The page only reports what it hears, in its
message and under **Developer tools**.

Known, on iOS: the tap of a button comes with `on: false`, as the picture below shows for `pet`, where the
contract gives `on` to a toggle alone. Tell a toggle by its action, not by whether `on` is there.

### Developer tools

<table>
  <tr><th>After a tap on Pet Mochi</th><th>The lifecycle test</th></tr>
  <tr>
    <td><img src="../../docs/images/ios-demo-tap.png" width="250" alt="Developer tools: the record of the Buttons example at revision 1, and the last tap as the page heard it"></td>
    <td><img src="../../docs/images/ios-demo-tools.png" width="250" alt="Developer tools: the lifecycle test's report with the status passed"></td>
  </tr>
</table>

The part at the foot of the page shows what the plugin answers:

- **Capabilities and permissions**: `getCapabilities()` and `checkPermissions()`.
- **Plugin-owned activities**: the records of `list()` and of `listLayout()`, the last tap that `onAction`
  heard, the last state from `onState` and, on Android, the last opening from a notification.
- **Lifecycle integration test** runs its checks through TypeScript, Rust and the native side: the
  progress template with duplicate starts, newer, identical, stale and conflicting revisions, the list, ends
  and handles of an ended activity; the same of a layout, with a jump of revisions and final content; a start
  that asks for a push token; a layout with a switch, a link and nodes that follow staleness; a layout with
  a `small` region; and a scheduled start, which is pending on iOS 26 and on Android and refused by an
  older iOS. It ends its own activities. The report has `status`, `platform`, `checks` and
  `visibility: "unknown"`: it is no evidence that anything was drawn. Grant the notification permission
  first on Android 13 and later.

Launched with the argument `--self-test`, the app runs the test at once, saves the report with the demo's
examples as it found them (`found`) to `live-activity-self-test.json` under the app's data directory, and
ends those examples: that is how a phone with no UI test runs it
(`xcrun devicectl device process launch --device <id> <bundle id> --self-test`). An automation build can
set the main window URL to `index.html?selftest=1` for the same. `--start-later` has Rust start the
Scheduled start example at launch, and `--start-buttons` the Buttons example.

## How it is built

- [widget/MochiWidgets.swift](widget/MochiWidgets.swift) is activitykit's widget template,
  `ActivityKitLayoutWidget()` in a `@main` widget bundle. It draws every activity of the demo, the two
  templates included. The extension (iOS 16.2) links activitykit's `ActivityKitWidget` product, sets
  `ActivityKitLayout` to `2` and `ActivityKitSmallFamily` to true, so that it draws a layout's `small`
  region, and holds the image `mochi` in its own [asset catalog](widget/Assets.xcassets), drawn from
  [mochi-portrait.svg](widget/mochi-portrait.svg).
- The app target links `ActivityKitIntent`, the intent that a button's tap runs in the app, and compiles
  [app/ActivityKitIntents.swift](app/ActivityKitIntents.swift), a file that only imports it: Xcode takes
  the intent's App Intents metadata only for a target that compiles Swift. The demo has no custom views,
  so the app target does not link `ActivityKitViews`.
- `src-tauri/gen/apple/project.yml` names activitykit's Swift package as `activitykit/swift`.
  `src-tauri/gen/apple/activitykit` is a link to the folder of the activitykit crate that the plugin
  builds with, which [link-activitykit.ts](link-activitykit.ts) finds with `cargo metadata`. `build.ts`,
  and so `npm run build:demo`, makes the link before each build;
  `node --experimental-strip-types link-activitykit.ts` makes it alone. The link is local to your checkout
  and ignored by git.
- The project was written by hand, the way the [iOS integration guide](../../docs/ios-integration.md)
  describes; `setup` leaves a project that already has a widget extension alone.
- `tauri.conf.json` turns on `android.samsungNowBar`, and the Android manifest declares
  `SCHEDULE_EXACT_ALARM` for the Scheduled start example.

## While you change it

`android dev` and `ios dev` stay until you stop them, and a change shows without building the app again
where it can:

- **The page.** Both start `build.ts --watch`, which writes `dist` again after each change of the demo's
  sources and of the plugin's `guest-js`, and Tauri's dev server has the app load the page again. On an
  Android emulator the page was back 0.6 s after a change of `src/layouts.ts`.
- **An activity.** It keeps the layout and the values it was started with. End it and start it again to
  see a changed layout; changed values go with the next update.
- **Rust.** A change under `src-tauri` builds, installs and launches the app again. The plugin's own Rust
  is outside that folder: add `--additional-watch-folders "$(cd ../../src && pwd)"` to have a change there
  do the same.
- **Kotlin and Swift** are compiled when the app is built, so they show after such a build.

## Tests

### On an iOS Simulator

From the repository root, after `npm ci`:

```sh
tests/ios/run.sh
```

The script creates an iPhone 17 Pro simulator of its own, builds the demo for it with
`tauri ios build --debug`, installs it and runs the UI tests of
[tests/ios/DemoUITests](../../tests/ios/DemoUITests): a bound style on the Lock Screen, a Lock Screen
button that reaches Rust and the page, `listLayout` after a relaunch, the lifecycle test, the snack and
nap templates on the Lock Screen, a tap that launches the app in the background for the slow `pet`
handler, a layout that Rust starts, a switch, a link that opens the app, content that turns stale, a
scheduled start that begins with the app ended, and a retry that finds its example stopped. It copies
the screenshots to `tests/ios/output` and deletes the simulator and the build afterwards. It needs Xcode,
XcodeGen and cargo with the iOS simulator target of your Mac.

- `ONLY=DemoTests/test2LockScreenButtonReachesRustAndJavaScript tests/ios/run.sh` runs one test.
- `MODE=dev tests/ios/run.sh` lets `tauri ios dev` build, install and serve the demo instead, and
  runs the layout, button and relaunch tests on it, and the one where the demo, launched with
  `--start-buttons`, starts the Buttons example from Rust.
- `BUILD_DIR=<folder>` keeps the built demo and UI tests, and `BUILD_KEY=<name>` marks a complete
  build: a later run with the same key tests it without building, as CI does on a cache hit.

### Unit tests

Unit tests of the self-test runner and the layout examples use no native API. They keep the
starts and updates of the snack and the nap, the start of every example with its updates, and
every request of the self-test, as JSON under `tests/fixtures/typescript`, where the plugin's Rust
tests judge each with the checks that the commands run (`npm run write:requests` writes the files
again after a change), and they check the demo's iOS project against activitykit's widget template
and products:

```sh
npm run test:demo
```

### The page in a browser

[design/README.md](design/README.md) has a check of the page alone, in a browser with a stand-in for the
native side: its states, its keyboard use and its contrast. No workflow runs it; run it after a change to
the page.

## The pictures

Every picture of this page, and every picture of the demo in the [usage guide](../../docs/usage.md), is a
screen as it was: the whole of it, or a part cut out, with nothing drawn over it. Two commands take them
again after a change, each on a device of its own.

```sh
# iOS: a simulator that the run creates and deletes; the pictures land in tests/ios/output.
TEST_RUNNER_DEMO_SCREENS=1 ONLY=DemoScreens tests/ios/run.sh

# Android: the demo's debug build, installed on the device that is named. It clears the demo's data.
node --experimental-strip-types tests/android/screens.ts "$ANDROID_HOME/platform-tools/adb" <serial> <port> <folder>
```

The Android script wants the demo's notification first in the shade, so clear the other notifications of the
device before a run, and a local port that is free: it stops when the port already leads to another device.

[DemoScreens.swift](../../tests/ios/DemoUITests/UITests/DemoScreens.swift) walks the page as a person
would and is skipped in every other run. [screens.ts](../../tests/android/screens.ts) drives the page
through the WebView's DevTools socket and the notification shade through adb.

On the simulator a card sometimes came on a light background under the text of the dark scheme, which is
hard to read: the first drawing of a card with a timer every time, other cards now and then, fewer after an
update. So `DemoScreens` takes most cards after an update, and starts an example again whose card came out
light. The run's `light-cards.txt` names the pictures that stayed light all the same; such a picture was
taken from another run. Whether a phone does the same has not been looked at. A card in that state, the
Buttons example at its start as one run took it:

<img src="../../docs/images/ios-card-light.png" width="300" alt="A light card on the iOS Lock Screen with a cat, the button Pet Mochi and a pale All done; its white title and status can hardly be read">

The three moving pictures are parts of screen recordings, joined and scaled down with ffmpeg: on iOS
`xcrun simctl io <udid> recordVideo` beside such a run, on Android `adb shell screenrecord` while the page
was driven the same way. What lies between the parts is left out, and nothing is drawn over a frame.

Some pictures are older, and neither command takes them:

- **The minimal Dynamic Island** in the [usage guide](../../docs/usage.md#dynamic-island) is of 2026-11-06:
  with the demo's activities alone the simulator kept the island's compact form.
- **The Now Bar** is a Galaxy S23's, of 2026-11-06.
- **The two pictures of a custom view** in the [usage guide](../../docs/usage.md#beyond-the-built-in-parts)
  are of 0.3, in an app made for them: the demo has no custom view.
