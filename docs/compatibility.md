# OS 호환성 정책

아래 최소 버전 수정은 `0.1.0-alpha.3`에 반영됐습니다. Cargo alpha.3은 게시됐고,
npm alpha.3은 GitHub Actions 배포 검증 중입니다. npm의 현재 공개 버전은 alpha.2입니다. 두 레지스트리에서 같은 이름
`tauri-plugin-live-activity`를 사용합니다. 이 문서는 지원 기준을 정하고,
[OS별 검증 범위](platform-coverage.md)는 실제로 실행한 테스트를 기록합니다.

## 지원 버전

| 플랫폼 | 지원 기준 | 제공 기능 |
| --- | --- | --- |
| iPhone | iOS 16.1+ | ActivityKit 시작·갱신·종료·재조회, 진행률·타이머 |
| iPhone의 `staleAt` | iOS 16.2+ | ActivityContent에 만료 시각 전달. stale 전환은 관측된 OS 상태를 반환 |
| iPad | iPadOS 17+ | 같은 ActivityKit API; iPadOS 16.x는 명시적 미지원 |
| Android | Android 8.0 / API 26+ | 일반 진행률·타이머 알림 대체. API 24는 Tauri 초기화 충돌을 재현해 지원 대상에서 제외 |
| Android 알림 채널 | Android 8.0 / API 26+ | 채널 생성·차단·중요도 검사 |
| Android 알림 권한 | Android 13 / API 33+ | 런타임 요청·취소·거부·설정 필요 상태 처리 |
| Android Live Updates | Android 16 / API 36+ | 적격성·사용자 설정 검사 후 승격 요청; 실제 OS 플래그로 결과 확인 |
| macOS·Windows·Linux | 활동 backend 미지원 | 기능 조회와 안정적인 미지원 오류; 데스크톱 알림 대체는 구현 전 |
| watchOS·CarPlay·Mac의 iPhone 활동 표시 | 독립 실행 대상 아님 | 호스트 위젯과 OS가 전달하는 보조 화면; 별도 실기기 검증 필요 |
| visionOS | 미지원 | 호환 iPhone/iPad 앱의 ActivityKit 시작도 거부됨; 플러그인의 호환모드 탐지·런타임 미검증 |
| 브라우저·기타 OS | 미지원 | 네이티브 활동 표시를 지원한다고 광고하지 않음 |

