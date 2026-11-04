# 권한과 사전 준비

개발 도구 실행 권한, Tauri IPC 권한, OS 사용자 허용, 배포 계정 권한은 별개입니다.
미리 선언하고 등록할 수 있는 항목은 준비할 수 있지만 사용자 선택과 스토어 심사를
사전 승인할 수는 없습니다. 최초 자료조사에서는 시스템 보안 설정이나 앱 권한을 바꾸지 않았습니다.

2026-11-04 후속 권한 요청: 사용자의 요청으로 `DevToolsSecurity -enable`을 macOS
관리자 인증 창을 통해 요청하고 시스템 설정의 개발자 도구 페이지를 열었습니다.
후속 확인에서 관리자 승인이 완료됐고 `DevToolsSecurity -status`는 enabled입니다.
Xcode 설치·라이선스 처리·최초 실행 구성도 완료했습니다. 이 설정은 Apple 서명 디버거·
성능 분석 도구용이며 앱별 알림 허용, iPhone Developer Mode, USB 신뢰를 대신하지 않습니다.
시스템 설정의 앱별 개발자 도구 토글, 휴대전화 신뢰, 앱별 알림 허용은 승인 완료로
간주하지 않습니다. 실제 요청 앱과 연결 기기에서 확인해야 합니다.

| 구분 | 사전 준비 가능 | 사용자/계정/기기에서 필요한 단계 |
| --- | --- | --- |
| Tauri | 명령별 permission 정의, capability에 필요한 명령만 연결 | 호스트 앱 개발자가 허용 범위 선택 |
| iOS 기본 Live Activity | 호스트 Info.plist의 NSSupportsLiveActivities, 위젯 타깃·서명 | ActivityAuthorizationInfo로 현재 허용 상태 확인; 시스템 설정을 강제 변경할 수 없음 |
| iOS 일반 알림 대체 | UserNotifications 연동 | 일반 알림 권한은 Live Activity 허용과 별도; 실제 사용자 선택 |
| App Groups | 공유 파일이 필요한 설계에서 앱·확장에 동일 그룹 등록 | 적격 개발자 팀·프로비저닝 필요; 기본 설계에는 불필요 |
| APNs | Push Notifications capability, 서버 연동·토큰 처리 | 개발자 계정·키·환경 설정. private key는 서버에서만 보관 |
| 빈번한 Live Activity 갱신 | 필요할 때 NSSupportsFrequentLiveActivityUpdates 선언 | 사용자가 허용한 상태와 OS 예산에 종속 |
| Android 13+ 알림 | Manifest POST_NOTIFICATIONS 선언 | 런타임 사용자 동의; 거부/철회·채널 차단 처리 |
| Android Live Updates | POST_PROMOTED_NOTIFICATIONS 선언, 적격 알림 작성 | 일반 runtime dialog 권한이 아님. canPostPromotedNotifications 및 사용자 설정 확인 |
| Android background 작업 | 실제 작업에 맞는 FGS type·권한 등을 선택 | OS별 시작 제한·실행 정책 충족; 알림만 위해 무조건 FGS 추가하지 않음 |
| macOS | 번들 식별자, native 알림 설정 | 사용자 알림 허용; 서명된 앱으로 검증 |
| Windows | 앱 식별·등록·activation 설정 | 알림 설정/정책 및 설치 형태에 따라 차단 가능 |
| Linux | desktop ID, D-Bus/portal 연동 | 알림 서버·sandbox portal 정책. Android식 일괄 허용 모델 없음 |

iOS Live Activities를 켜기 위해 일반 알림 권한 요청을 필수 선행 조건으로 취급하지
않습니다. App Groups 역시 ActivityKit 자체의 필수 조건이 아니라 공유 데이터 방식의
선택입니다. [Apple ActivityKit](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)

Android 최신 Live Updates는 RemoteViews 기반 customContentView를 허용하지 않습니다.
POST_PROMOTED_NOTIFICATIONS 선언만으로 삼성 Now Bar나 다른 OEM 화면 표시를 보장할
수 없습니다. [Android 조건](https://developer.android.com/develop/ui/views/notifications/live-update)

## 실기기 연결

- iPhone: 케이블 연결, 컴퓨터 신뢰, Developer Mode, Xcode 페어링·개발 서명 설정.
- Galaxy: 개발자 옵션, USB debugging, 연결 PC의 RSA 키 승인.
- 테스트용 adb grant/reset은 지정 테스트 앱과 기기에서만 수행하며 배포 앱의 권한
  획득 방식으로 사용하지 않습니다. 최초 설치·허용·거부 경로도 별도로 테스트합니다.

기기 잠금 해제와 신뢰 승인, Apple 계정 로그인/2FA, 개발자 프로그램 가입·결제는
사용자 참여가 필요한 단계입니다. 도구 설치와 프로젝트 설정은 자동화할 수 있습니다.

## 배포 준비

플러그인 라이브러리의 crates.io/npm 배포에는 해당 레지스트리의 게시 권한과 이름
확인이 필요합니다. 라이브러리 배포 자체에 App Store 심사는 필요하지 않습니다.
검증용 앱을 스토어에 배포하려면 별도로 Apple/Google 계정과 앱 등록·서명·심사를 준비합니다.

Apple의 Personal Team 기기 실행과 App Store 배포 자격은 다릅니다.
[Apple 계정 설명](https://developer.apple.com/help/account/basics/about-your-developer-account/)
Google Play의 해당 신규 개인 계정에는 최소 12명, 연속 14일 비공개 테스트 등
프로덕션 접근 조건이 있으므로 네 기기 테스트 직후 공개가 보장되지 않습니다.
[Google Play 조건](https://support.google.com/googleplay/android-developer/answer/14151465)

Windows 서명과 macOS 배포 서명/notarization은 호스트 앱 배포 방식에 맞춰 준비합니다.
인증서, APNs 키, Android keystore, registry token은 Git에 넣지 않습니다.
`.gitignore`는 실수 방지 수단이며 이미 추적되는 파일이나 게시 패키지의 비밀 유출을
막아 주지는 않으므로 패키징 목록과 secret 검사를 따로 수행합니다.
