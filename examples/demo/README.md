# Mochi — Live Activity demo

Follow Mochi's snack delivery or start a nap timer. The snack moves from packing
to delivery and arrival; the nap can be extended by a minute. Both use the real
TypeScript → Rust → native bridge. The app supplies example state rather than
connecting to a delivery service.

Permission controls appear when needed. **Developer tools** contains capabilities,
records and the opt-in lifecycle test. Desktop builds explicitly report an
unsupported backend. On iOS the widget extension holds activitykit's widget,
`ActivityKitLayoutWidget`, which draws every activity of the demo, the snack and nap
templates included. The demo's own widget with the cat design, which 0.3 used for the
templates, is gone.

## Layouts

The **Layouts** tab shows the layout nodes of request contract v2 one at a time: text
and values, SF Symbols, an image, paths, a gauge, progress, a timer, stacks, buttons,
styles that an update changes, the Dynamic Island, the Android notification and the Samsung
Now Bar. Each example is
one complete `startLayout` request in [src/layouts.ts](src/layouts.ts); the tab shows
it under **The request**. Starting an example ends the other examples first.

- [widget/MochiWidgets.swift](widget/MochiWidgets.swift) is activitykit's widget template,
  `ActivityKitLayoutWidget()` in a `@main` widget bundle. The extension (iOS 16.2) links
  activitykit's `ActivityKitWidget` product, sets `ActivityKitLayout` to `2`, and holds the
  image `mochi` in its own [asset catalog](widget/Assets.xcassets), drawn from
  [mochi-portrait.svg](widget/mochi-portrait.svg).
- The app target links `ActivityKitIntent`, the intent that a button's tap runs in the app,
  and compiles [app/ActivityKitIntents.swift](app/ActivityKitIntents.swift), a file that only
  imports it: Xcode takes the intent's App Intents metadata only for a target that compiles
  Swift. The demo has no custom views, so the app target does not link `ActivityKitViews`.
- `src-tauri/gen/apple/project.yml` names activitykit's Swift package as `activitykit/swift`.
  `src-tauri/gen/apple/activitykit` is a link to the folder of the activitykit crate that the
  plugin builds with, which [link-activitykit.mjs](link-activitykit.mjs) finds with
  `cargo metadata`. `build.mjs`, and so `npm run build:demo`, makes the link before each build;
  `node link-activitykit.mjs` makes it alone. The link is local to your checkout and ignored by
  git.
- The project was written by hand, the way the [iOS integration guide](../../docs/ios-integration.md)
  describes; `setup` leaves a project that already has a widget extension alone.
- Button taps are handled in Rust ([src-tauri/src/actions.rs](src-tauri/src/actions.rs)),
  so they also work while the page is not running: `pet` counts a pet, `done` and
  `wake` end the activity. The page only reports the tap.
- `tauri.conf.json` turns on `android.samsungNowBar`.

From the repository root:

```sh
npm ci
npm run build:demo
source tools/mobile-env.sh
cd examples/demo
npm run tauri -- android dev
# Or: npm run tauri -- ios dev
```

On iOS, run `npm run build:demo` before the first `ios dev` and after an update of the plugin's
activitykit dependency, so that the Xcode project finds activitykit's package. Generated Android
and iOS projects are under `src-tauri/gen`. Android notifications require permission on API 33+;
grant it with the app's permission button or the emulator's app settings before running the
lifecycle test.

The lifecycle test verifies 13 assertions, including duplicate starts, newer/identical/stale
revisions, conflicting payloads, list reconciliation, idempotent end and old-handle isolation.
It ends its own activities. Results appear in the page and in
`live-activity-self-test.json` under the app's data directory. The JSON report contains
`status`, `platform`, `checks`, and `visibility: "unknown"`; it is not evidence of visual delivery.

An automation build can set the main window URL to `index.html?selftest=1`, which runs the test
once at startup without requesting permissions. The default build only runs tests when the
button is pressed. To inspect notification/Lock Screen visuals, start a separate manual
activity after the test and inspect the actual native surface.

## On an iOS Simulator

From the repository root, after `npm ci`:

```sh
tests/ios/run.sh
```

The script creates an iPhone 17 Pro simulator of its own, builds the demo for it with
`tauri ios build --debug`, installs it and runs the UI tests of
[tests/ios/DemoUITests](../../tests/ios/DemoUITests): a bound style on the Lock Screen, a
Lock Screen button that reaches Rust and the page, `listLayout` after a relaunch, the lifecycle
test, and the snack and nap templates on the Lock Screen. It copies the screenshots to
`tests/ios/output` and deletes the simulator and the build afterwards. It needs Xcode, XcodeGen
and cargo with the iOS simulator target of your Mac.
`ONLY=DemoTests/test2LockScreenButtonReachesRustAndJavaScript tests/ios/run.sh` runs one test.

## Unit tests

Unit tests of the self-test runner and the layout examples use no native API. The layout
tests check every example with the reference validator, and the demo's iOS project against
activitykit's widget template and products:

```sh
npm run test:demo
```
