# Implementation and release checklist

- [x] Review existing research and official Tauri scaffold; establish alpha scope.
- [x] Document product, system design and shared bridge contracts.
- [x] Write failing Rust/JS/native tests and record the failures.
- [x] Implement and verify strict Rust boundary and desktop unsupported behavior.
- [x] Implement and verify JS client, packaging and demo host.
- [x] Implement and verify iOS backend and shared widget template.
- [x] Implement and verify Android backend and permissions/fallback.
- [x] Run native builds and emulator lifecycle tests; fix observed failures.
- [x] Review input handling, ACL, native lifecycle, dependencies and package contents.
- [x] Install packaged artifacts in a clean consumer and rerun relevant checks.
- [x] Attempt crates.io and npm alpha publication after validation.
- [x] Verify published versions and installations on npm and crates.io.

## Follow-up: platform coverage and Mochi demo

- [x] Run a real Tauri app using both published registry packages on iOS and Android.
- [x] Review OS capabilities against current Apple, Android and desktop documentation.
- [x] Add missing native regression tests and fix confirmed lifecycle/permission issues.
- [x] Verify unsupported desktop behavior on macOS, Windows and Linux.
- [x] Replace the download demo with snack delivery and a nap timer; test its state transitions.
- [x] Capture the app and native Live Activity/notification surfaces on simulators.
- [x] Review, run CI, package and publish the next validated alpha to both registries.
- [x] Verify the new published packages and update the README, badges and coverage evidence.

## Supported-version policy and boundary tests

- [x] Recheck native OS and pinned Tauri version floors against primary sources.
- [x] Complete paired alpha.2 registry consumers on iPhone, iPad and Android.
- [x] Exercise Android API 24, 26 and 33 boundaries; retain failed and limited observations.
- [x] Check older Apple deployment targets and available simulator runtimes.
- [x] Evaluate desktop update/removal/error semantics before selecting fallback scope.
- [x] Replace preliminary compatibility goals with a concrete support and validation policy.
- [x] Add a failing merged-APK regression and enforce the actual Android API 26 minimum.
- [ ] Review, run final CI and publish the corrected alpha.3 to both registries.
- [ ] Verify published alpha.3 artifacts in isolated consumers.

## Demo refinement and development-environment cleanup

- [x] Refine Mochi's face consistently in the app and custom iOS widget; rerun browser QA.
- [x] Capture and inspect the revised app and native widget on actual simulators.
- [ ] Finish tests and push the complete changes before removing development artifacts.
- [ ] Remove task-created Android/iOS test environments and build caches; report reclaimed disk space.
