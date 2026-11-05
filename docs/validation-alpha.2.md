# 0.1.0-alpha.2 validation

Validated on 2026-11-04–05 (UTC). Alpha.2 is published as
`tauri-plugin-live-activity` on both npm and crates.io. Exact registry installs,
artifact checksums and paired native Tauri runtime checks passed.
[First release evidence](validation-alpha.1.md).

## Automated checks

| Layer | Result |
| --- | --- |
| Request schema | 52 tests; line/branch/function coverage 100% |
| TypeScript IPC API | 14 tests; line/branch/function coverage 100% |
| Demo scenario and lifecycle logic | 17 tests; lines/functions 100%, branches 96.51% |
| Demo browser behavior | 14 checks; representative axe WCAG A/AA scans report 0 violations |
| Rust | 12 tests; host lines 96.28%, functions 87.50%; clippy clean |
| Swift shared model/lifecycle/platform policy | 60 assertions; lines 98.17%, functions 96.15%, regions 95.31% |
| Android | 22 JVM tests and 8 native instrumentation tests on APIs 31, 36 and 37 |
| Android native coverage | Lines 93.79% (317/338), branches 73.08% (209/286); no lint errors |

These scopes differ. Browser tests inject IPC to check UI behavior; they do not
prove native delivery. Rust host coverage excludes mobile dispatch. Swift coverage
measures shared models, lifecycle, persistence and platform policy, not OS rendering.
The Android line threshold is 80%; branch coverage is reported separately.

[Release source CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/41894264762)
passed all four jobs at commit `b91266c`: Rust/TypeScript/Swift on macOS,
Android unit tests and lint, and desktop contracts on Windows and Linux.

## Actual Tauri apps

The released alpha.2 packages were installed together from npm and crates.io in
isolated Tauri consumers, without workspace plugin dependencies:

- iPhone and iPad / OS 27.2: each passed 13 lifecycle, 10 feature and one Unicode
  conflict regression check.
- Android APIs 31 and 37: each passed all 13 lifecycle checks. API 37 also passed
  five actual notification-permission dialog checks.

[iPhone lifecycle](../tests/ios/results/published-alpha2-iphone-lifecycle.json),
[iPhone features](../tests/ios/results/published-alpha2-iphone-features.json),
[iPhone Unicode regression](../tests/ios/results/published-alpha2-iphone-unicode.json),
[iPad lifecycle](../tests/ios/results/published-alpha2-ipad-lifecycle.json),
[iPad features](../tests/ios/results/published-alpha2-ipad-features.json),
[iPad Unicode regression](../tests/ios/results/published-alpha2-ipad-unicode.json).

The initial published npm and Cargo packages were installed together in isolated
Tauri apps, without a plugin path dependency or copied plugin implementation:

- iPhone / iOS 27.2: 13 lifecycle and 10 additional feature checks passed.
- iPad / iPadOS 27.2: the same 13 lifecycle and 10 feature checks passed.
- Android APIs 31, 36 and 37: all 13 JavaScript → Rust → Kotlin lifecycle checks passed.

The tests run through the actual WebView, Rust plugin and native OS backend.
The expanded iOS checks include timers, permission mapping, template enforcement,
and default/after dismissal. Registry sources and package integrity are recorded in
[the iOS consumer report](../tests/ios/results/published-alpha1-consumer.json) and
[the Android consumer report](../tests/android/results/registry-alpha1.json).
Those reports retain the original npm name and alpha.1 version; they are not
presented as alpha.2 registry verification.

The updated local alpha.2 app also passes the 13-check Android lifecycle suite on
APIs 31 and 37. Actual permission dialogs passed five checks on APIs 36 and 37:
fresh request, cancellation, retry and grant, first denial, and repeated denial.
[API 36](../tests/android/results/permission-api36-local.json),
[API 37](../tests/android/results/permission-api37-local.json).
A real swipe dismissed the API 37 promoted activity, and a late update returned
`NOT_FOUND`. [Dismissal result](../tests/android/results/mochi-api37-user-dismissal.json).

Before publication, an iPhone Tauri consumer also installed the renamed npm tarball
and a freshly extracted alpha.2 crate. It passed all 13 lifecycle checks, 10 feature
checks and the previously failing Unicode conflict check. Cargo prepared its own
Tauri Swift dependency; no workspace plugin implementation was used.
[Packaged consumer](../tests/ios/results/packaged-alpha2-consumer.json),
[lifecycle](../tests/ios/results/packaged-alpha2-lifecycle.json),
[features](../tests/ios/results/packaged-alpha2-features.json),
[Unicode regression](../tests/ios/results/packaged-alpha2-unicode.json).

## Further Android boundary audit

