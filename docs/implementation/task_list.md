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
- [x] Review and run final CI for alpha.3; publish and verify the Cargo release.
- [x] Verify the frozen npm alpha.3 tarball with public Cargo alpha.3 in actual iPhone and Android consumers.
- [x] Publish npm alpha.3 through trusted GitHub Actions and verify its public registry identity.

## Demo refinement and development-environment cleanup

- [x] Refine Mochi's face consistently in the app and custom iOS widget; rerun browser QA.
- [x] Capture and inspect the revised app and native widget on actual simulators.
- [x] Finish tests and push the complete changes before removing development artifacts.
- [ ] Remove task-created Android/iOS test environments and build caches; report reclaimed disk space.

## Automated registry releases

- [x] Research official npm/crates.io trusted publishing and existing Tauri workflows.
- [x] Add tested tag/version/CI/artifact guards and a release workflow.
- [x] Validate packaging without publishing, configure repository trust, and publish alpha.3 through Actions.
- [x] Verify public alpha.4 artifacts, native consumers and release runs before environment cleanup.

## Discovery

- [x] Add GitHub description, homepage and 13 relevant topics.
- [x] Publish npm keywords and Cargo keywords/categories in alpha.4; verify public metadata.
- [ ] Align npm's default version and package-level discovery metadata with alpha.4.
