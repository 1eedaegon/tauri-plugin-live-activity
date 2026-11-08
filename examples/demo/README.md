# Mochi — Live Activity demo

Follow Mochi's snack delivery or start a nap timer. The snack moves from packing
to delivery and arrival; the nap can be extended by a minute. Both use the real
TypeScript → Rust → native bridge. The app supplies example state rather than
connecting to a delivery service.

Permission controls appear when needed. **Developer tools** contains capabilities,
records and the opt-in lifecycle test. Desktop builds explicitly report an
unsupported backend. The [iOS widget](widget/MochiWidget.swift) uses the same shared
attributes as the plugin, with a cat design for the Lock Screen and Dynamic Island.

## Layouts

The **Layouts** tab shows the layout nodes of request contract v2 one at a time: text
and values, SF Symbols, an image, paths, a gauge, progress, a timer, stacks, buttons,
styles that an update changes, the Dynamic Island, the Android notification and the Samsung
Now Bar. Each example is
one complete `startLayout` request in [src/layouts.ts](src/layouts.ts); the tab shows
it under **The request**. Starting an example ends the other examples first.

- The widget bundle adds the plugin's layout widget to Mochi's v1 widget.
  [LiveActivityLayoutWidget.swift](widget/LiveActivityLayoutWidget.swift) is the
  template's `LiveActivityLayoutWidget`, unchanged. The extension links
  `LiveActivityShared` and `LiveActivityUI`, sets `TauriLiveActivityLayout` to `2`,
  and holds the image `mochi` in its own [asset catalog](widget/Assets.xcassets),
  drawn from [mochi-portrait.svg](widget/mochi-portrait.svg).
- `templates/ios/LiveActivityActionIntent.swift` is compiled into the app and the
  extension, as `src-tauri/gen/apple/project.yml` shows.
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

Generated Android and iOS projects are under `src-tauri/gen`. The iOS widget extension is
configured by the iOS integration setup; see [the integration guide](../../docs/ios-integration.md).
Android notifications require permission on API 33+; grant it with the app's permission button
or the emulator's app settings before running the lifecycle test.

The lifecycle test verifies 13 assertions, including duplicate starts, newer/identical/stale
revisions, conflicting payloads, list reconciliation, idempotent end and old-handle isolation.
It ends its own activities. Results appear in the page and in
`live-activity-self-test.json` under the app's data directory. The JSON report contains
`status`, `platform`, `checks`, and `visibility: "unknown"`; it is not evidence of visual delivery.

An automation build can set the main window URL to `index.html?selftest=1`, which runs the test
once at startup without requesting permissions. The default build only runs tests when the
button is pressed. To inspect notification/Lock Screen visuals, start a separate manual
activity after the test and inspect the actual native surface.

Unit tests of the self-test runner and the layout examples use no native API. The layout
tests check every example with the reference validator, and the demo's iOS setup against
the template:

```sh
npm run test:demo
```
