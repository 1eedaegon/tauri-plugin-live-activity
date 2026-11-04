# OS 호환성 정책

이 문서의 표는 전체 설계 목표입니다. 첫 알파 구현은 iOS·Android이며,
macOS·Windows·Linux는 명시적 미지원입니다. 실제 실행한 OS 버전은
[검증 결과](validation.md)를 확인합니다.

## 지원의 의미

공통 개념은 **시작·갱신·종료 가능한 활동 상태 표시**입니다. Apple Live Activities,
Android Live Updates, 일반 알림은 서로 다른 기능입니다. 플랫폼 이름만으로 동일한
UI나 지속성을 약속하지 않습니다. 아래는 구현 목표이며 모든 항목은 아직 미검증입니다.

지원 여부를 네 단계로 나눕니다: 네이티브 활동 표시, 업데이트 가능한 알림 대체,
제한된 알림 대체, 미지원. `getCapabilities()`는 OS API 존재 여부와 현재 권한,
실제로 선택 가능한 backend를 구분해서 반환해야 합니다.

## 버전별 목표

| OS / 버전 구간 | 권장 backend | 제약과 대응 |
| --- | --- | --- |
| iOS 16.1 미만 | 미지원; 앱 자체 UI | Live Activities API 없음. 오래된 OS를 지원하는 호스트에서도 호출 시 명시적 오류 |
| iOS 16.1 | ActivityKit | 초기 API를 별도 분기. 16.2 API 무조건 호출 금지 |
| iOS 16.2+ | ActivityKit + ActivityContent | stale 상태 및 종료 정책 처리. 세부 기능은 도입 버전별 검사 |
| iOS 17.2+ | 위 기능 + 선택적 push-to-start | 초기 MVP에는 원격 시작 미포함. 별도 APNs 설계·테스트 필요 |
| iPadOS | ActivityKit 후보 | iPhone과 별도 SDK availability·레이아웃 검증 전에는 지원 완료로 표시하지 않음 |
| Android API 24–25 | NotificationCompat 지속/진행 알림 | 최소 API 24는 설계 목표. Tauri 및 의존성 선택 후 확정 |
| Android API 26–32 | 알림 채널 기반 지속/진행 알림 | 채널 차단 검사. runtime POST_NOTIFICATIONS 요청 없음 |
| Android API 33–35 | 위 기능 + 알림 runtime permission | 거부 시 표시 불가. 일반 지속 알림을 Live Updates로 표기하지 않음 |
| Android API 36+ | 적격 Live Updates, 불가하면 알림 대체 | OS 버전만으로 승격 보장 불가. 권한·형식·OEM·사용자 설정 검사 |
| macOS | UserNotifications 알림 대체 후보 | macOS 11+를 잠정 기준으로 검토하되 Tauri 의존성으로 확정. 반복 갱신·재알림 여부 검증 필요 |
| macOS 26+의 iPhone 미러링 | OS가 iPhone 활동 표시 | 데스크톱 앱의 독립 ActivityKit backend와 다름. 플러그인이 강제하거나 지원 여부를 확정할 수 없음 |
| Windows 10/11 | 업데이트 가능한 app notification | 진행률 API, 앱 등록/설치, tag/group, activation 경로 검증. 정확한 최소 빌드는 backend 선택 후 확정 |
| Linux | freedesktop 알림 / sandbox에서는 portal | 배포판·GNOME/KDE·서버 capability별 차이. WebKitGTK 등 Tauri 의존성도 충족해야 함 |
| 브라우저, 기타 OS | 미지원 | OS 플러그인 명령을 흉내 내어 성공 반환하지 않음 |

API의 최소 버전과 이 라이브러리의 지원 최소 버전은 다릅니다. 특히 Windows 10을
기술적으로 빌드할 수 있다는 사실이 현재 제품 지원 정책이나 장기지원 보장을 뜻하지
않습니다. 최초 릴리스에서 SDK·Tauri·Rust·OS의 실제 검증 조합을 기록합니다.

