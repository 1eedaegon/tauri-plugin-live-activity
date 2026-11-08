# Feature specification

What tauri-plugin-live-activity 0.4 promises, one requirement per row. Each ID is named by the tests that prove it, and
`tools/spec-coverage.sh` fails when a requirement has no test, a listed test does not exist or does not name it, or a
test names an ID this file lacks.

Levels: **unit** (Rust, `cargo test` on the host), **node** (`npm test`), **kotlin** (Gradle unit tests of the Android
library), **simulator** (`tests/ios/run.sh`: the demo app on an iOS Simulator), **build** (a build or check script).
Errors are the codes of the plugin's `Error { code, message }`, which JavaScript receives as `{ code, message }`.

On iOS the plugin has no Swift of its own: its Rust commands call the [`activitykit`](https://github.com/1eedaegon/activitykit-rs)
crate, whose Swift layer talks to ActivityKit, and the app's widget extension links activitykit's Swift products.
Android keeps the plugin's Kotlin backend. Desktop has no backend.

## The JavaScript API

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-JS-1 | Each function invokes its command of the `live-activity` plugin with the request under `input` (`kind` for `requestPermissions`), and resolves to what the command answers. | `startLayout(x)` → `plugin:live-activity\|start_layout` with `{ input: x }`. | the command's | all |
| TP-JS-2 | `writeImage(name, png)` sends the bytes of a `Uint8Array` or an `ArrayBuffer` as an array of numbers. | `ArrayBuffer` of 3 bytes → `png: [..3 numbers]`. | the command's | all |
| TP-JS-3 | `onAction(handler)` listens to `live-activity://action` and hands each payload to the handler; it resolves to the function that stops listening. | An event `{actionId: "pet"}` → handler gets it. | — | all |
| TP-JS-4 | `endLayout` takes final content: `LayoutEndInput` is `EndInput` with an optional `snapshot`. | `endLayout({id, policy, snapshot})` → sent as given. | the command's | all |
| TP-JS-5 | The types follow the contract of 0.4: `LayoutSnapshot` has an optional `timestamp`, `ActivityState` includes `pending`, `ErrorCode` includes `NOT_FOREGROUND`. | The declarations in `dist-js/types.d.ts`. | — | all |
| TP-JS-6 | The `layout` builders return plain node objects without undefined members, and `bind(key)` writes `{ bind }`. | `text('a', {style: undefined})` → `{type: 'text', value: 'a'}`. | — | all |

## The Rust API

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-RUST-1 | `app.live_activity()` has the methods of 0.3 with their names and blocking signatures; `end_layout` takes `LayoutEndInput`. Each blocks until the answer and must not be called on the main thread. | `start_layout(input)` → `Result<LayoutActivityRecord>`. | the command's | all |
| TP-RUST-2 | The layout types (`Node`, `Element`, `Style`, `Island`, `Bound`, `Bindable`, `Color`, `Value`, …) are activitykit's, re-exported under the same names with the same JSON; the request and record types are the plugin's, with `values` a `BTreeMap`. | A 0.3 request JSON reads into the same types and writes back the same. | — | all |
| TP-RUST-3 | `validate_request(command, json)` checks the six commands of contracts v1 and v2 without a native call; `LayoutStartInput::validate_update` and `validate_end` check an update or an end against its start. | `("end_layout", {id, policy, snapshot})` → `Ok`. | `INVALID_INPUT`, `PAYLOAD_TOO_LARGE` | all |
| TP-RUST-4 | An error of activitykit keeps its code; its message is activitykit's text, with the feature and iOS version of `UNSUPPORTED_FEATURE` and the scope of `SYSTEM_LIMIT`. | `SystemLimit { scope: App }` → `SYSTEM_LIMIT`, "the app's limit of Live Activities is reached". | every code | all |
| TP-RUST-5 | The activitykit dependency is one line of `Cargo.toml`, `activitykit = "0.1"` from crates.io, and the crate links no Swift package of its own (`build.rs` registers no iOS path); `cargo package` packages and verifies the crate. | — | — | all |

## The request contract

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-CONTRACT-1 | `contracts/request.schema.json` and `tests/fixtures/layout-requests.json` are the activitykit crate's files, byte for byte, at the version the plugin's `Cargo.lock` holds. `tools/sync-contract.mjs` copies them. | The crate's files from `cargo metadata` → equal. | — | all |
| TP-CONTRACT-2 | The Rust validator gives every layout fixture its verdict, code and weight: `valid`, `invalid`, the `updates` against their start, the `ends` against their start. | 1064 requests, 34 updates, 4 ends. | `INVALID_INPUT`, `PAYLOAD_TOO_LARGE` | all |
| TP-CONTRACT-3 | The reference validator `tools/validate-request.mjs` gives every fixture the same, with `validateLayoutUpdate` and `validateLayoutEnd`. | — | the same | all |
| TP-CONTRACT-4 | The Kotlin validator gives every fixture the same. | — | the same | Android |
| TP-CONTRACT-5 | Contract v1 (`start`, `update`, `end`) keeps its rules and its fixtures, `tests/fixtures/requests.json`, in Rust, JavaScript and Kotlin; the two versions do not take each other's requests. | A v2 start sent to `start` → error. | `INVALID_INPUT` | all |
| TP-CONTRACT-6 | A number read from JSON text keeps the value that was written. | `96.00000000000001` stays outside 6…96. | `INVALID_INPUT` | all |

## Layout activities on iOS

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-IOS-1 | `start_layout` checks the request, then starts an activity through activitykit with the key, layout, styles, values, revision, stale date and timestamp; the record has schema 2, the start's revision and values, the content's timestamp, backend `activityKit`, and activitykit's state and degraded features. `fallback` and `android` are checked and not sent. | A valid start at revision 5 → `{schemaVersion: 2, snapshot: {revision: 5, …}, state: "active"}`. | see TP-IOS-11 to TP-IOS-13 | iOS 16.2+ |
| TP-IOS-2 | While an activity of a key runs, the same start (layout, styles, values, revision and stale date, whatever its timestamp) returns it, also after a relaunch, and a different start under the key fails; after it ended the key starts a new activity. activitykit decides. | The same start twice, or after a relaunch → one activity; other values → error. | `CONFLICT` | iOS |
| TP-IOS-3 | `update_layout` finds the activity by its id through activitykit and sends the snapshot at the request's revision. activitykit's Swift layer takes a higher revision, answers the accepted one with the same content as done, and refuses a lower one, or the accepted one with other values. The record carries the request's revision, as in 0.3. | At revision 1: 0 → stale; 1 same → record; 1 other → conflict; 7 → record at 7. | `STALE_REVISION`, `CONFLICT`, `INVALID_INPUT` | iOS |
| TP-IOS-4 | An update or end of an id that activitykit does not know fails, and so does an update of an ended activity. | After an end → error. | `NOT_FOUND` | iOS |
| TP-IOS-5 | `end_layout` ends with the policy: `immediate`, `default` (the system keeps it up to four hours) or `after` a time (any time up to the largest; one in the past removes it at once). With a snapshot it ends with that final content at the snapshot's revision, checked as an update; without one with the last accepted values at the next revision. Ending again answers the record, also after an immediate end when the system no longer lists the activity, and a later update of it is `NOT_FOUND`. | `{policy: after, snapshot: {revision: 2, values}}` → ended at 2, those values; `immediate`, then `immediate` again → ended. | `STALE_REVISION`, `CONFLICT`, `INVALID_INPUT`, `NOT_FOUND` | iOS 16.2+ |
| TP-IOS-6 | `list_layout` gives every layout activity activitykit knows, ended ones still on screen included, with its accepted revision, values and timestamp; after a relaunch an update continues from the listed revision. Template activities (TP-V1) are left out. | Revision 1 before a relaunch → listed at 1; an update at 2 → 2. | — | iOS 16.2+ |
| TP-IOS-7 | A snapshot's `timestamp` goes to activitykit as the content's time, at a start, an update and an end; without one activitykit takes the time of sending. A record carries the timestamp of the accepted content. | `{timestamp: t}` → `Update::timestamp(t)`, record `timestamp: t`. | `INVALID_INPUT` above the largest time | iOS 17.2+ (ActivityKit) |
| TP-IOS-8 | A record's state is activitykit's: `pending`, `active`, `stale`, `ended`, `dismissed` or `unknown`. | — | — | iOS 16.2+ |
| TP-IOS-9 | `get_capabilities` reports activitykit's authorization: with Live Activities supported every feature but `actions` is `supported` and `actions` follows `buttons` (iOS 17); without them every feature is `unsupported` and the backend `unsupported`. `maxPayloadBytes` is 4096. | iPhone, iOS 26 → all supported. | — | iOS |
| TP-IOS-10 | `check_permissions` reports `liveActivities` as `granted` when enabled and `denied` otherwise, `notApplicable` when unsupported; `request_permissions("liveActivities")` reports `settingsRequired` instead of `denied`; another kind fails. `notifications` and `promotion` are `notApplicable`. | Disabled, requested → `settingsRequired`. | `UNSUPPORTED_FEATURE` | iOS |
| TP-IOS-11 | A request that breaks the contract fails before anything reaches activitykit. | A node names a missing style → error, no call. | `INVALID_INPUT`, `PAYLOAD_TOO_LARGE` | iOS |
| TP-IOS-12 | activitykit's errors reach JavaScript with their codes, `NOT_FOREGROUND` for a start that ActivityKit refuses outside the foreground among them. | A start in the background → `NOT_FOREGROUND`. | `UNSUPPORTED_PLATFORM`, `PERMISSION_DENIED`, `NOT_FOREGROUND`, `CONFIGURATION_REQUIRED`, `SYSTEM_LIMIT`, `UNSUPPORTED_FEATURE`, `NATIVE_ERROR` | iOS |
| TP-IOS-13 | With `receipts: "redacted"` in the plugin configuration the plugin builds activitykit's kit with redacted receipts, which keep a digest instead of the values: starts, updates and ends work, and after a relaunch a list gives the values that ActivityKit shows. A kit that already runs in the process with other settings makes the plugin's setup fail. | Redacted → `Receipts::Redacted`; absent or `full` → `Receipts::Full`. | setup error (`CONFLICT`) | iOS |
| TP-IOS-14 | `write_image` checks the PNG, then activitykit writes it to `activitykit/images` in the App Group that the widget extension names under `ActivityKitAppGroup`. | A valid PNG → written. | `INVALID_INPUT`, `PAYLOAD_TOO_LARGE`, `CONFIGURATION_REQUIRED`, `NATIVE_ERROR` | iOS |
| TP-IOS-15 | Live Activities need iOS 16.2 on an iPhone, iPadOS 17 on an iPad; below that every command but the reads fails. | — | `UNSUPPORTED_PLATFORM` | iOS |

## The progress and timer templates (contract v1) on iOS

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-V1-1 | `start` turns a template request into a layout activity: a fixed tree of title, status and a progress bar or a timer, on the Lock Screen and in the Dynamic Island, with the snapshot's fields as values and a value that marks the template. The record is a v1 record of that template. | `progress` 0.3 → a record `{schemaVersion: 1, template: "progress", snapshot: {progress: 0.3, …}}`. | as TP-IOS-1 | iOS 16.2+ |
| TP-V1-2 | `update`, `end` and `list` work on template activities as their layout counterparts do on layouts, with the same revision rules; an update with the other template's fields fails. | A progress activity updated with a timer → error. | `INVALID_INPUT`, `STALE_REVISION`, `CONFLICT`, `NOT_FOUND` | iOS |
| TP-V1-3 | The two contract versions do not see each other's activities: `list` gives template activities only and `list_layout` layout activities only, and an id of one version is not found by the other's commands. | A layout id sent to `update` → error. | `NOT_FOUND` | iOS |
| TP-V1-4 | The largest template snapshot (120 and 240 code points of four bytes each) fits the contract's weight with its layout. | → valid. | — | all |

## Button taps

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-ACTION-1 | A tap on a button node reaches every `on_action` handler and then JavaScript as `live-activity://action` with `actionId`, `activityId` and the `activityKey` when known. | A tap on `pet` → handlers, then the event. | — | iOS 17+, Android |
| TP-ACTION-2 | Handlers run on a thread of the plugin, never the main thread, one tap after another, so a handler may call the plugin; a handler that panics does not stop the next taps; taps before the first handler wait for it, the newest 16. | — | — | iOS, Android |
| TP-ACTION-3 | A tap waits for the Rust handlers. On iOS the taps come from activitykit's events, which the plugin reads from its start; the plugin keeps the tap's acknowledgement until its `on_action` handlers have run and the event has gone to JavaScript, so the tap's intent, and an app the system launched for it, wait for them, at most 4 s (activitykit). On Android the native side waits the same way, at most 4 s. JavaScript listeners are not awaited: a webview handler is asynchronous. | A handler that takes 1 s → the tap is released after it. | — | iOS 17+, Android |

## Setup

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-SETUP-1 | Setup finds the activitykit crate's folder with `cargo metadata` (the plugin's dependency), and fails with a message when the plugin or activitykit is not in the app's build. | No activitykit package → error naming it. | a message, exit 1 | Mac |
| TP-SETUP-2 | On an app without the widget, setup writes `live-activity.yml`: activitykit's `swift` package, the widget extension (iOS 16.2) linking `ActivityKitWidget` and `ActivityKitViews` with `ActivityKitLayout` = 2 in its Info.plist, and the app target linking `ActivityKitIntent` and `ActivityKitViews` and compiling the custom views file; it copies activitykit's widget template as `LiveActivityWidget.swift`, creates `LiveActivityCustomViews.swift` once, includes the spec in `project.yml` and runs XcodeGen. | A fresh app → those files and one XcodeGen run. | — | Mac |
| TP-SETUP-3 | On an app that 0.2 or 0.3 set up, setup removes the plugin's old template copies (`LiveActivityActionIntent.swift`, `LiveActivityCustomRegistry.swift`) and replaces the old `LiveActivityWidget.swift` when each is as a release wrote it, and keeps a changed one with a step to do. | A 0.3 app → removed, replaced; an edited widget → kept, to do. | — | Mac |
| TP-SETUP-4 | It renames the activitykit names into the app's `LiveActivityCustomViews.swift` (the class, the registry, the view and props types, the Objective-C name, `import ActivityKitViews`) and keeps the app's views. | A 0.3 file with a view → the same view under activitykit's names. | — | Mac |
| TP-SETUP-5 | It writes the extension's Info.plist keys under activitykit's names: `ActivityKitLayout` instead of `TauriLiveActivityLayout`, `ActivityKitAppGroup` instead of `TauriLiveActivityAppGroup`, and keeps the App Group of a 0.3 spec. | A 0.3 spec with a group → the same group under the new key. | — | Mac |
| TP-SETUP-6 | A second run changes nothing and runs no XcodeGen; a dry run writes nothing. | Twice → every step unchanged. | — | Mac |
| TP-SETUP-7 | Setup keeps the steps of 0.3 that do not concern ActivityKit: the capability's permissions, Android's minimum API 26, `NSSupportsLiveActivities`, fonts, assets and the App Group, a spec changed by hand, an existing widget of the app's own, and the notes. | — | — | all |

