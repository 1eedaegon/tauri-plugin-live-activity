# References and conventions

Researched on 2026-11-04. Online docs and main/v2 branches can change, so SDK and
dependency versions are pinned and checked again during implementation. No outside code
was copied; it served as a reference for the structure of the docs and for design
decisions.

## Tauri repository conventions

A GitHub search for `tauri-plugin in:name`, sorted by stars, turned up widely used
projects. The comparison then centered on the current official Tauri v2 workspace and the
most relevant plugins. The search is not a true popularity ranking of all plugins.
Settings from older standalone repositories were not taken as current Tauri v2 convention.

| Source | What was taken from it |
| --- | --- |
| [Official notification README](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/plugins/notification/README.md) | Section order: support table, Rust core and JS binding install, capability, usage, contributing and license |
| [Official store README](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/plugins/store/README.md) | A short description, and how the install and usage docs are laid out |
| [Official .gitignore](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/.gitignore) | Ignores Rust and JS build output, example caches, environment and editor files |
| [Official Cargo workspace](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/Cargo.toml) | Confirms workspace.package.license = Apache-2.0 OR MIT |
| [tauri-plugin-decorum](https://github.com/clearlysid/tauri-plugin-decorum/tree/ea72a1f9d1f28f0ca6ea59fe5f6b5ab6c7293faf) | A community plugin's short README, guidance built around the example app, its ignore setup |

The official workspace and decorum ignore some lockfiles. This project keeps its lockfiles
so that checks of the mobile and desktop consumer examples can be reproduced. The generated
native projects are not ignored as a whole, so the widget target, the parts of the signing
setup that are not secret, and the Gradle wrapper can be reviewed. Signing private keys and
files with local paths are excluded separately.

The README got no npm or crates.io badges, install commands or claims of passing CI or
platform support, since none of them existed yet. LICENSE explains the choice of license;
LICENSE-APACHE and LICENSE-MIT hold the full texts. If third-party code is brought in
later, its notices and license terms are kept separately.

## Sources for the design

| Official or author source | What it was used for |
| --- | --- |
| [Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/) | The official bridge between Rust and Swift/Kotlin |
| [Tauri plugin development](https://v2.tauri.app/develop/plugins/) | Package layout, command permissions, platform metadata |
| [Tauri capabilities](https://v2.tauri.app/security/capabilities/) | Keeping frontend command permissions apart from OS permissions |
| [Flutter live_activities package](https://pub.dev/packages/live_activities) | An example of integrating a native Widget Extension and App Groups |
| [Flutter reference source](https://github.com/istornz/flutter_live_activities/tree/663fe5ec3505edba7641cf9c6c4352cf7e124937) | How the Swift side passes data through UserDefaults and ContentState; how the Kotlin notification manager is built |
| [Apple's ActivityKit guide](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) | Passing state directly, the UI extension, lifetime and size limits |
| [Apple authorization state](https://developer.apple.com/documentation/activitykit/activityauthorizationinfo) | Reading whether activities and frequent updates are allowed |
| [Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update) | Standard styles, promotion requirements, OEM differences, the RemoteViews restriction |
| [Android notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission) | The runtime permission on API 33+ |
| [Windows progress notifications](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar) | Updating state through data binding |
| [freedesktop notification spec](https://specifications.freedesktop.org/notification/latest-single/) | replaces_id, server capabilities, differences in persistence |
| [XDG Notification portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html) | Posting, replacing and removing notifications from a sandbox |
| [iPhone Live Activities on a Mac](https://support.apple.com/en-ie/120684) | Telling a standalone macOS implementation apart from iPhone mirroring |

GitHub searches for `tauri live activity`, `tauri-plugin-live` and `ActivityKit tauri`
found no proven multiplatform implementation, within the scope of this research, that could
be adopted as is. That does not mean none exists. How much existing notification-based
code can be reused, and each native dependency, are checked further before the real
implementation.
