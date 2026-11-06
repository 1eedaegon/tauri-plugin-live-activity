# Implementation and release plan (historical)

This is the plan written before the plugin had native sources or a demo app. It is kept
as a record and is not updated. The current release steps are in [Releases](releasing.md),
and what each release was tested on is in the [validation record](validation.md).

## Order of work

1. **Environment and compatibility spike**: install Xcode, the SDKs and the NDK, connect
   accounts and devices, and record OS versions. Check sharing Swift models, embedding the
   widget, Android notifications and promotion, and desktop update APIs.
2. **Contract design and tests**: write the models, capabilities, errors, permissions and
   serialization fixtures first. See the tests fail, then add the smallest
   implementation. Pin versions and the package manager. Input schema and fixture checks
   that need no SDK run alongside step 1.
3. **Mobile MVP**: start, update, end and list; the iOS widget template; Android ordinary
   notifications and the Live Updates branch; least-privilege permissions; a demo app.
4. **Desktop adapters**: apply the same contract on macOS, Windows and Linux. Report
   unsupported features through capabilities, and keep "it compiles" apart from "it works
   at runtime".
5. **Recovery and performance**: revoked permissions, process death, restarts, duplicate
   and out-of-order updates, memory and power use.
6. **Packaging, docs and release**: install the packages in a clean consumer app and check
   every claimed platform.

## Test scope

| Kind | Required scenarios |
| --- | --- |
| Unit | Payload limits, enum and time serialization, revision comparison, fallback choice, ID namespaces, error mapping |
| Integration | JS → Rust → Swift/Kotlin/desktop round trips, denied Tauri command permissions, native errors passed through |
| End to end | Start → update → end, what is actually shown, opening the app from a notification tap, no reappearance after the user removes it |
| Compatibility | Minimum OS branches, the newest OS, unsupported calls, blocked Android channels and refused promotion, missing desktop backends |
| Recovery | App in the background, suspended, killed and restarted; OS reboot; reconnecting event subscriptions; local mappings out of sync |
| Concurrency | Duplicate starts, conflicts at the same revision, out-of-order updates, update/end races, independent activities |
| Packaging | Files in the Cargo and npm packages, Swift and Kotlin sources and permissions, widget integration, no secrets |

Coverage of the plugin's own logic is measured against a target of 80% and recorded
separately for Rust, JavaScript and native code. Coverage numbers do not replace checks
of OS UI. A check that is hard to automate records the manual steps, the OS and model, the
build version and the actual result. Generated or external code left out of coverage is
listed with the reason.

Each test result records the date, app revision, OS and build, model, backend, permission
and channel state, requested and actual promotion, and how to reproduce it. Device
serials, certificates and tokens are never recorded. Besides the first four phones,
Windows and Linux GNOME/KDE test machines are needed. Simulators and emulators can cover
old API levels, but they do not replace checks on real OEM devices.

## Memory measurements

Compare, in one release build of the demo: without the plugin, idle, one activity, several
activities, and after repeated starts and ends. Measure the app's native memory and the
iOS extension process, not only the JavaScript heap. Use Xcode Instruments, the Android
Studio Profiler and each desktop's tools for the peak, the steady state and what is freed
after an end. Keep the whole app apart from what the plugin adds, and record the sample
payload, repetitions, update rate, OS and tool.

## Library release conditions

- Build and runtime tests pass on every claimed platform, and anything not verified is
  stated.
- Code and security review and the related tests are done. The permission and minimum OS
  notes match the actual package.
- The npm and crates.io names and publishing rights are confirmed; versions, the
  compatibility table and the changelog are written.
- `license` in Cargo.toml and package.json is `Apache-2.0 OR MIT`, and the full license
  texts are included.
- After a package dry run and a check of the file list, the packages install and build in
  a clean consumer app.
- Publishing uses CI secrets or trusted publishing; no token is committed.

Each release's [validation record](validation.md) states which of these were not met.

## Separate from app distribution

Publishing the plugin to the registries is separate from shipping a sample app to the App
Store or Google Play. A signed APK can be installed on test devices, but iOS signing,
TestFlight and App Review, and Play's per-account testing rules are not skipped because
local tests pass. Check the account rules again in the official sources listed in
[Permissions](permissions.md) just before distributing.

A macOS app needs the signing and notarization that fit how it ships. A Windows app needs
its installer, signing and activation checked, and a Linux app its package format and its
desktop ID and portal setup.