## Android

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-ANDROID-1 | A layout snapshot takes a `timestamp`, which the record carries back. | A start with `timestamp: t` → the record's snapshot has `t`. | `INVALID_INPUT` out of range | Android |
| TP-ANDROID-2 | `end_layout` with final content checks it against the start as an update, and the activity ends with it: the returned and the stored record carry it. Android cancels the notification at the end (`immediate`, `default`; `after` stays `UNSUPPORTED_FEATURE`), and a dismissed activity keeps its last snapshot. | A stale final revision → error; a valid one → the record has the final values. | `STALE_REVISION`, `CONFLICT`, `INVALID_INPUT` | Android |
| TP-ANDROID-3 | Rust hands Android the request it validated, and Android's records read back into the plugin's types. | A Kotlin record JSON → `LayoutActivityRecord`. | `NATIVE_ERROR` for a malformed reply | Android |

## Desktop, permissions and configuration

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-DESKTOP-1 | On desktop `get_capabilities` and `check_permissions` answer `unsupported` and `notApplicable`; every other command checks its request and then fails; `on_action` drops its handler. | A valid start → error; an invalid one → `INVALID_INPUT`. | `UNSUPPORTED_PLATFORM`, `INVALID_INPUT` | desktop |
| TP-PERM-1 | Each command has `allow-` and `deny-` permissions; `default` allows only the reads: capabilities, permissions, `list` and `list_layout`. | — | Tauri's refusal | all |
| TP-CONFIG-1 | `plugins.live-activity` is optional and strict: `receipts` (`full` or `redacted`) and `android.samsungNowBar`; an unknown key or a wrong type fails the plugin's setup. | `{"android":{"samsungNowbar":true}}` → error. | setup error | all |

