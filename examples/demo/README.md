# Mochi — Live Activity demo

Follow Mochi's snack delivery or start a nap timer. The snack moves from packing
to delivery and arrival; the nap can be extended by a minute. Both use the real
TypeScript → Rust → native bridge. The app supplies example state rather than
connecting to a delivery service.

Permission controls appear when needed. **Developer tools** contains capabilities,
records and the opt-in lifecycle test. Desktop builds explicitly report an
unsupported backend. The [iOS widget](widget/MochiWidget.swift) uses the same shared
attributes as the plugin, with a cat design for the Lock Screen and Dynamic Island.

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

Self-test runner unit tests use a scripted API and are separate from native integration results:

```sh
npm run test:demo
```
