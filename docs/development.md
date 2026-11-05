# 개발 환경과 자원

## 초기 설치 기록

2026-11-04 환경을 처음 구성했을 때의 기록입니다. 이후 플러그인·모바일 데모 빌드와
에뮬레이터 검증을 완료했습니다. 현재 결과는 [검증 기록](validation.md), 지원 버전은
[호환성 정책](compatibility.md)을 확인합니다. 기기 식별자나 계정 정보는 기록하지 않습니다.

| 항목 | 상태 |
| --- | --- |
| 호스트 | Apple Silicon arm64, macOS 27.2 |
| RAM / 디스크 여유 | 32 GiB / 설치 전 약 100 GiB, 설치 후 약 74 GiB |
| Node / npm | 26.12.1 / 11.20.0, 기존 설치 |
| Java | Zulu OpenJDK 21.0.11, 기존 설치 |
| Rust / Cargo | 1.99.1, 이번 작업에서 rustup minimal 설치 및 버전 확인 |
| Android platform-tools | 37.0.1, 이번 작업에서 Homebrew cask 설치 |
| adb 연결 | 조회 시 연결 기기 없음 |
| Xcode / 활성 개발 도구 | 27.2 (27B52), `/Applications/Xcode.app/Contents/Developer`, 라이선스·최초 실행 구성 완료 |
| iOS SDK / CocoaPods | iOS 27.2 SDK / CocoaPods 1.17.0 |
| macOS 개발·디버깅 권한 | `DevToolsSecurity -status`: enabled |
| Android Studio | 2026.2.2.8 (Rabbit 2), Homebrew cask 설치 |
| Android SDK | `$HOME/Library/Android/sdk`: platform 37.0 rev 2, build-tools 37.0.0, platform-tools 37.0.1, command-line tools 23.0 |
| Android NDK | 30.0.16248370 (r30 LTS); 앱의 지원 최소 버전은 API 26 |
| Tauri CLI | 2.12.4, 프로젝트 devDependency와 npm lockfile에 고정 |
| Rust 모바일 target | aarch64-apple-ios, aarch64-apple-ios-sim, aarch64-linux-android 추가 |
| Flutter | 미설치; 소스 참고만 한다면 설치 불필요 |
| 플러그인 / 예제 | 초기 환경 조사 시점에는 없었음; 현재 구현과 데모는 저장소에 포함 |
| 개발용 입력 계약 테스트 | 조사 후 추가; Node 22.12.0 / 26.12.1에서 50개 통과, 네이티브 테스트와 별개 |

Rust 설치 시 셸 설정은 자동 수정하지 않았습니다. 현재 환경의 활성화 명령:

```sh
source "$HOME/.config/cargo/env"
rustc --version
cargo --version
adb version
adb devices
```

이 Cargo 경로는 이 Mac의 기존 환경 변수 설정을 따른 결과입니다. 다른 머신에서는
rustup이 출력한 경로를 사용합니다. Nix가 Node·Java와 Homebrew를 관리하므로
영구 설정은 기존 Nix 설정에 반영하는 편이 적합합니다. 이번 Homebrew 설치는 로컬 변경이며
Nix 선언에 반영하지 않았으므로 향후 재구성/정리에서 유지되는지 확인해야 합니다.

## 프로젝트 환경 활성화와 확인

프로젝트 루트에서 다음을 실행합니다. 현재 셸에만 적용하며 Nix 설정·셸 시작 파일을
변경하지 않습니다. 기존 JAVA_HOME·ANDROID_HOME·NDK_HOME이 있으면 그 값을 유지합니다.

```sh
source tools/mobile-env.sh
npx --no-install tauri info
pod --version
android --no-metrics sdk list --help
npm test
```

확인한 Java는 기존 Nix Zulu 21.0.11입니다. Android Studio의 bundled JDK는 25.0.4이며
JAVA_HOME이 없는 셸에서만 스크립트의 기본값으로 선택됩니다. 이후 실제 Gradle 앱
빌드와 네이티브 테스트는 JDK 21로 실행했습니다.

## 최초 환경 probe 결과