## End to end

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-E2E-1 | In the demo app on an iOS Simulator: a layout starts and an update turns its bound color, which the Lock Screen shows. | — | — | simulator |
| TP-E2E-2 | A tap on a layout button on the Lock Screen reaches Rust, whose handler updates the activity, and JavaScript, which shows the tap. | — | — | simulator |
| TP-E2E-3 | After the app is ended and launched again, `listLayout` gives the running activity, and the page ends it. | — | — | simulator |
| TP-E2E-4 | The demo's lifecycle test passes through Tauri on iOS: template starts, duplicate starts, newer, identical, stale and conflicting revisions, the list, ends and old handles. | — | — | simulator |
| TP-E2E-5 | A tap on the Lock Screen while the demo app is not running launches it in the background, and its Rust handler, which takes 1 s, updates the activity. | — | — | simulator |
| TP-E2E-6 | A debug build that `tauri ios dev` makes, runs and serves on a simulator works as the build of `tauri ios build`: the widget draws on the Lock Screen what the page starts and sends, a button there reaches Rust and the page, a relaunch lists the activity, and a layout that Rust starts shows and takes taps. | Changing styles → "Running 5 min late"; Buttons → Pet → "Purring. 1 pet so far" and the tap in JavaScript; `--start-buttons` → the Buttons example. | — | simulator |

