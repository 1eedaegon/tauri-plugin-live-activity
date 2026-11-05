# 0.1.0-alpha.4 validation

Alpha.4 adds registry discovery metadata and GitHub Actions publishing. Native
behavior and the JavaScript API are unchanged from alpha.3. Both packages are
published as `tauri-plugin-live-activity@0.1.0-alpha.4`.

## Release and package checks

- [CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/41998681808)
  passed all four jobs at `3086e475`: Rust/TypeScript/Swift, Android, Windows and
  Linux. Android was rerun after two upstream download failures; tests were not
  changed or bypassed. [CI evidence](../tests/release/alpha4-ci.json).
- [Tag-triggered publishing](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/42001553056)
  published npm and Cargo through trusted publishing and verified public hashes.
  [Release evidence](../tests/release/alpha4-publish-ci.json),
  [artifact manifest](../tests/release/alpha4-artifacts.json).
- A fresh npm installation with an empty cache passed strict NodeNext TypeScript
  and 14 API tests. Registry, downloaded archive and install lock agree. npm
  signatures and provenance passed verification and identify the release commit.
  [npm consumer](../tests/release/npm-alpha4-registry.json).
- Release guards passed 15 tests with 100% line, branch and function coverage.
  The existing 83 JavaScript request/API/demo tests also passed.

## Actual Tauri consumers

| Platform | Public-package verification |
| --- | --- |
| iPhone, iOS 27.2 | 13 lifecycle, 10 feature and one Unicode conflict test passed |
| Android API 37 | 13 WebView → Rust → Kotlin lifecycle checks passed |
| Android API 24 | Installing the final APK was rejected with `INSTALL_FAILED_OLDER_SDK`; merged minimum is API 26 |

Both hosts installed exact npm and crates.io alpha.4 dependencies without local
plugin overrides. The iOS app and widget target iOS 16.1; registry Swift sources
and generated Tauri API were checked. Android's generated Gradle project resolves
the published crate's Android sources. App/archive/frontend hashes and dependency
origins are recorded in the reports.

[iPhone consumer](../tests/ios/results/published-alpha4-consumer.json),
[iPhone lifecycle](../tests/ios/results/published-alpha4-iphone-lifecycle.json),
[iPhone features](../tests/ios/results/published-alpha4-iphone-features.json),
[iPhone Unicode regression](../tests/ios/results/published-alpha4-iphone-unicode.json),
[Android consumer](../tests/android/results/registry-alpha4-consumer.json),
[Android lifecycle](../tests/android/results/registry-alpha4-api37-lifecycle.json).

The full Cargo archive was compared with public alpha.3: 51 of 56 files are
identical; the five differences are package metadata, README and VCS provenance.
All four JavaScript/runtime declaration files are identical. Earlier OS-boundary,
iPad, permission, coverage and screenshot evidence remains in the
[alpha.3 validation](validation-alpha.3.md) and
[alpha.2 validation](validation-alpha.2.md).
[Source parity](../tests/ios/results/published-alpha4-source-parity.json).

## Support limits

The policy remains iPhone iOS 16.1+, iPadOS 17+, and Android API 26+ with a
compatible WebView. Live Update promotion is conditional on eligible API 36+
systems. macOS, Windows and Linux return explicit unsupported results.

API 26 native calls passed earlier, but its stock WebView cannot run the current
Tauri JavaScript. Old Apple runtime execution, physical devices, Samsung One UI,
and forwarded Watch/Mac/CarPlay surfaces remain unverified. Strict automatic
stale-transition probes remain excluded from passing counts. No new iPad or
visibility guarantees are claimed for this metadata release.

[Version policy](compatibility.md), [OS coverage](platform-coverage.md),
[Android coverage](android-coverage.md), [iOS coverage](ios-coverage.md),
[release instructions](releasing.md).

## Repository metadata and local cleanup

GitHub description, homepage and 13 topics are set. npm alpha.4 includes 12 search
keywords; crates.io has five keywords and three categories. Both npm `latest` and
`next` point to alpha.4. Public metadata readback is recorded separately from
search-engine indexing in [discovery evidence](../tests/release/discovery-alpha4.json).

After the native checks and evidence push, task-created Android AVDs/images,
iOS test apps/temporary hosts and workspace build artifacts were removed. Free
space increased from 16.62 to 72.96 GiB (56.34 GiB reclaimed). Tracked source,
screenshots, release archives and shared preexisting tools remain available.
[Cleanup evidence](../tests/release/cleanup-alpha4.json).
