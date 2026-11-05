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

## Follow-up requirements (2026-11-04)

Verify npm and Cargo packages together inside actual Tauri apps, audit supported
OS versions and native surfaces against vendor documentation, and add regression
tests for observed coverage gaps. Keep unimplemented desktop behavior explicit.
The demo becomes a small pet companion: Mochi's snack delivery and nap timer,
with a polished mobile layout and real native screenshots. Existing plugin APIs
and lifecycle checks remain available. Publish a new alpha only after the updated
implementation, package consumers and demo pass review and validation.

## Supported-version policy follow-up (2026-11-04)

Choose explicit OS support floors from native API availability, the pinned Tauri
toolchain, and observed runtime behavior. Distinguish the host app's build floor,
the first OS with a feature, and the versions actually exercised. Fill practical
boundary-test gaps before changing a support claim. Keep released alpha.2 archives
immutable; any production changes receive the next alpha version after review.
Desktop candidates must support the existing start/update/end/receipt contract;
a successful one-shot notification alone does not qualify as an activity backend.