## Build and CI

| ID | Behavior | Input → result | Errors | Platform |
| --- | --- | --- | --- | --- |
| TP-BUILD-1 | The plugin's iOS code checks for the device and the simulator with activitykit's Swift build skipped (`ACTIVITYKIT_SKIP_SWIFT=1`), and the demo builds and links for the simulator. | `cargo clippy --target x86_64-apple-ios` → passes. | — | Mac |
| TP-CI-1 | CI's `changes` job starts each job for its paths: the macOS job also for `Cargo.lock`, `Cargo.toml`, the Rust sources, the setup and the iOS tests; the specification check for any change. | A change to `Cargo.lock` alone → the macOS job. | — | CI |
| TP-CI-2 | `tools/spec-coverage.sh` checks this file against the tests. | — | — | all |
| TP-CI-3 | CI caches what it can: the Rust builds (`Swatinem/rust-cache`), cargo-llvm-cov as a binary (`taiki-e/install-action`), and the macOS job's iOS build products under a key of their inputs and the Xcode version, which an exact hit reuses with `test-without-building`. A passed simulator suite is remembered under its inputs, the runner image and the Xcode version, and the same inputs skip it while the job stays green. The simulator destination names its architecture. | The merge commit of a tested pull request → the suite is skipped. | — | CI |