The later API 24 run reproduced a startup crash in Tauri/Jackson before any plugin
call. API 26 passed eight native tests, while its stock WebView 58 could not parse
Tauri JavaScript. API 33 passed 13 full app checks and five permission checks.
The manifest correction to minimum API 26 is part of alpha.3, not this published
alpha.2 archive. [Android boundary evidence](android-coverage.md).

## Defects found and fixed

- Swift's canonical Unicode equality accepted changed wire text at the same
  revision. A failing unit test and the published iOS package reproduced this;
  title/status equality now compares UTF-8 bytes.
- iPadOS 16.x was incorrectly treated like iPhone iOS 16.1. One support policy now
  gates capabilities, permissions and operations: iPhone 16.1+, iPad 17+, and no
  iOS app compatibility mode on Mac.
- Android cached a cancelled notification dialog as a denial. Ambiguous state is
  now `unknown` and can be explicitly retried; observed repeated denial leads to
  `settingsRequired`.
- Android promotion checks now include channel importance. An observed rejected
  promotion reports `nativeLiveActivity` in `degradedFeatures`.
- A successful demo mutation followed by a failed refresh could lose its handle
  when switching modes. Accepted receipts are retained before reconciliation.

Each behavioral fix was preceded by a failing regression. The updated native
implementations and desktop IPC changes received independent source review with
no unresolved HIGH or CRITICAL findings.

## Screenshots and OS coverage

The Mochi app and iOS widget were redesigned together. Screenshots under
`docs/images/mochi-*` come from the actual Tauri app, iOS Lock Screen/Dynamic Island,
and Android notification surfaces. The Android API 37 record contains the native
`PROMOTED_ONGOING` flag; API 31 is an ordinary notification fallback. API 36's
emulator did not allow promotion and correctly used the fallback.
[Android capture evidence](../tests/android/results/mochi-screenshots.json).
[iOS capture evidence](../tests/ios/results/mochi-screenshots.json).

[OS coverage](platform-coverage.md), [iOS details](ios-coverage.md), and
[Android details](android-coverage.md) distinguish implementation, compile checks,
unit coverage and runtime observations. Windows and Linux Tauri IPC tests passed
on their GitHub-hosted runners; macOS passed locally. Desktop backends remain
explicitly unsupported.

On the iOS 27.2 simulator, a strict `staleDate` probe did not observe an ActivityKit
`stale` transition within its 20-second window, either in the foreground or after
backgrounding. The failed observations are retained and excluded from passing
runtime counts. The plugin passes the requested date and preserves observed iOS
state; it does not invent a transition to make that test pass. Android can derive
content staleness from the snapshot deadline.

Physical devices, Samsung One UI/Now Bar, forwarded Apple Watch/Mac/CarPlay
presentations and iOS 16.1/16.2 runtimes have not been verified. Android API 24
was subsequently tested and failed before plugin initialization, as recorded above. APNs, FCM and background job scheduling are outside this release.

## Package checks

- The public npm alpha.2 package installs with an empty cache in a fresh consumer;
  strict NodeNext types and all 14 API tests pass. The registry metadata, downloaded
  archive and install lock match the release SHA-1
  `b91bf5e1a0d9cf4da3f0d355b044790fc980567a` and SHA-512 integrity.
  [Published npm consumer](../tests/release/npm-alpha2-registry.json).
- The renamed npm tarball installs in an isolated consumer and passes strict
  NodeNext type checking and all 14 API tests.
  [Package report](../tests/release/npm-alpha2-package.json).
- The final archives were regenerated from committed source `b91266c` after CI.
  Cargo packaging and publication dry run passed. The published Cargo alpha.2
  archive's SHA-256 is
  `157b238cc6d5f79de4c86b6c9219eac83689def958224c12be2e0f3cbf43e938`;
  the registry index, downloaded archive and isolated consumer lockfile agree.
  [Released Cargo consumer](../tests/release/crates-io-alpha2-consumer.json).
- Explicit package file lists exclude native build caches, screenshots, local
  configuration and credentials. npm contains the JS exports/types and documentation;
  Cargo contains the native code and generic widget template.
- Dependency versions are unchanged from the first release. Its npm audit was
  clean; Cargo's two informational Linux GTK advisories remain documented in
  [the first release report](validation-alpha.1.md).

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
./tests/android/gradlew -p tests/android \
  :live-activity:testDebugUnitTest :live-activity:connectedDebugAndroidTest \
  :live-activity:lintDebug :live-activity:coverageVerification
```

Browser setup and screenshots are described in
[the demo's QA instructions](../examples/demo/design/README.md). Mobile checks need
an available emulator and the configured native toolchain. The demo's explicit
**Run lifecycle test** button saves a JSON report in app-private storage.
