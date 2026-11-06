# Permissions and setup

Permission to run developer tools, Tauri IPC permissions, the user's consent in the OS and
the rights of a distribution account are separate. Anything that can be declared or
registered can be prepared ahead of time, but nobody can approve a user's choice or a store
review in advance. The first research pass did not change any system security setting or
app permission.

Permission follow-up, 2026-11-04: at the user's request, `DevToolsSecurity -enable` was
run through the macOS administrator prompt, and the Developer Tools page in System
Settings was opened. A later check found the administrator approval done, and
`DevToolsSecurity -status` reports enabled. Xcode was installed, its license accepted and
its first-launch setup completed. This setting is for Apple's signed debugger and
performance tools. It does not stand in for per-app notification permission, iPhone
Developer Mode or USB trust. The per-app developer tools toggle in System Settings, trust
on the phone and per-app notification permission are not counted as approved. They have to
be checked in the app that actually asks and on the connected device.

| Area | Can be prepared | Steps needed from the user, account or device |
| --- | --- | --- |
| Tauri | A permission for each command; a capability that lists only the commands needed | The host app's developer chooses what to allow |
| iOS Live Activity (basic) | NSSupportsLiveActivities in the host Info.plist; the widget target and signing | Read the current permission state with ActivityAuthorizationInfo; system settings cannot be forced |
| iOS ordinary notification fallback | UserNotifications integration | Ordinary notification permission is separate from Live Activity permission; the user makes the actual choice |
| App Groups | When the design needs shared files, register the same group for the app and the extension | Needs an eligible developer team and provisioning; the default design does not need it |
| APNs | The Push Notifications capability, server integration, token handling | Developer account, key and environment setup. The private key stays on the server only |
| Frequent Live Activity updates | Declare NSSupportsFrequentLiveActivityUpdates when needed | Depends on what the user allowed and on the OS budget |
| Android 13+ notifications | Declare POST_NOTIFICATIONS in the manifest | User consent at runtime; handle denial, revocation and blocked channels |
| Android Live Updates | Declare POST_PROMOTED_NOTIFICATIONS; build an eligible notification | Not an ordinary runtime dialog permission. Check canPostPromotedNotifications and the user setting |
| Android background work | Pick the FGS type and permissions that fit the actual work | Meet each OS version's start limits and execution policy; do not add an FGS just for the notification |
| macOS | Bundle identifier, native notification setup | The user allows notifications; test with a signed app |
| Windows | App identity, registration and activation setup | Notification settings, policy or the way the app is installed can block it |
| Linux | Desktop ID, D-Bus and portal integration | Notification server and sandbox portal policy. No Android-style app-wide permission |

Asking for ordinary notification permission is not treated as a precondition for iOS Live
Activities. App Groups are not an ActivityKit requirement either; they are one choice of
how to share data.
[Apple ActivityKit](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities).

Live Updates in the latest Android versions do not allow a customContentView built on
RemoteViews. Declaring POST_PROMOTED_NOTIFICATIONS alone does not guarantee a place in
Samsung's Now Bar or on another OEM's screens.
[Android requirements](https://developer.android.com/develop/ui/views/notifications/live-update).

## Connecting devices

- iPhone: connect the cable, trust the computer, turn on Developer Mode, pair with Xcode
  and set up development signing.
- Galaxy: turn on developer options and USB debugging, and approve the connected
  computer's RSA key.
- Test with adb grant and reset only on the chosen test app and device; never use them as
  the way a shipped app gets its permissions. Test the first-install, allow and deny paths
  separately too.

Unlocking a device and approving trust, signing in to an Apple account with 2FA, and
joining and paying for a developer program need the user. Installing tools and setting up
the project can be automated.

## Distribution

Publishing the plugin library to crates.io and npm needs publishing rights on each registry
and a check of the name. Publishing a library does not go through App Store review. Shipping
a test app to a store is separate work: it needs an Apple or Google account and the app's
registration, signing and review.

Running on a device with Apple's Personal Team is not the same as being eligible for App
Store distribution. Google Play sets conditions for production access on the new personal
accounts its policy covers, such as a closed test with at least 12 testers for 14 days in a
row, so a public release right after the four-device tests is not guaranteed.
[Apple's account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/),
[Google Play requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

Windows signing and macOS distribution signing and notarization are prepared to fit how the
host app ships. Certificates, APNs keys, the Android keystore and registry tokens never go
into Git. `.gitignore` guards against mistakes, but it does not stop secrets leaking from
files already tracked or from a published package, so check the package file list and run
a secret scan separately.
