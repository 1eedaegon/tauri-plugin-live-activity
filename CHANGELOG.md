# Changelog

## 0.1.0-alpha.2

- Rename the npm package to `tauri-plugin-live-activity`, matching the crate name.
- Replace the demo with Mochi's snack delivery and nap timer, including a custom iOS widget.
- Keep Android permission requests retryable after the system dialog is cancelled.
- Check notification channel importance before requesting Live Update promotion and report rejected promotion as a degraded feature.
- Reject conflicting iOS updates whose text differs only in Unicode encoding.
- Require iPadOS 17 for iPad and exclude iOS app compatibility mode on Mac.
- Add native permission, timer and lifecycle tests, registry-backed Tauri consumers, and Windows/Linux IPC checks.

## 0.1.0-alpha.1

- Start, update, end and reconcile local progress/timer activities from Tauri 2.
- iOS ActivityKit backend and shared Widget Extension template.
- Android ongoing notifications with explicit fallback and Live Update promotion checks.
- Typed JavaScript API, read-only default Tauri permissions and strict request validation.
- Runnable mobile demo and native lifecycle tests.

Desktop backends, push updates and event subscriptions are not included.