## Not proven by a test

- TP-IOS-2, TP-IOS-13: a repeated start after a relaunch, and redacted receipts, are activitykit's; its own tests
  drive them on a simulator, and the plugin's unit tests check what the plugin sends and builds.
- TP-IOS-5: a repeated end reaches activitykit's record of the ended activity through a handle that the plugin keeps
  for this launch (the last 64 ended). After a relaunch, an activity that ended at once and that the system no longer
  lists is `NOT_FOUND`, because activitykit 0.1 finds an id only through a live handle or the system's list.
- TP-IOS-7: ActivityKit uses a content's timestamp from iOS 17.2; the simulator runs iOS 26, where only the request
  that activitykit receives is checked (by the unit tests).
- TP-IOS-12, TP-IOS-15: `NOT_FOREGROUND`, `SYSTEM_LIMIT` and an old iOS come from ActivityKit; the unit tests map each
  activitykit error, and activitykit's own simulator tests drive `NOT_FOREGROUND`.
- TP-ACTION-3, TP-E2E-5: when the tap's intent returns is activitykit's, and the simulator does not show it. The unit
  test proves that the plugin releases the tap only after a 1 s handler and the event; on the simulator a tap that
  launches the app in the background shows the update of a 1 s handler.
- TP-E2E-6: `tests/ios/run.sh` runs `tauri ios dev` with connected iPhones hidden from it, and answers Tauri's
  archive step with the simulator build, which on an Intel Mac would otherwise need a signing team (Tauri CLI 2.12.4).
  The debug build, its install and launch, and the server of the page are Tauri's. `tauri ios dev` runs with its
  watcher: with `--no-watch` it ends once it has launched the app, and the server of the page ends with it.
- TP-ANDROID-1, TP-ANDROID-2: on an emulator or a phone; the Kotlin unit tests run them on the JVM.

## Tests

