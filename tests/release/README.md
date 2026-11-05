# Registry consumer checks

Release checks use the public npm and crates.io packages. A workspace build alone
does not verify that both published artifacts contain the files a Tauri app needs.

- [npm-consumer.json](npm-consumer.json): a new npm project, empty npm cache, exact package version,
  strict TypeScript consumer and mock IPC tests; downloaded archive and lockfile
  integrity checked against the release artifact.
- [crates-io-consumer.json](crates-io-consumer.json): a new Cargo project with an exact registry dependency,
  no `[patch]` or path dependency, iOS simulator compilation including Swift;
  registry index, downloaded archive and lockfile checksums compared.
- [npm-alpha2-registry.json](npm-alpha2-registry.json): the public renamed
  `tauri-plugin-live-activity@0.1.0-alpha.2` package, exact registry installation
  with an empty cache, strict NodeNext types and all 14 mock IPC tests. The `next`
  tag, downloaded tarball, registry metadata and install lock match the frozen
  release archive. This verifies the npm artifact, not native rendering.
- [npm-alpha2-package.json](npm-alpha2-package.json): the earlier local alpha.2
  tarball check. Its checksum differs from the final release after documentation
  changes; it is preserved as prepublication evidence.
- [crates-io-alpha2-consumer.json](crates-io-alpha2-consumer.json): the released
  alpha.2 crate's exact registry dependency, iOS simulator compilation and artifact
  identity. It links the subsequently completed paired iOS consumer. The separate
  npm report above records successful npm publication.
  Neither individual package report by itself proves the paired native runtime.
- [alpha3-ci.json](alpha3-ci.json): all four final CI jobs passed at the alpha.3
  source commit, including the merged Android minimum-SDK regression.
- [crates-io-alpha3-consumer.json](crates-io-alpha3-consumer.json): the published
  alpha.3 crate, exact registry resolution, archive/index/lockfile identity and
  iOS simulator compilation.
- [npm-alpha3-registry.json](npm-alpha3-registry.json): public alpha.3 installed
  with an empty cache, strict TypeScript and 14 API tests. The CI gzip archive
  matches the public registry; its complete tar and ten installed files match the
  earlier native-tested candidate despite different gzip compression.
- [alpha3-publish-ci.json](alpha3-publish-ci.json): successful trusted-publishing
  workflow, with existing Cargo skipped after checksum verification.
- Alpha.3 native consumers used the frozen npm release tarball with the public
  Cargo crate: [iPhone](../ios/results/packaged-alpha3-consumer.json) passed 24
  checks, and [Android](../android/results/packaged-alpha3-candidate.json) passed
  13 lifecycle checks plus API 24 installation rejection. These reports retain
  artifact hashes and do not claim an npm registry installation.

The initial release's native bridge reports are under `tests/ios/results` and
`tests/android/results`. Combined registry consumer reports are recorded separately
from local source tests: both JavaScript and Rust dependencies must resolve from
their public registries before starting the app.

For a combined consumer, configure the package names and exact same release version:

```sh
npm install --save-exact tauri-plugin-live-activity@0.1.0-alpha.4
```

```toml
[dependencies]
tauri-plugin-live-activity = "=0.1.0-alpha.4"
```

Register the plugin and capabilities as shown in the root README. On iOS, include
the shared attributes module from the downloaded crate in the host's Widget
Extension. Generate and build the host with the Tauri CLI, then run the demo's
lifecycle test through its WebView. Check the saved result, native OS surface,
resolved Cargo metadata and npm lockfile. A screenshot alone is not a lifecycle
test, and a mock IPC result is not evidence that ActivityKit or Android displayed
anything.

## Alpha.4

[CI](alpha4-ci.json), [trusted publication](alpha4-publish-ci.json),
[artifacts](alpha4-artifacts.json), [npm consumer](npm-alpha4-registry.json),
[iPhone consumer](../ios/results/published-alpha4-consumer.json),
[Android consumer](../android/results/registry-alpha4-consumer.json), and
[discovery metadata](discovery-alpha4.json) record the final metadata release.
Both native consumers installed the exact public npm/Cargo pair. Source parity
and the fresh native runs are separate evidence; neither substitutes for the other.

[Default npm tag verification](npm-default-tag-ci.json) records `latest` and `next`
on alpha.4. [Cleanup](cleanup-alpha4.json) records the post-validation disk recovery.