ActivityKit의 iPad 지원은 iPadOS 17부터입니다.
[Apple의 ActivityKit 소개](https://developer.apple.com/videos/play/wwdc2023/10184/).
visionOS에서 호환 iPhone/iPad 앱의 활동 시작도 실패합니다.
[ActivityKit 플랫폼 안내](https://developer.apple.com/documentation/activitykit).

Android API 36의 API 존재와 화면 승격 보장은 다릅니다. API 36.1 이상 휴대용 기기의
호환성 규정에는 승격된 알림의 잠금 화면 표시 요구가 추가되지만, 이 규정이 모든
앱의 알림을 자동 승격한다는 뜻은 아닙니다. API 36 에뮬레이터의 승격 불허 상태와
API 37의 승격 성공을 각각 검사했습니다. 채널 중요도, 사용자 설정, 알림 형식,
OEM 조건이 충족되지 않으면 명시적인 일반 알림 대체를 사용합니다.
[Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update),
[Android 16 호환성 규정](https://source.android.com/docs/compatibility/16/android-16-cdd).

## 빌드 기준과 실행 검증

API가 처음 생긴 버전, 이 패키지를 빌드할 수 있는 환경, 실제 실행한 버전은
서로 다릅니다. 테스트가 없는 버전을 테스트 완료로 표시하지 않습니다.

| 항목 | 현재 기준 |
| --- | --- |
| Rust | MSRV 1.90, edition 2024; 릴리스 검사 Rust 1.99.1 |
| Tauri | Tauri 2 범위: Rust `^2.12.5`, JS API `^2.12.4` |
| Apple 플러그인 패키지 | Swift tools 5.9, iOS 배포 대상 15+; 활동 기능은 위 표의 OS 조건 필요 |
| 데모·Widget Extension | iOS 배포 대상 16.1; iPad에서는 17+ 정책 적용 |
| Apple 검증 도구 | Xcode 27.2 / iOS SDK 27.2 |
| Android 패키지 | alpha.3부터 `minSdk = 26`; `compileSdk = 37` |
| Android 검증 도구 | JDK 21, Android SDK 37, NDK 30 |

Xcode 27.2는 iOS 15 이상 배포 대상을 빌드할 수 있지만, 지원하는 기기·시뮬레이터
실행 범위는 iOS 17 이상입니다. iOS 16.1/16.2 분기의 컴파일·단위 테스트를 구형 OS
실행 결과로 바꾸어 표현하지 않습니다. 이 두 버전의 실행 검증에는 호환되는 별도
Xcode·호스트가 필요합니다.
[Apple Xcode 지원표](https://developer.apple.com/xcode/system-requirements/).

Android 호스트 앱은 지원되는 WebView와 자체 프런트엔드의 브라우저 요구사항도
충족해야 합니다. 오래된 에뮬레이터에 설치된 WebView가 현재 번들을 실행하는지는
네이티브 알림 API 테스트와 별도로 확인합니다.

alpha.2의 manifest는 API 24를 허용했으나, 실제 레지스트리 앱은 API 24에서
Tauri의 Jackson 초기화 중 `BootstrapMethodError` 누락으로 충돌했습니다.
Tauri도 현재 Android 8 이상을 명시합니다. 낮은 manifest 값만으로 Android 7
호환성을 주장할 수 없습니다. API 26에서 실제 Tauri Invoke/Jackson 경로와 네이티브
알림 검사 8개를 통과했고, 최소 설정을 26으로 바로잡았습니다. 이 에뮬레이터의
기본 WebView 58은 Tauri JavaScript를 해석하지 못하므로 전체 WebView 경로의
성공으로 세지 않습니다. 전체 앱 경로는 API 31·33·36·37에서 검증했습니다.
[Tauri 재현 이슈](https://github.com/tauri-apps/tauri/issues/8788).

## 데스크톱 기준

현재 Tauri 2.12.5의 기준은 Windows 10+, macOS 10.15+, Linux WebKitGTK 4.1입니다.
이는 이 플러그인이 데스크톱 활동을 구현했다는 뜻이 아닙니다. Linux 배포 가능
버전은 빌드 환경의 glibc와 패키징 방식에 따라 정해야 합니다.
[버전 고정 Tauri 플랫폼 표](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/README.md#platforms).

데스크톱 대체 backend를 추가하려면 시작뿐 아니라 같은 활동의 갱신·제거,
오류 전달, 권한, 재실행 후 상태 조정까지 확인해야 합니다. 일반 알림 라이브러리의
일부 OS에서 제거가 무동작인 구현은 이 계약을 충족하지 못합니다. 네이티브
ActivityKit과 동일한 기능을 제공한다고 표시하지 않습니다.

## 릴리스 기준

모바일 지원 기준을 alpha.3에 반영합니다. 검증 결과와 문서만 보강하면
패키지 버전을 바꾸지 않습니다. 네이티브 동작·지원 범위·필수 빌드 설정을 바꾸면
다음 alpha에 반영하고, 두 레지스트리의 버전을 맞춥니다. 기존 게시물을 덮어쓰지
않습니다. 데스크톱 대체는 별도 backend와 기능 계약을 검증한 뒤 지원 표에 올립니다.

정식 `0.1.0` 전에는 남은 구형 Apple 런타임, 실제 iPhone/iPad, Samsung One UI의
표시·권한·사용자 해제 동작을 확인하고 공개 API와 패키징을 확정합니다. 이 기기
검증을 현재 시뮬레이터의 성공으로 대신하지 않습니다.

## 표시와 실행 수명

- 성공 응답은 사용자가 보았다는 증거가 아닙니다. `visibility`는 `unknown`입니다.
- 앱이 중단되거나 종료되어도 WebView JavaScript가 계속 실행된다고 보장하지 않습니다.
- 사용자 해제·권한 철회를 재게시로 우회하지 않습니다. 재시작 시 저장된 ID와 OS 상태를 조정합니다.
- APNs·FCM·백그라운드 작업·상호작용 버튼은 현재 릴리스에 포함하지 않습니다.
- `fallback: "notification"`일 때만 알림 대체를 선택합니다. `none`은 OS의 표시 억제나 이후 강등을 막는 옵션이 아닙니다.
- iOS의 `staleAt`은 ActivityKit에 전달합니다. 현재 시뮬레이터에서 관찰되지 않은 자동 stale 전환은 통과한 테스트로 세지 않습니다.
