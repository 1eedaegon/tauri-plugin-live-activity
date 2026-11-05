# Desktop coverage and notification fallback

Research date: 2026-11-04. Alpha.2 has no native Windows, macOS or Linux activity
backend. Its desktop implementation reports unsupported capabilities and rejects
mutations with `UNSUPPORTED_PLATFORM`. The research below describes a possible
future notification fallback, not functionality included in the release.

## Version policy

A framework minimum, an API minimum, a build tool's deployment range, and an OS
version actually tested are separate claims.

| Platform | Technical baseline | Candidate policy for a future backend |
| --- | --- | --- |
| Windows | Tauri 2.12.5 lists Windows 10+. WinRT toast data updates require Windows 10 build 15063. Windows App SDK instead has a Windows 10 1809 / build 17763 floor and adds runtime distribution requirements. | Validate installed apps on a currently serviced Windows 11 release first. Declare any Windows 10 compatibility separately, including edition, build and test results. |
| macOS | Tauri 2.12.5 lists 10.15+. UserNotifications delivered-list/removal APIs exist from 10.14. The Xcode 27.2 toolchain used here lists macOS 12–27 deployment targets. | A backend built with this toolchain should use macOS 12 as its deployment floor and test it explicitly. Supporting 10.15 would require a suitable older toolchain and its own runtime validation. |
| Linux | Tauri 2 requires WebKitGTK 4.1. There is no single distro-independent runtime floor: glibc, package availability, notification server and desktop session matter. | Select and test concrete baseline distributions. Ubuntu 22.04 and Debian 12 are documented build-baseline examples; test GNOME and KDE separately and name packaging formats. |

