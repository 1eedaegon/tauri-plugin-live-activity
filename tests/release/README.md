# Registry consumer checks

Release checks use the public npm and crates.io packages. A workspace build alone
does not verify that both published artifacts contain the files a Tauri app needs.

- `npm-consumer.json`: a new npm project, empty npm cache, exact package version,
  strict TypeScript consumer and mock IPC tests; downloaded archive and lockfile
  integrity checked against the release artifact.
- `crates-io-consumer.json`: a new Cargo project with an exact registry dependency,
  no `[patch]` or path dependency, iOS simulator compilation including Swift;
  registry index, downloaded archive and lockfile checksums compared.
- `crates-io-alpha2-consumer.json`: the released alpha.2 crate's exact registry
  dependency, iOS simulator compilation and artifact identity. This does not
  claim that the renamed npm package has been published or tested with it.

The initial release's native bridge reports are under `tests/ios/results` and
`tests/android/results`. Combined registry consumer reports are recorded separately
from local source tests: both JavaScript and Rust dependencies must resolve from
their public registries before starting the app.

For a combined consumer, configure the package names and exact same release version:

```sh
npm install --save-exact tauri-plugin-live-activity@0.1.0-alpha.2
```

```toml
[dependencies]
tauri-plugin-live-activity = "=0.1.0-alpha.2"
```

Register the plugin and capabilities as shown in the root README. On iOS, include
the shared attributes module from the downloaded crate in the host's Widget
Extension. Generate and build the host with the Tauri CLI, then run the demo's
lifecycle test through its WebView. Check the saved result, native OS surface,
resolved Cargo metadata and npm lockfile. A screenshot alone is not a lifecycle
test, and a mock IPC result is not evidence that ActivityKit or Android displayed
anything.
