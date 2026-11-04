# First alpha product requirements

Target: `0.1.0-alpha.1`, a community Tauri 2 plugin for local progress and timer activities.
The user authorized implementation, local/emulator tests, iterative review/fixes, and
registry publishing attempts after validation on 2026-11-04.

The first release implements iOS ActivityKit and Android notifications with explicit
fallback and API 36+ promotion checks. Desktop platforms report unsupported. APNs,
FCM, arbitrary custom layouts, background scheduling, and event subscriptions are
outside this alpha; callers reconcile with `list()`.

Acceptance: typed JS API; strict Rust validation; native start/update/end/list;
permission and capability queries; idempotent retries; stale updates rejected;
ended handles never resurrect; host widget integration; runnable demo; tests and
honest platform evidence. No claim that a successful request proves visible UI.

Publishing requires passing relevant tests, actual native builds, emulator lifecycle
evidence, independent review, package-content inspection, and consumer installation.
Use an alpha version and npm `next` tag. Physical-device and OEM limitations stay
explicit. Never publish a known-broken package to test credentials.
