# Live Activity demo

Local Tauri app for exercising the plugin through its real TypeScript → Rust → native bridge.
The app has explicit permission, start, update, end and lifecycle-test buttons. Desktop builds
show unsupported capabilities; they do not substitute a browser implementation.

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
