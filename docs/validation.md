# 0.1.0-alpha.1 validation

Run on 2026-11-04, Apple Silicon macOS 27.2. This is an alpha release;
emulator results do not certify physical devices or Samsung One UI behavior.

## Automated checks

| Layer | Result |
| --- | --- |
| Request schema | 52 Node tests; validator line/branch/function coverage 100% |
| TypeScript IPC API | 14 mockIPC tests; wrapper line/branch/function coverage 100% |
| Demo test runner and UI state | 9 tests; typecheck and static bundle pass |
| Rust | 10 tests; host line coverage 96.28%, functions 87.50%; clippy clean |
| Swift shared model/lifecycle | 36 assertions; line coverage 98.05% |
| Android | 18 JVM tests and 5 API 31 instrumentation tests; no lint errors |
| Android native coverage | JaCoCo lines 93.69% (297/317), branches 70.54%, methods 95.96% |

Coverage scopes differ. Rust host coverage excludes mobile dispatch compilation;
Swift coverage measures shared models, lifecycle and receipt storage, not ActivityKit
or SwiftUI rendering. Native OS behavior is checked separately on simulators.

The implementation started with failing tests. Regression tests were added when
real OS runs exposed delayed state propagation after an awaited ActivityKit update
and after Android `notify()`. Accepted snapshots are now persisted and reconciled
with OS observations without treating accepted requests as proof of visible UI.

[GitHub Actions run 41884094921](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/41884094921)
passed both jobs at release commit `0e6b8aa`: Rust, TypeScript, Swift, package
verification, Android unit tests and lint.

Actual Tauri IPC tests also verify that ungranted mutation commands and calls from
remote web content are denied. The default plugin permission grants queries only.

## Mobile execution

- Android API 37: the full Tauri demo passed all 13 lifecycle checks through
  JavaScript → Rust → Kotlin. Notification denial and the real permission prompt
  were exercised. A download-progress notification was observed with the system
  `PROMOTED_ONGOING` flag. [Recorded report](../tests/android/results/api37-lifecycle.json).
- Android API 31: the final APK passed all 13 bridge lifecycle checks. Strict
  `fallback: 'none'` returned `UNSUPPORTED_FEATURE`; notification fallback rendered
  normally. Killing and relaunching the background app preserved the active handle.
  [Lifecycle report](../tests/android/results/api31-lifecycle.json),
  [strict fallback result](../tests/android/results/api31-strict-fallback.json).
- iOS 27.2 / iPhone 18 Pro simulator: the ActivityKit host and embedded widget
  passed start, duplicate start, update, restart recovery, immediate end and
  no-resurrection checks. The full Tauri simulator archive then passed all 13
  JavaScript → Rust → Swift lifecycle checks driven through the actual WebView.
  [Recorded report](../tests/ios/results/tauri-lifecycle.json).

Physical iPhone XS/iPhone 16/Galaxy Note10/Galaxy S23 tests have not been run.
iOS 16.1/16.2 and Android API 24 are minimum API/build paths; they are not represented
by a physical-device runtime test here. APNs, FCM and background job execution are
outside this release.

## Package checks

- Rust 1.90.0 `cargo check --locked` passes; the main test toolchain is 1.99.1.
- npm ESM exports and TypeScript declarations pass in a clean tarball consumer.
- `cargo publish --dry-run` builds the packaged crate successfully.
- A fresh extracted crate compiled in a separate iOS simulator consumer with
  Tauri default features disabled. This check exposed and fixed a missing
  iOS-only `wry` dependency. Cargo prepared its own Tauri Swift API; no workspace
  copies were used. [Package consumer evidence](../tests/ios/results/package-consumer.json).
- A separate Android consumer built the extracted crate into an AAR. Its normal
  debug build contained no JaCoCo instrumentation or runtime dependency and used
  no workspace native sources. [Package consumer evidence](../tests/android/results/package-consumer.json).
- Explicit package file lists exclude native build caches, local configuration and credentials.
- `npm audit` (including development dependencies): no reported vulnerabilities.
- Android lint's remaining `NewerVersionAvailable` suggestion concerns test-only
  Jackson pinned to match Tauri. It is not a vulnerability finding.
- `cargo audit`: no vulnerability entries; two informational advisories remain in
  Tauri's Linux GTK dependency tree: `proc-macro-error` is unmaintained
  ([RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)) and `glib`
  reports iterator unsoundness
  ([RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)). Neither
  dependency is selected for this plugin's iOS or Android builds. Linux has no
  implemented backend in this release.

## Registry release

Release tag: [`v0.1.0-alpha.1`](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/v0.1.0-alpha.1).

- [crates.io](https://crates.io/crates/tauri-plugin-live-activity/0.1.0-alpha.1):
  published on 2026-11-04. The registry index checksum matches the verified local
  archive: `5e8b202f1dca8d3a1a68037cf035eb6827ba5ab0555ec1529075dcafcacf4305`.
  A new consumer resolved the exact version from crates.io without a path override
  and passed `cargo check --target aarch64-apple-ios-sim`, including the Swift
  library build. [Registry consumer evidence](../tests/release/crates-io-consumer.json).
- npm publication was initiated with the `next` tag. It is awaiting npm's browser
  account-authentication step; registry installation has not yet been verified.

## Reproduce

```sh
npm ci
npm test
npm run typecheck
source tools/mobile-env.sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo llvm-cov --locked --summary-only --fail-under-lines 80
bash tests/ios/run-core.sh
cd tests/android
./gradlew :live-activity:testDebugUnitTest :live-activity:lintDebug
```

Run native checks on an available emulator with
`./gradlew :live-activity:connectedDebugAndroidTest` from `tests/android`.
The full demo provides an explicit **Run lifecycle test** button and saves a JSON
report. See [demo instructions](../examples/demo/README.md).