근거: [ActivityKit](https://developer.apple.com/documentation/activitykit),
[Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update),
[Windows 진행 알림](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar),
[freedesktop 명세](https://specifications.freedesktop.org/notification/latest-single/),
[Notification portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html).

## 초기 기기 테스트 매트릭스

| 대상 | 검증할 표시 | 반드시 확인할 조건 |
| --- | --- | --- |
| iPhone XS | 잠금 화면 Live Activity | 설치된 iOS가 16.1 이상인지 확인. Dynamic Island 없음 |
| iPhone 16 | 잠금 화면 + Dynamic Island | compact/minimal/expanded 표시 및 잠금·해제 전환 |
| Galaxy Note10 | 구형 Android 알림 대체 경로 | 정확한 모델·OS·One UI 확인. Android 12 기기라면 API 31 경로 검증 |
| Galaxy S23 | 알림 대체 + 조건 충족 시 Live Updates | 실제 OS/One UI 버전 확인. Android 16 이상이어도 승격 실패/해제 테스트 |
| macOS 현재 호스트 | 로컬 알림 대체 | 권한, 앱 설치/서명, 갱신 중 재알림, 종료/삭제 |
| Windows 테스트 호스트 | 진행률 알림 | 설치 앱과 개발 실행 구분, 클릭 activation, 종료 후 갱신 실패 |
| Linux GNOME/KDE | 알림 교체 | Wayland/X11, D-Bus 서버 재시작, portal/sandbox 차이 |

S23 일부 모델의 Android 16 배포는 [Samsung 업데이트 기록](https://doc.samsungmobile.com/SM-S911U1/026210230304/eng.html)에서 확인됩니다.
이 기록을 사용자 보유 지역·통신사 모델의 설치 버전으로 간주하지 않습니다.
Android emulator는 삼성 One UI·Now Bar를 재현하지 못합니다.
iOS simulator도 APNs·서명·전력 제약 검증을 실기기 대신하지 못합니다.

## 표시와 실행 수명

| 항목 | 정책 |
| --- | --- |
| 앱이 background/suspended | WebView JS 실행을 전제로 갱신하지 않음 |
| 앱 프로세스 종료 | 화면 잔존과 데이터 갱신 능력을 별도로 보고; 영구 실행 보장 없음 |
| 사용자 dismiss/권한 철회 | 재게시로 우회하지 않음; 감지 가능한 범위에서 상태 반영 |
| 재부팅/OS 업데이트 | 자동 복구 보장 없음. 재실행 시 OS와 저장된 ID를 대조 |
| 잠금 화면/Focus/DND | API 성공과 사용자에게 보였음을 구분; visibility는 unknown 가능 |
| 타이머/진행률 | OS가 지원하는 시각·진행률 표현 사용. 초당 IPC/재게시 금지 |
| watchOS/CarPlay/Mac 보조 화면 | iPhone에서 전달되는 표시를 우선 고려. 독립 Tauri 실행 대상으로 선언하지 않음 |

Apple 문서상 활동은 최대 8시간 활성화되고 잠금 화면에 추가로 최대 4시간 남을 수
있습니다. Live Activity 자체는 네트워크나 위치에 직접 접근하지 않습니다.
속성·상태 합계 4KB 제한을 지키고 Swift 인코딩 기준으로 검증해야 합니다.
[Apple 제약](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)

Android 지속 알림은 앱을 계속 실행시키는 기능이 아닙니다. Foreground Service,
WorkManager, FCM은 각각 별도 실행 정책을 갖는 호스트 앱의 선택 사항입니다.
macOS 미러링은 계정·기기 연결·사용자 설정에 의존합니다.
[Apple 미러링 안내](https://support.apple.com/en-ie/120684)

## 대체 표시 규칙

기본 정책은 `fallback: "notification"`을 명시한 호출에서만 알림으로 낮춥니다.
`fallback: "none"`이면 요구 기능을 충족하지 못할 때 `UNSUPPORTED_FEATURE`를 반환합니다.
권한 거부를 대체 경로로 우회하지 않습니다. 대체 backend와 잃는 기능을 반환하고,
OS가 승격 여부를 알려주지 않으면 `unknown`으로 유지합니다.
Linux에 표준 진행률 표시가 없거나 macOS에서 조용한 갱신이 검증되지 않았다면
해당 capability를 unsupported/unknown으로 보고합니다.

`fallback: "none"`은 플러그인이 대체 backend를 선택하지 않는다는 정책입니다.
Android의 게시 후 미승격·사용자 강등이나 OS의 표시 억제를 막는 보장이 아닙니다.
승격 요청과 관측된 승격 상태는 별도로 반환하며, 항상 승격된 표시만 유지한다는
요구는 지원하지 않습니다. 상세 형식은 [요청 계약](request-contract.md)을 참고합니다.
