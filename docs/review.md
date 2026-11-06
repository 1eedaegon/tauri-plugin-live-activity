# Research review and follow-up work

Reviewed on 2026-11-04, after the research was done, by checking the README, everything in
docs and the state of the local tools. This is a review of readiness to implement. It does
not approve platform support or validate a release. It is kept as a record; what was built
and tested later is in the [validation record](validation.md).

## Decision

Adopt one shared lifecycle contract with an adapter for each OS. The direction stays: no
Flutter runtime, ContentState passed directly on iOS, standard notifications on Android
and an explicit fallback path on desktop. Native implementation starts once the
ambiguities below are resolved.

| Priority | Problem found | Change to the contract |
| --- | --- | --- |
| High | Promotion "requested" and "promoted" can both be true, but they were mixed in one enum | Whether promotion was requested and the observed state become separate fields |
| High | fallback none could be read as a guarantee of real promotion or of a display that stays | State that it is the plugin's policy for picking a fallback, and that it does not stop the OS from demoting the activity later |
| High | "The OS is the source of truth for state" is not enough to implement a portal that cannot be queried | Keep the stored request state apart from the state observed from the OS, and leave what cannot be observed as unknown |
| Medium | The wire format and ranges of numbers, times and strings were not defined | revision is a JS safe integer, times are UTC epoch milliseconds, unknown fields are rejected |
| Medium | Idempotent ends, and how an earlier update is handled when the same key is reused, were unclear | Every activity created gets an opaque handle; an ended handle is never reassigned to a new activity |

Sources: [Android promotion queries and user dismissal](https://developer.android.com/develop/ui/views/notifications/live-update),
[the portal's limits on observing what is shown](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html),
[Windows update results and removal by the user](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar).
The number ranges and the handle policy are this project's own design decisions.

## Scope of this follow-up

The first addition was a **request contract validator** that runs without Xcode or the
Android SDK. It is not the public plugin API or the JS→Rust bridge. It can go on while
the native tools are being prepared, and it does not replace the native spike.

- PRD: when a caller passes a bad progress value, time or revision, it is rejected before
  any OS call.
- System design: implementations in each language are checked against the JSON Schema and
  shared JSON fixtures.
- Technical doc: the [request contract](request-contract.md) defines the format, the
  limits and who validates what.
- Reuse: Ajv does the validation and the tests use Node's built-in runner. No schema engine
  of our own.
- Order of work: failing tests → schema and validator → passing tests and coverage → code
  and security review.

Development-only dependencies are pinned in the npm lockfile. The real plugin has to
validate again in Rust, and Swift needs its own 4 KB check after encoding. Passing the
fixtures is not an OS test.

## Remaining steps

1. Prepare Xcode, the SDKs and the NDK; confirm the OS and One UI versions on the devices;
   spike the shared Swift module and the widget target.
2. Run these fixtures against a Rust validator, and build the IPC models and the
   permission generation.
3. Build the iOS and Android adapters and the example app, then check a real start →
   update → end and where a tap takes the user.
4. Check the desktop adapters separately on a host for each OS. An unverified platform is
   never marked as supported.
5. Decide on a release once the distribution packages are checked and real device results
   are in.

At the time of this review, no connected devices or accounts had been confirmed, and
neither Xcode nor the Android SDK was installed. The environment setup that followed
installed the tools and confirmed minimal native library builds. The
[development environment](development.md) page has the latest install, signing and device
state. Passing the contract tests does not stand in for E2E results of the plugin on
devices.

## Results

- TDD: the tests failed first, before the validation module existed, and then the module
  was written.
- 50 tests pass on Node 26.12.1 and on the declared minimum, Node 22.12.0.
- Line, branch and function coverage of the development tool `tools/validate-request.mjs`
  are each 100%. That says nothing about coverage of the JSON Schema, the code Ajv
  generates, or the Rust, Swift and Kotlin code and OS behavior that did not exist yet.
- Local links in the 11 Markdown documents pass the link check. npm audit found 0 issues
  when the development dependencies were installed.
- Code and security review: input is never coerced or modified, unknown fields are
  rejected, errors do not echo input values, and input never runs an external command,
  opens a path or reaches the network. No CRITICAL or HIGH issues within the scope
  reviewed.
- Native integration and E2E tests, device tests and package publishing have not been run.