| Requirement | Tests |
| --- | --- |
| TP-JS-1 | `tests/api.test.mjs::keeps the caller-owned layout request, its tree and its values unchanged` (node)<br>`tests/api.test.mjs::sends every valid layout fixture to its command unchanged` (node) |
| TP-JS-2 | `tests/api.test.mjs::writeImage sends the name and the bytes of a Uint8Array or an ArrayBuffer` (node) |
| TP-JS-3 | `tests/api.test.mjs::onAction hands each action payload, and nothing else, to its handler until that handler is unsubscribed` (node) |
| TP-JS-4 | `tests/api.test.mjs::endLayout sends the final content of an end unchanged` (node) |
| TP-JS-5 | `tests/api.test.mjs::the declarations follow the contract of 0.4` (node) |
| TP-JS-6 | `tests/api.test.mjs::layout.bind writes the binding of a style member and nothing else` (node)<br>`tests/api.test.mjs::layout builders omit options that were not given or are undefined` (node) |
| TP-RUST-1 | `src/apple/tests.rs::block_on_drives_a_future_that_another_thread_completes` (unit)<br>`tests/contract.rs::the_changing_styles_example_binds_a_color_that_an_update_changes` (unit) |
| TP-RUST-2 | `src/layout.rs::a_request_reads_into_the_plugins_types_and_writes_back_the_same_json` (unit)<br>`src/layout.rs::parse_is_activitykits_strict_check_and_the_types_validate_the_same` (unit)<br>`tests/contract.rs::layout_fixtures_keep_their_verdict_and_weight_through_the_typed_models` (unit) |
| TP-RUST-3 | `src/layout.rs::parse_is_activitykits_strict_check_and_the_types_validate_the_same` (unit)<br>`tests/contract.rs::layout_fixtures_match_reference_validator` (unit)<br>`tests/contract.rs::layout_update_fixtures_match_the_check_against_the_start` (unit)<br>`tests/contract.rs::layout_end_fixtures_match_the_check_against_the_start` (unit)<br>`tests/contract.rs::layout_commands_do_not_mix_with_contract_v1` (unit) |
| TP-RUST-4 | `src/error.rs::activitykit_errors_keep_their_codes_and_their_details` (unit) |
| TP-RUST-5 | `tests/ci.test.mjs::activitykit is one line of Cargo.toml and the crate builds no Swift of its own` (node) |
| TP-CONTRACT-1 | `tests/contract-sync.test.mjs::the schema and the fixtures are activitykit's, byte for byte` (node) |
| TP-CONTRACT-2 | `tests/contract.rs::layout_fixtures_match_reference_validator` (unit)<br>`tests/contract.rs::layout_update_fixtures_match_the_check_against_the_start` (unit)<br>`tests/contract.rs::layout_end_fixtures_match_the_check_against_the_start` (unit)<br>`tests/contract.rs::layout_fixtures_keep_their_verdict_and_weight_through_the_typed_models` (unit)<br>`tests/contract.rs::layout_weight_limit_is_a_payload_error_only_for_an_otherwise_valid_request` (unit) |
| TP-CONTRACT-3 | `tests/layout-requests.test.mjs::fixture names are unique and every start and update states its weight` (node)<br>`tests/layout-requests.test.mjs::every end fixture is checked against its start` (node) |
| TP-CONTRACT-4 | `android/src/test/java/io/github/eedaegon/liveactivity/LayoutFixtureTest.kt::everyValidCaseIsAcceptedWithItsWeight` (kotlin)<br>`android/src/test/java/io/github/eedaegon/liveactivity/LayoutFixtureTest.kt::everyInvalidCaseFailsWithItsCode` (kotlin)<br>`android/src/test/java/io/github/eedaegon/liveactivity/LayoutFixtureTest.kt::everyUpdateCaseMeetsTheStoredLayoutAsExpected` (kotlin)<br>`android/src/test/java/io/github/eedaegon/liveactivity/LayoutFixtureTest.kt::everyEndCaseMeetsTheStoredLayoutAsExpected` (kotlin)<br>`android/src/test/java/io/github/eedaegon/liveactivity/LayoutFixtureTest.kt::everyValidStartUpdateAndFinalContentStatesAWeight` (kotlin) |
| TP-CONTRACT-5 | `tests/contract.rs::shared_contract_fixtures_match_reference_validator` (unit)<br>`tests/contract.rs::rejects_boundary_and_type_errors_without_echoing_values` (unit)<br>`tests/contract.rs::layout_commands_do_not_mix_with_contract_v1` (unit)<br>`tests/requests.test.mjs::accepts safe integer and Unicode length boundaries without changing input` (node)<br>`tests/requests.test.mjs::error results survive a later validation and do not echo input values` (node)<br>`android/src/test/java/io/github/eedaegon/liveactivity/InputTest.kt::matchesTheSharedRequestFixtures` (kotlin) |
| TP-CONTRACT-6 | `tests/contract.rs::layout_numbers_keep_their_value_when_read_from_json_text` (unit) |
| TP-IOS-1 | `src/apple/tests.rs::a_layout_start_goes_to_activitykit_and_answers_a_v2_record` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test1BoundStyleShowsOnTheLockScreen` (simulator) |
| TP-IOS-2 | `src/apple/tests.rs::the_same_start_returns_the_running_activity_also_after_a_relaunch` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test4LifecycleChecksPassThroughTauri` (simulator) |
| TP-IOS-3 | `src/apple/tests.rs::an_update_goes_out_at_the_requests_revision_under_activitykits_rules` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test1BoundStyleShowsOnTheLockScreen` (simulator)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test4LifecycleChecksPassThroughTauri` (simulator) |
| TP-IOS-4 | `src/apple/tests.rs::an_unknown_or_ended_activity_is_not_found_and_a_relaunch_finds_it_by_its_id` (unit) |
| TP-IOS-5 | `src/apple/tests.rs::an_end_sends_its_policy_and_its_final_content_at_its_revision_and_ending_again_answers` (unit)<br>`src/apple/tests.rs::an_activity_that_ended_at_once_answers_a_second_end_after_the_system_drops_it` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test4LifecycleChecksPassThroughTauri` (simulator) |
| TP-IOS-6 | `src/apple/tests.rs::an_unknown_or_ended_activity_is_not_found_and_a_relaunch_finds_it_by_its_id` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test3ListAfterARelaunchFindsTheActivity` (simulator) |
| TP-IOS-7 | `src/apple/tests.rs::an_update_goes_out_at_the_requests_revision_under_activitykits_rules` (unit)<br>`src/apple/tests.rs::a_layout_start_goes_to_activitykit_and_answers_a_v2_record` (unit) |
| TP-IOS-8 | `src/apple/tests.rs::a_layout_start_goes_to_activitykit_and_answers_a_v2_record` (unit)<br>`src/bridge.rs::an_android_layout_record_reads_into_the_plugins_record` (unit) |
| TP-IOS-9 | `src/apple/tests.rs::capabilities_and_permissions_follow_activitykits_authorization` (unit) |
| TP-IOS-10 | `src/apple/tests.rs::capabilities_and_permissions_follow_activitykits_authorization` (unit) |
| TP-IOS-11 | `src/apple/tests.rs::a_broken_request_never_reaches_activitykit_and_activitykit_errors_keep_their_codes` (unit)<br>`src/command_tests.rs::command_boundaries_reject_invalid_requests_before_dispatch` (unit) |
| TP-IOS-12 | `src/apple/tests.rs::a_broken_request_never_reaches_activitykit_and_activitykit_errors_keep_their_codes` (unit)<br>`src/error.rs::activitykit_errors_keep_their_codes_and_their_details` (unit) |
| TP-IOS-13 | `src/apple/tests.rs::redacted_receipts_in_the_configuration_build_the_kit_with_redacted_receipts` (unit) |
| TP-IOS-14 | `src/apple/tests.rs::an_image_is_checked_and_then_written_by_activitykit` (unit) |
| TP-IOS-15 | `src/apple/tests.rs::capabilities_and_permissions_follow_activitykits_authorization` (unit) |
| TP-V1-1 | `src/apple/template.rs::a_template_start_becomes_a_layout_start_with_the_fields_as_values` (unit)<br>`src/apple/template.rs::the_values_read_back_as_the_template_snapshot` (unit)<br>`src/apple/tests.rs::a_template_activity_starts_updates_ends_and_lists_as_contract_v1` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test5TemplatesShowOnTheLockScreenAsLayouts` (simulator) |
| TP-V1-2 | `src/apple/template.rs::the_values_read_back_as_the_template_snapshot` (unit)<br>`src/apple/tests.rs::a_template_activity_starts_updates_ends_and_lists_as_contract_v1` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test4LifecycleChecksPassThroughTauri` (simulator) |
| TP-V1-3 | `src/apple/tests.rs::the_two_contract_versions_do_not_see_each_others_activities` (unit) |
| TP-V1-4 | `src/apple/template.rs::the_largest_template_snapshot_fits_the_weight_with_its_layout` (unit) |
| TP-ACTION-1 | `src/actions.rs::every_handler_sees_a_tap_before_it_is_emitted` (unit)<br>`src/actions.rs::a_tap_from_activitykit_reaches_the_handlers_and_then_the_event_and_is_released_after_them` (unit)<br>`src/actions.rs::the_channel_is_registered_on_the_calling_thread_and_carries_taps` (unit)<br>`src/apple/tests.rs::a_tap_names_the_action_the_activity_and_its_key` (unit)<br>`src/command_tests.rs::taps_reach_tauri_listeners_as_the_action_event` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test2LockScreenButtonReachesRustAndJavaScript` (simulator) |
| TP-ACTION-2 | `src/actions.rs::every_handler_sees_a_tap_before_it_is_emitted` (unit)<br>`src/actions.rs::a_panicking_handler_does_not_stop_delivery` (unit)<br>`src/actions.rs::taps_before_the_first_handler_wait_for_it` (unit)<br>`src/actions.rs::a_handler_may_register_another_handler` (unit) |
| TP-ACTION-3 | `src/actions.rs::a_tap_is_accepted_once_its_handlers_have_run` (unit)<br>`src/actions.rs::the_wait_for_a_handler_is_bounded` (unit)<br>`src/actions.rs::a_tap_from_activitykit_reaches_the_handlers_and_then_the_event_and_is_released_after_them` (unit)<br>`src/actions.rs::a_tap_waits_for_a_rust_handler_that_takes_a_second` (unit)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test6TapLaunchesTheAppForASlowRustHandler` (simulator) |
| TP-SETUP-1 | `tests/setup.test.mjs::finds activitykit through the plugin, and fails with a message without it` (node) |
| TP-SETUP-2 | `tests/setup.test.mjs::sets up a fresh Tauri 2 app: capabilities, Android minimum, widget files, XcodeGen spec` (node)<br>`examples/demo/tests/setup.test.mjs::the demo widget is activitykit's widget template, and the project names activitykit's package` (node)<br>`examples/demo/tests/setup.test.mjs::the widget extension links ActivityKitWidget and declares layout support, the app links the intent` (node) |
| TP-SETUP-3 | `tests/setup.test.mjs::migrates an app that 0.3 set up to activitykit, and a second run changes nothing` (node)<br>`tests/setup.test.mjs::keeps old files that were changed by hand, as steps to do, and a dry run of a migration writes nothing` (node)<br>`tests/setup.test.mjs::keeps a widget file that differs from the template, and says how to take the template` (node) |
| TP-SETUP-4 | `tests/setup.test.mjs::migrates an app that 0.3 set up to activitykit, and a second run changes nothing` (node)<br>`tests/setup.test.mjs::creates LiveActivityCustomViews.swift once and never writes it again` (node) |
| TP-SETUP-5 | `tests/setup.test.mjs::migrates an app that 0.3 set up to activitykit, and a second run changes nothing` (node) |
| TP-SETUP-6 | `tests/setup.test.mjs::a second run changes nothing and does not run XcodeGen again` (node)<br>`tests/setup.test.mjs::a dry run writes nothing and reports what it would do` (node)<br>`tests/setup.test.mjs::migrates an app that 0.3 set up to activitykit, and a second run changes nothing` (node)<br>`tests/setup.test.mjs::keeps old files that were changed by hand, as steps to do, and a dry run of a migration writes nothing` (node) |
| TP-SETUP-7 | `tests/setup.test.mjs::sets up a fresh Tauri 2 app: capabilities, Android minimum, widget files, XcodeGen spec` (node)<br>`tests/setup.test.mjs::rewrites the spec it wrote after an activitykit update, and keeps a spec the user edited` (node)<br>`tests/setup.test.mjs::--app-group gives the app and the widget an App Group in the spec, and later runs keep it` (node) |
| TP-ANDROID-1 | `android/src/test/java/io/github/eedaegon/liveactivity/LayoutLifecycleTest.kt::aSnapshotTimestampIsKeptAtStartUpdateAndEndAndWrittenBack` (kotlin) |
| TP-ANDROID-2 | `android/src/test/java/io/github/eedaegon/liveactivity/LayoutLifecycleTest.kt::anEndWithFinalContentIsCheckedAsAnUpdateAndKeptInTheRecords` (kotlin) |
| TP-ANDROID-3 | `src/bridge.rs::an_android_layout_record_reads_into_the_plugins_record` (unit)<br>`src/bridge.rs::unwraps_success_and_preserves_stable_native_errors` (unit)<br>`src/bridge.rs::malformed_native_replies_fail_closed` (unit) |
| TP-DESKTOP-1 | `src/command_tests.rs::desktop_queries_report_unavailable_and_mutations_fail_explicitly` (unit)<br>`src/command_tests.rs::desktop_layout_commands_validate_before_they_fail_explicitly` (unit)<br>`src/command_tests.rs::write_image_checks_the_png_then_reports_that_desktop_has_no_widget` (unit)<br>`src/desktop_ipc_tests.rs::granted_desktop_ipc_returns_structured_unsupported_errors` (unit)<br>`tests/contract.rs::the_changing_styles_example_binds_a_color_that_an_update_changes` (unit) |
| TP-PERM-1 | `src/desktop_ipc_tests.rs::layout_commands_need_their_own_grants` (unit)<br>`src/desktop_ipc_tests.rs::default_permission_grants_only_the_read_commands` (unit)<br>`src/command_tests.rs::ipc_denies_ungranted_mutations_and_remote_content` (unit) |
| TP-CONFIG-1 | `src/config.rs::the_android_options_are_optional_and_strict` (unit)<br>`src/command_tests.rs::plugin_accepts_an_absent_null_or_redacted_configuration` (unit) |
| TP-E2E-1 | `tests/ios/DemoUITests/UITests/DemoTests.swift::test1BoundStyleShowsOnTheLockScreen` (simulator)<br>`tests/ios/run.sh::run.sh` (build) |
| TP-E2E-2 | `tests/ios/DemoUITests/UITests/DemoTests.swift::test2LockScreenButtonReachesRustAndJavaScript` (simulator)<br>`tests/ios/run.sh::run.sh` (build) |
| TP-E2E-3 | `tests/ios/DemoUITests/UITests/DemoTests.swift::test3ListAfterARelaunchFindsTheActivity` (simulator)<br>`tests/ios/run.sh::run.sh` (build) |
| TP-E2E-4 | `tests/ios/DemoUITests/UITests/DemoTests.swift::test4LifecycleChecksPassThroughTauri` (simulator)<br>`tests/ios/run.sh::run.sh` (build) |
| TP-E2E-5 | `tests/ios/DemoUITests/UITests/DemoTests.swift::test6TapLaunchesTheAppForASlowRustHandler` (simulator)<br>`tests/ios/run.sh::run.sh` (build) |
| TP-E2E-6 | `tests/ios/DemoUITests/UITests/DemoTests.swift::test1BoundStyleShowsOnTheLockScreen` (simulator)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test2LockScreenButtonReachesRustAndJavaScript` (simulator)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test3ListAfterARelaunchFindsTheActivity` (simulator)<br>`tests/ios/DemoUITests/UITests/DemoTests.swift::test7RustStartsALayoutWhoseButtonReachesRust` (simulator)<br>`tests/ios/run.sh::run.sh` (build) |
| TP-BUILD-1 | `tests/ci.test.mjs::the macOS job checks the iOS code for the device and builds it, with activitykit's Swift, for the simulator` (node)<br>`tests/ios/run.sh::run.sh` (build) |
| TP-CI-1 | `tests/ci.test.mjs::the changes job starts the macOS job for the Rust crate, its lock file, setup and the iOS tests` (node) |
| TP-CI-2 | `tools/spec-coverage.sh::spec-coverage.sh` (build) |
| TP-CI-3 | `tests/ci.test.mjs::CI caches the Rust builds, installs cargo-llvm-cov, and caches the simulator build and its passes` (node) |
