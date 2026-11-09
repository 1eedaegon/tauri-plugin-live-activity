# Development environment and resources

## First setup

This records the environment as it was first set up on 2026-11-04. The plugin and the
mobile demo have since been built and checked on emulators. Current results are in the
[validation record](validation.md), and the supported versions in the
[compatibility policy](compatibility.md). Device identifiers and account details are not
recorded here.

| Item | State |
| --- | --- |
| Host | Apple silicon arm64, macOS 27.2 |
| RAM / free disk | 32 GiB / about 100 GiB before the installs, about 74 GiB after |
| Node / npm | 26.12.1 / 11.20.0, already installed |
| Java | Zulu OpenJDK 21.0.11, already installed |
| Rust / Cargo | 1.99.1; installed during this setup with the rustup minimal profile, version checked |
| Android platform-tools | 37.0.1; installed during this setup as a Homebrew cask |
| adb devices | None connected when checked |
| Xcode / active developer directory | 27.2 (27B52), `/Applications/Xcode.app/Contents/Developer`; license accepted and first-launch setup done |
| iOS SDK / CocoaPods | iOS 27.2 SDK / CocoaPods 1.17.0 |
| macOS developer and debugging access | `DevToolsSecurity -status`: enabled |
| Android Studio | 2026.2.2.8 (Rabbit 2), installed as a Homebrew cask |
| Android SDK | `$HOME/Library/Android/sdk`: platform 37.0 rev 2, build-tools 37.0.0, platform-tools 37.0.1, command-line tools 23.0 |
| Android NDK | 30.0.16248370 (r30 LTS); the app's minimum supported version is API 26 |
| Tauri CLI | 2.12.4, pinned as a project devDependency and in the npm lockfile |
| Rust mobile targets | aarch64-apple-ios, aarch64-apple-ios-sim and aarch64-linux-android added |
| Flutter | Not installed; not needed if its source is only read for reference |
| Plugin / example | Did not exist at the time of the first environment survey; the current implementation and demo are in the repository |
| Input contract tests (development) | Added after the survey; 50 pass on Node 22.12.0 and 26.12.1; separate from the native tests |

The Rust install did not change the shell configuration. To activate it in this
environment:

```sh
source "$HOME/.config/cargo/env"
rustc --version
cargo --version
adb version
adb devices
```

This Cargo path comes from the environment variables already set on this Mac. On another
machine, use the path that rustup prints. Nix manages Node, Java and Homebrew here, so a
permanent setting belongs in the existing Nix configuration. The Homebrew installs from
this setup are local changes and were not added to the Nix declarations. Check that they
survive a later rebuild or cleanup.

## Activating and checking the project environment

Run these from the project root. The script changes only the current shell, not the Nix
configuration or any shell startup file. It keeps any JAVA_HOME, ANDROID_HOME or NDK_HOME
that is already set.

```sh
source tools/mobile-env.sh
npx --no-install tauri info
pod --version
android --no-metrics sdk list --help
npm test
```

The Java in use was the existing Nix Zulu 21.0.11. Android Studio's bundled JDK is 25.0.4,
and the script picks it as the default only in a shell without JAVA_HOME. The Gradle app
builds and native tests that came later ran on JDK 21.

## First environment probes

- A Rust dynamic library compiled and linked for macOS ARM64.
- The first Android ARM64 shared library check passed with the NDK's API 24 linker. Running
  a real app later showed that a Tauri dependency needs API 26, so the minimum for the app
  and the plugin was changed to 26.
- A Rust dynamic library compiled and linked for iOS ARM64, with deployment target 16.1, the minimum before 0.4.
  Since 0.4, Live Activities need iOS 16.2, activitykit's minimum.
- Swift code using ActivityKit's ActivityAttributes and ContentState typechecked against
  the iOS 27.2 SDK.
- The environment script passed sh and zsh syntax checks, and sourcing it again adds no
  duplicate PATH entries.

The probes were minimal code in a temporary directory. They did not check app signing,
installation, what shows on screen, embedding the widget extension, plugin integration or
E2E tests, or behavior on old devices. A simulator SDK is not the same as a simulator
runtime that runs apps. After the first probes, Android emulator images were installed to
run the boundary versions. The list above does not include those app runs.

The NDK version follows [Google's NDK LTS downloads](https://developer.android.com/ndk/downloads/).
In Android command-line tools 23.0, sdkmanager gives way to the Android CLI, so SDK
management from here on uses the [Android CLI](https://developer.android.com/tools/agents/android-cli).

## Reproducing on devices and other hosts

1. Set up the Apple account, the team and development signing in Xcode. When checked,
   there were no valid code signing identities.
2. Connect the test devices. Approve trust and Developer Mode on the iPhone, and USB
   debugging on the Galaxy.
3. Build the repository's Tauri example app with the current Java and NDK.
4. Set up signing for the example's iOS Widget Extension and check what each device shows.
5. Install other ABIs, emulators and simulator runtimes once more test targets are chosen.

Follow [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/), but do not
declare the Rust version that happens to be installed as the library's MSRV. Windows needs
a Windows build host or CI of its own, and Linux a Linux host or CI. Cross-compiling on a
Mac cannot verify Windows notification activation or how the Linux desktop behaves.

## Memory and disk

The figures below are **planning estimates for this project, not measurements**. They
change with the IDE, parallel Rust builds, the Gradle daemon, the browser and the number of
simulators.

| How you develop | RAM budget for the whole system |
| --- | --- |
| Mostly on devices, one platform's build at a time | About 12–20 GiB |
| One iOS simulator, one Android emulator and an IDE | About 20–30 GiB or more |
| Several emulators, both platforms building at once | Can exceed 32 GiB |

For a Mac, Google gives a minimum of 8 GB for Studio alone and 16 GB with the emulator, and
recommends 32 GB ([official requirements](https://developer.android.com/studio/install)).
The current 32 GiB suits development that runs mostly on devices. At first, run one
simulator at a time, and limit Cargo's parallel jobs and Gradle's heap and workers when
needed.

Budget **40–80 GiB or more of extra disk** for Xcode, the SDKs, the NDK, runtimes and build
caches together; the figure depends on the versions installed. With the current 100 GiB
free, do not install several iOS runtimes and Android images at once.

The plugin's runtime memory cannot be measured yet. The design leaves out the Flutter
engine, uses the OS's native display and does not keep a JS timer ticking every second.
Idle memory, and the extra memory with one activity and with several, still need to be
measured separately in the example app.