The [version-pinned Tauri platform table](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/README.md#platforms)
is the relevant framework reference. The [Tauri 2.12.0 release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.0)
explicitly drops Windows 7 support after its Windows bindings update. Some general
Tauri documentation still mentions Windows 7 or macOS 10.13; those older values
must not override the pinned dependency's requirements.

The Windows update floor comes from [ToastNotifier.Update](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotifier.update?view=winrt-26100).
The separate [Windows App SDK version policy](https://learn.microsoft.com/en-us/windows/apps/get-started/versioning-overview)
is relevant only if that SDK is selected. Ordinary Windows 10 Home/Pro support
ended in October 2025; LTSC and extended servicing have distinct policies.
A maintained test target should track a serviced Windows 11 release rather than
imply all historical Windows 10 editions are maintained.
[Windows 10 lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro),
[Windows 11 lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro).

Apple distinguishes the macOS version required to run Xcode from the OS versions
it can deploy to. The current machine has SDK 27.2; Apple's
[Xcode system requirements](https://developer.apple.com/xcode/system-requirements)
list macOS 12–27 deployment targets for Xcode 27.2. This is a toolchain constraint,
not a claim that the plugin already implements or tests a macOS notification
backend.

For Linux, build on the oldest selected base with the required WebKitGTK packages.
Building on a newer system may raise the resulting binary's glibc requirement.
The [Tauri AppImage guide](https://v2.tauri.app/distribute/appimage/) explains this
and names Ubuntu 22.04 and Debian 12 as suitable baseline examples. An AppImage
alone does not prove compatibility with every Linux distribution.

## Existing implementations considered

Research started with GitHub repository/code searches, followed by vendor docs,
source inspection and npm/crates.io version checks. No new desktop dependency has
been added.

| Candidate inspected | Useful parts | Gap against this plugin's contract |
| --- | --- | --- |
| Official `tauri-plugin-notification` / `@tauri-apps/plugin-notification` 2.8.0 | Tauri integration and ordinary desktop notification delivery | Desktop `show()` returns after payload preparation; dispatch is asynchronous. Desktop permission methods return granted. Removing delivered notifications is a no-op on Windows/macOS. It cannot directly provide our error, permission and end semantics. |
| `notify-rust` 4.18.2 | Linux/XDG update, close and close callbacks; cross-platform delivery | Default macOS backend lacks update/close; optional `preview-macos-un` supplies them through a different backend. Windows handle lacks update/close. The common API is not a complete lifecycle abstraction. |
| Community `tauri-plugin-notifications` 0.5.0-rc.14 | Native Windows history/removal and macOS UserNotifications integration are adaptable references | Default notify-rust paths still cannot remove on macOS/Windows; native Windows removal logs per-item failures then returns success. Its Rust 1.93 minimum also exceeds this plugin's 1.90 declaration. Adoption would require a semantic review and explicit dependency policy. |

The official plugin uses notify-rust 4.18 and zbus 5. Inspected source is pinned at
[`685d3424`, desktop implementation](https://github.com/tauri-apps/plugins-workspace/blob/685d3424a946346721d839add3bfb6521690eb6e/plugins/notification/src/desktop.rs)
and [Cargo manifest](https://github.com/tauri-apps/plugins-workspace/blob/685d3424a946346721d839add3bfb6521690eb6e/plugins/notification/Cargo.toml).
Its [platform guide](https://v2.tauri.app/plugin/notification/) also requires an
installed Windows app for correct identity; development notifications can carry
PowerShell's identity.

The notify-rust feature matrix and backend selection are recorded in
[`ee6419cf`, source](https://github.com/hoodie/notify-rust/blob/ee6419cf764b896c7b0f9aed3515cf95982be4f4/src/lib.rs)
and [manifest](https://github.com/hoodie/notify-rust/blob/ee6419cf764b896c7b0f9aed3515cf95982be4f4/Cargo.toml).
Its Linux [handle API](https://docs.rs/notify-rust/4.18.2/notify_rust/struct.NotificationHandle.html)
warns that notification servers vary. Features available on that documented target
must not be assumed to exist on Windows or the default macOS backend.

The community candidate was inspected at
[`3234057a`, Windows removal](https://github.com/Choochmeque/tauri-plugin-notifications/blob/3234057a1e6bf2fb8772898d1847e003ecf464d1/src/windows.rs#L885),
[desktop fallback](https://github.com/Choochmeque/tauri-plugin-notifications/blob/3234057a1e6bf2fb8772898d1847e003ecf464d1/src/desktop.rs#L535),
and [manifest](https://github.com/Choochmeque/tauri-plugin-notifications/blob/3234057a1e6bf2fb8772898d1847e003ecf464d1/Cargo.toml).
Its latest stable registry version was 0.4.6; the inspected implementation was a
release candidate. Those are not interchangeable evidence.

## Feasible native routes

**Windows:** use the Windows bindings for an owned toast tag/group and application
identity. WinRT's data-update operation can update text/progress without showing
a new popup; its result reports an absent notification. Resending a replacement
can show it again after dismissal, so it is unsuitable as an unconditional update
for this plugin's no-resurrection rule. History removal offers explicit end by
owned tag/group/app ID. The maintained `windows` binding was 0.62.2 at research
time; runtime behavior still needs installed-app verification.
[Update versus replacement](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar),
[history removal](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotificationhistory.remove?view=winrt-26100).

**macOS:** UserNotifications can enumerate the app's delivered notifications and
remove selected identifiers. Removal is asynchronous; immediate return is not
confirmation of disappearance. A small Swift bridge or
[`objc2-user-notifications` 0.3.2](https://docs.rs/objc2-user-notifications/0.3.2/objc2_user_notifications/struct.UNUserNotificationCenter.html)
can expose those APIs. Reusing a scheduled request identifier replaces a pending
request; this does not establish a portable, silent, continuously updating live
progress card. App authorization, bundle identity, dismissal, replacement and
restart behavior need native tests before declaring update support.
[Delivered notifications](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/getdeliverednotifications(completionhandler:)),
[selective removal](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/removedeliverednotifications(withidentifiers:)),
[request identifiers](https://developer.apple.com/documentation/usernotifications/unnotificationrequest/identifier).

**Linux:** the freedesktop D-Bus protocol provides `Notify(replaces_id)`,
`CloseNotification`, capability queries and close signals. It defines no standard
list-all operation or portable native progress/countdown presentation. Keeping
owned IDs and observing server lifetime is necessary: persisted numeric IDs alone
must not acquire ownership after a notification daemon restarts. Missing servers,
server changes and unknown dismissal state must remain explicit.
[Desktop Notifications protocol](https://specifications.freedesktop.org/notification/latest/protocol.html).

For sandboxed Linux packaging, XDG Notification portal supports replacement with
the same application-owned ID and withdrawal. It explicitly cannot report whether
a notification was actually presented; notifications can outlive the sending
process. This is a separate adapter choice, not a blanket substitute for D-Bus
server observations. [XDG Notification portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html).
The inspected upstream implementation uses zbus 5; crates.io also offered zbus
6.2.1. A future adapter must choose and validate a major version rather than
silently replacing the upstream dependency.

## Current tests and next release gate

The existing desktop tests are sufficient for the currently advertised
unsupported contract. [Command tests](../src/command_tests.rs) and
[IPC tests](../src/desktop_ipc_tests.rs) verify capability/permission output,
structured errors from registered commands, input rejection, ungranted mutation
denial and rejection of remote content. Windows/Linux CI and the macOS host run
these tests. They do not run a real notification server or validate notification
UI. The [default permission set](../permissions/default.toml) remains read-only.

The recommendation is to finish the mobile coverage work while retaining explicit
desktop unsupported behavior in alpha.2. A notification fallback should be a
separate future backend with its own acceptance criteria, not a successful
`start()` wrapped around an API that cannot reliably update or end its output.

Before advertising a desktop backend:

- Add deliberate public backend values and per-feature capability behavior.
  Native progress, timer, silent updates, observation and end policies must be
  independently supported, degraded or rejected. Do not label an ordinary desktop
  notification as an ActivityKit/Android backend.
- Preserve strict input validation, serial revisions, owned generation IDs,
  durable receipts, idempotence, terminal state and no resurrection after dismissal.
  Keep `visibility: 'unknown'` unless a future contract provides stronger evidence.
- Test native start/update/end, duplicate start, stale/conflicting revisions,
  permission denial, user dismissal, process restart and native-service failure.
  Linux additionally needs notification-daemon restart and GNOME/KDE variation;
  Windows needs installed application identity; macOS needs authorization and
  asynchronous removal checks.
- Record exact OS/build/desktop-session/packaging versions and run a consumer using
  the published npm and Cargo artifacts. Minimum-version declarations require
  runtime evidence on those versions; compiling on current CI runners is not that
  evidence.
