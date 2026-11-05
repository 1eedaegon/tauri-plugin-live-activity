# 0.1.0-alpha.3 validation

Alpha.3 corrects the Android minimum to API 26 and refines the demo illustration.
Publication and final registry checks are pending. The preceding alpha.2 was
published on both registries and verified in paired Tauri consumers on iPhone,
iPad and Android. [Alpha.2 evidence](validation-alpha.2.md).

## Changes and regression evidence

The old minimum allowed an APK to install on API 24, where Tauri's Jackson
initialization crashed before the plugin could run. The library and demo now
require API 26. A regression reads the merged APK's actual minimum; it failed
against the published alpha.2 APK and passes against the corrected build. CI also
builds the instrumented APK and verifies this metadata.
[API 24 failure](../tests/android/results/registry-alpha2-api24-boundary.json),
[minimum-SDK guard](../tests/android/results/min-sdk26-guard.json).

Android's permission driver now uses Back after the OS dialog becomes visible.
The API 33 controller ignored the previous Escape key. Native test assertions
also account for the API 31 introduction of the immutability getter and API 26's
channel-importance behavior. Production notification lifecycle logic is unchanged.

Mochi's app and widget now share a single face silhouette with smaller ears and
simple eyes and nose. The revised widget passes iOS 16.1/16.2/17.0 availability
compilation. App and OS screenshots are captured from actual simulator/emulator
builds; browser QA screenshots use injected IPC and are labeled separately.

## Checks

| Scope | Result |
| --- | --- |
| JS request/API/demo tests | 83 passed; strict TypeScript checks passed |
| JS coverage | Request/API 100%; demo lines/functions 100%, branches 96.51% |
| Rust host | 12 tests and formatting checks passed |
| Browser UI | 14 checks; axe scans report 0 violations |
| Android unit/lint | 22 tests; no lint errors |
| Android coverage | Lines 93.20% (315/338), branches 71.33% (204/286); 80% line gate passed |
| API 26 native boundary | Eight tests passed, including real Tauri Invoke/Jackson calls |
| API 33 published alpha.2 app | 13 lifecycle and five permission-dialog checks passed |
| API 37 local alpha.3 app | 13 lifecycle checks passed |
| API 37 Back cancellation regression | Five real permission-dialog checks passed with published alpha.2 |
| Revised custom iOS widget | iOS 16.1, 16.2 and 17.0 compile-time availability passed |

The release CI checks Rust, TypeScript, Swift, Android unit/lint/manifest behavior,
and desktop unsupported contracts on Windows and Linux. Its final run and
published alpha.3 consumer reports will be recorded after completion.

[API 26 tests](../tests/android/results/native-api26-boundary.json),
[API 33 lifecycle](../tests/android/results/registry-alpha2-api33-lifecycle.json),
[API 33 permissions](../tests/android/results/permission-api33-registry-alpha2.json),
[API 37 alpha.3 lifecycle](../tests/android/results/mochi-alpha3-api37-lifecycle.json),
[API 37 Back regression](../tests/android/results/permission-api37-back-registry-alpha2.json),
[custom widget availability](../tests/ios/results/mochi-widget-availability.json).

The [Android coverage report](../tests/android/results/coverage-alpha3.json) was
recomputed from existing execution data against unchanged production Kotlin
sources; it is not presented as newly collected API 26/37 coverage. The separate
native runs verify those runtime boundaries.

## Support policy and remaining runtime checks

- iPhone: iOS 16.1+, with stale dates requiring 16.2; iPad: iPadOS 17+.
- Android: API 26+ with a compatible WebView. Live Update promotion is requested
  on eligible API 36+ systems and never inferred from the OS number alone.
- macOS, Windows and Linux: explicit unsupported activity backend. Their framework
  minima and possible notification APIs do not establish implemented support.

API 26's stock WebView 58 cannot parse Tauri's injected JavaScript. Eight native
checks pass, but the full WebView pipeline on that emulator remains unverified.
An APK extracted from the official API 33 image requires API 29 and cannot update
that provider; no unofficial WebView was installed. On this host, old Apple
runtimes have toolchain/host or archive-authentication constraints. Generic widget
compilation is not a substitute for running those OS versions.

The strict iOS 27.2 stale-transition probes remain failed observations and are
excluded from passing counts. Physical iPhone/iPad, Samsung One UI/Now Bar and
forwarded Watch/Mac/CarPlay surfaces remain unverified. APNs, FCM, background jobs
and interactive actions are outside this release.

[Version policy](compatibility.md), [OS coverage](platform-coverage.md),
[Android details](android-coverage.md), [iOS details](ios-coverage.md),
[desktop research](desktop-coverage.md).

## Reproduce

```sh
npm ci
npm test
npm run typecheck
npm run build:demo
source tools/mobile-env.sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo llvm-cov --locked --summary-only --fail-under-lines 80
bash tests/ios/run-core.sh
./tests/android/gradlew -p tests/android \
  :live-activity:testDebugUnitTest :live-activity:connectedDebugAndroidTest \
  :live-activity:lintDebug :live-activity:coverageVerification
```

Browser setup is in [the demo QA instructions](../examples/demo/design/README.md).
The Android minimum-SDK regression accepts an Android `aapt` executable and a
built APK: `node tests/android/verify-min-sdk.mjs <aapt> <apk>`.
