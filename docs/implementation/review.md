# Release review

Scope: `0.1.0-alpha.1`, reviewed on 2026-11-04. This review covers the public
TypeScript API, Rust command boundary, native lifecycle code, and package contents.
Build and emulator results are recorded separately in [validation](../validation.md).

## Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| AND-01 | High | A failed Android notification post leaves a pending receipt. An identical retry can return success without posting the missing state. | Fixed with a durable posting-required flag written before the native call; identical retries post again. Verified by R1–R3 below. |
| AND-02 | High | A terminal receipt can be evicted while cancellation is still pending in the OS. Reconciliation can then import the old notification as active again. | Fixed by requiring a durable ownership record and retaining terminal records in completion order. Verified by R4–R5. |
| AND-03 | Medium | A requested promotion awaiting OS observation reports `notApplicable` instead of `unknown`. | Fixed; verified by R6. |
| AND-04 | Medium | Interrupted dismissal persistence can leave a pending handle eligible for an update. | Fixed with an in-process dismissal record until persistence succeeds; verified by R7. |
| PACK-01 | High | An isolated iOS crate consumer did not enable Tauri's `wry` feature required by iOS plugin registration. | Fixed with an iOS-specific Cargo dependency. A fresh extracted archive passed the minimal consumer build and all five packaged contract tests. |
| DEMO-01 | Medium | The demo requested notification permission on iOS, where the backend exposes Live Activity settings. | Fixed; `uses the iOS Live Activity settings check instead of notification permission`. |
| DEMO-02 | Medium | A pending Android observation could clear the current demo handle or fail the integration runner despite an accepted request. | Fixed; `preserves the current handle while Android observation is pending` and `accepts a newly posted Android handle while native observation is pending`. |

No unresolved critical or high finding remains in the reviewed source and
packages. Android fixes were reread after the regression suite passed. The native review checkpoint
includes 18 JVM tests and 5 instrumented tests on the API 31 emulator, with no
failures or skipped tests. Other emulator and end-to-end results belong in the
validation record.

Regression methods in `android/src/test/java/io/github/eedaegon/liveactivity/LifecycleTest.kt`:

- R1: `failedPostsAreRetriedInsteadOfReportedAsIdempotentSuccess`.
- R2: `postFailureRemainsRetryableEvenIfAFollowupMetadataWriteCannotSucceed`.
- R3: `repeatedPostingFailureStillThrowsAndAnExplicitEndPreventsRetries`.
- R4: `evictedEndedHandlesCannotBeReimportedFromDelayedNativeCancellation`.
- R5: `nativeExtrasAloneCannotAcquireOwnershipOfAnUnknownGeneration`.
- R6: `delayedNativeObservationDoesNotDismissOrLoseAcceptedUpdates`.
- R7: `inProcessDismissalPreventsRepostingWhenPersistenceWasInterrupted`.

## Boundary and security checks

- Default Tauri permissions allow capability, permission, and activity reads only.
  Start, update, end, and permission requests require explicit grants. The Rust
  IPC tests also verify a permitted local read, a denied mutation, and a denied
  remote-origin request.
- Rust rejects unknown request fields, invalid revisions, mismatched templates,
  non-finite progress, and invalid timestamps before native dispatch. Error
  messages do not echo request values. Native response envelopes fail closed.
- Android uses a dedicated notification tag, immutable pending intents, and a
  non-exported dismissal receiver. It does not cancel unrelated notifications,
  create a foreground service, or execute caller-supplied URLs or file paths.
- iOS operations remain serialized across suspension points. Accepted snapshots
  prevent a delayed ActivityKit read from lowering the known revision. Terminal
  receipts reject subsequent updates. Receipt writes are atomic, bounded, and
  protected inside the app sandbox; storage failures return errors.
- Both backends render plain text and keep `visibility: 'unknown'`. A successful
  native call is not reported as proof of display or Android promotion.

## Package checks

The npm archive contains the JavaScript output, type declarations, README files,
and dual-license texts; it does not include development credentials or build
caches. A separate consumer installed the archive and passed ESM invocation and
TypeScript declaration checks. The npm and Cargo package versions agree, and the
npm prerelease tag is `next`. The README installation example matches the public
function signatures and command permissions.

The iOS crate was also extracted into a new directory without a preexisting
`.tauri` tree. A separate consumer with Tauri default features disabled passed
`cargo check --target aarch64-apple-ios-sim`; the extracted Swift package compiled
and Tauri generated its own API dependency. All five contract tests passed from
that archive. The archive checksum and results are recorded in
[`package-consumer.json`](../../tests/ios/results/package-consumer.json).

## Remaining limits

The Rust desktop implementation reports unsupported operations. Native emulator
coverage does not establish Samsung One UI behavior, physical-device background
limits, iOS device signing, or behavior on every supported minimum OS version.
The JavaScript wrapper and request-validator coverage figures do not measure
native UI coverage. iOS receipt handling and Android notification posting cannot
make an OS operation and a local disk write atomic; crash recovery behavior must
remain explicit in the integration guides.
