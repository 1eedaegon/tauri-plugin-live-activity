# 0.1.0-alpha.3 validation

Alpha.3 corrects the Android minimum to API 26 and refines the demo illustration.
Cargo and npm alpha.3 are published. The
[Actions release](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/41998975917)
passed packaging, registry checksum and npm `next` checks. Native consumer checks
used the frozen package contents described below. The preceding alpha.2 was
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

The [final CI run](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/41992055275)
passed all four jobs at source commit `ff075523`: Rust/TypeScript/Swift, Android
unit/lint/merged-manifest checks, and Windows/Linux desktop contracts.
[CI evidence](../tests/release/alpha3-ci.json).

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

## Release artifacts and actual Tauri consumers

The published Cargo archive, sparse index and consumer lock agree on SHA-256
`57804af6be71bce0b19b9a90943addb625b4793798137007615e93d092175866`.
Its recorded source is `ff075523`; exact registry iOS compilation passed.
[Cargo registry consumer](../tests/release/crates-io-alpha3-consumer.json).

The frozen npm tarball has SHA-1 `847cc81741678e0956cb9aa6ad22b570947a820e`.
It contains ten files; JavaScript and declaration files are byte-identical to the
public alpha.2 package. The README, version and native minimum are updated for
alpha.3. The Actions build uses official Node's zlib variant, so its gzip archive
has SHA-1 `d64ffd56d9a8377f26d9ea9cf496f00be1d67931`. The complete decompressed tar,
including all headers and ten files, is identical to the native-tested archive:
SHA-256 `75df380dbf0096c9264e5d68b83afd7e33ae1be2e4b050db82e21ff3fa6cd64a`.
The workflow verifies this content identity before publication, then verifies the
public gzip archive's own SHA-1/SHA-512 and dist-tag.
[Release evidence](../tests/release/alpha3-publish-ci.json),
[frozen artifacts](../tests/release/alpha3-artifacts.json),
[workflow details](releasing.md).

A fresh public npm install with an empty cache passed strict NodeNext types and
all 14 API tests. Its archive and lock match the CI release; every installed file
and the complete tar match the native-tested candidate.
[Public npm consumer](../tests/release/npm-alpha3-registry.json).

Actual isolated Tauri consumers installed that exact npm tarball alongside the
public Cargo alpha.3 crate. The iPhone passed 13 lifecycle, 10 feature and one
Unicode conflict check. Android API 37 passed 13 lifecycle checks, and the same
merged APK was rejected by API 24 because it requires API 26. Installed package,
frontend and application hashes are retained for later registry byte comparison.
[iPhone consumer](../tests/ios/results/packaged-alpha3-consumer.json),
[iPhone lifecycle](../tests/ios/results/packaged-alpha3-iphone-lifecycle.json),
[iPhone features](../tests/ios/results/packaged-alpha3-iphone-features.json),
[iPhone Unicode regression](../tests/ios/results/packaged-alpha3-iphone-unicode.json),
[Android consumer](../tests/android/results/packaged-alpha3-candidate.json).

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