- macOS ARM64 Rust 동적 라이브러리 컴파일·링크 성공.
- 초기 Android ARM64 공유 라이브러리 검사는 NDK의 API 24 linker로 통과했습니다. 이후 실제 앱 실행에서 Tauri 의존성의 API 26 요구를 확인해 앱·플러그인 최소 버전을 26으로 수정했습니다.
- iOS ARM64 Rust 동적 라이브러리 컴파일·링크 성공, deployment target 16.1 사용.
- iOS 27.2 SDK에서 ActivityKit의 ActivityAttributes/ContentState Swift 코드 typecheck 성공.
- 환경 스크립트 sh/zsh 구문 검사 및 반복 source 시 PATH 중복 방지 확인.

검증 코드는 임시 디렉터리에 만든 최소 probe입니다. 앱 서명·설치·화면 표시·위젯
확장 embed·플러그인 integration/E2E·구형 기기 동작을 검증한 것은 아닙니다.
시뮬레이터 SDK와 실행용 simulator runtime은 다릅니다. 최초 probe 이후 Android
에뮬레이터 이미지를 추가 설치해 경계 버전을 실행했습니다. 위 목록 자체는 해당
앱 실행 결과를 포함하지 않습니다.

NDK 버전 선택 근거: [Google NDK LTS 다운로드](https://developer.android.com/ndk/downloads/).
Android command-line tools 23.0의 sdkmanager는 Android CLI로 전환되므로 향후 SDK
관리는 [Android CLI](https://developer.android.com/tools/agents/android-cli)를 사용합니다.

## 실기기와 다른 호스트에서 재현할 때

1. Xcode에서 Apple 계정/팀과 개발 서명을 설정합니다. 확인 시 유효한 코드 서명 identity는 0개였습니다.
2. 테스트 기기를 연결하고 iPhone의 신뢰·Developer Mode, Galaxy의 USB debugging을 승인합니다.
3. 저장소의 Tauri 예제 앱을 현재 Java·NDK 조합으로 빌드합니다.
4. 예제의 iOS Widget Extension 서명을 설정하고 기기별 표시를 검증합니다.
5. 다른 ABI·emulator·simulator runtime은 추가 테스트 대상이 정해질 때 설치합니다.

[Tauri 사전 요구사항](https://v2.tauri.app/start/prerequisites/)을 기준으로 하되
현재 설치된 Rust 버전을 곧바로 라이브러리 MSRV로 선언하지 않습니다.
Windows는 Windows 빌드 호스트/CI, Linux는 Linux 호스트/CI가 별도로 필요합니다.
Mac의 크로스 컴파일만으로 Windows 알림 활성화나 Linux 데스크톱 동작을 검증할 수 없습니다.

## 메모리와 디스크

아래는 이 프로젝트의 **계획용 추정치이며 실측값이 아닙니다**. IDE, 병렬 Rust 빌드,
Gradle daemon, 브라우저, 시뮬레이터 개수에 따라 달라집니다.

| 개발 방식 | 시스템 전체 RAM 예산 |
| --- | --- |
| 실기기 위주, 플랫폼별 순차 빌드 | 약 12–20 GiB |
| iOS simulator 1개 + Android emulator 1개 + IDE | 약 20–30 GiB 이상 |
| 여러 emulator와 양 플랫폼 동시 빌드 | 32 GiB 초과 가능 |

Google은 Mac에서 Studio 단독 최소 8GB, emulator 포함 최소 16GB, 권장 32GB를
안내합니다. [공식 요구사항](https://developer.android.com/studio/install)
현재 32 GiB는 실기기 위주 개발에 적합합니다. 초기에는 simulator를 하나씩 실행하고
필요 시 Cargo 병렬 작업 수와 Gradle heap/worker 수를 제한합니다.

Xcode·SDK·NDK·런타임·빌드 캐시를 합쳐 **40–80 GiB 이상의 추가 디스크 예산**을
잡되 설치 버전에 따라 달라집니다. 현재 여유 100 GiB에서는 여러 iOS 런타임과 Android
이미지를 한꺼번에 설치하지 않습니다.

플러그인 런타임 메모리는 아직 측정할 수 없습니다. Flutter engine을 포함하지 않고,
OS의 네이티브 표시를 사용하며, 매초 JS 타이머를 유지하지 않는 설계를 택합니다.
예제 앱 기준으로 유휴 상태와 1개/여러 활동의 증분 메모리를 별도 측정해야 합니다.
