# OS별 지원과 검증 범위

조사 기준: 2026-11-04. OS가 제공하는 기능, 플러그인이 구현한 기능,
실제로 실행한 테스트는 각각 구분합니다. 세부 결과는 [검증 기록](validation.md)에 남깁니다.

| 실행 플랫폼 | 현재 구현 | 검증 범위와 남은 확인 |
| --- | --- | --- |
| iPhone / iOS 16.1+ | ActivityKit 진행률·타이머, 시작·갱신·종료·재조회 | iOS 27.2 시뮬레이터 실행. 16.1/16.2는 availability 분기와 빌드 검사이며 구형 OS 실기기 실행은 미검증 |
| iPadOS 17+ | ActivityKit 진행률·타이머; iPadOS 16.x는 미지원 | iPadOS 27.2 시뮬레이터에서 lifecycle 13개와 추가 기능 10개 통과. 구형 OS는 정책 단위 테스트 |
| Android API 24–32 | 진행률·타이머 지속 알림 | API 31 에뮬레이터 실행. API 24 최소 버전은 빌드·lint 검사 |
| Android API 33–35 | 위 기능 + 알림 런타임 권한 | 권한 요청·거부·취소 및 채널 차단은 API 36/37에서 검사. API 33–35 런타임은 미검증 |
| Android API 36+ | 적격 알림의 Live Update 승격 요청, 불가하면 명시적 대체 | API 37 승격 플래그 관찰. API 36 에뮬레이터는 승격 불허 상태에서 일반 알림 대체 확인. 두 버전의 실제 권한 창 검사 통과 |
| macOS | 명시적 미지원 | 호스트 Tauri IPC가 미지원 기능을 광고하지 않고 안정적인 오류를 반환하는지 검사 |
| Windows / Linux | 명시적 미지원 | 각 OS의 CI에서 동일한 Tauri IPC 계약 통과. 네이티브 알림 UI 구현·검증은 포함하지 않음 |

## Apple의 보조 화면

ActivityKit은 iPhone에서 만든 활동을 Apple Watch, Mac, CarPlay 등의 화면에도
표시할 수 있습니다. 이것이 해당 OS에서 이 Tauri 플러그인을 직접 실행하는 기능은
아닙니다. Mac의 iPhone 활동 표시는 iPhone Mirroring 연결과 사용자 설정에 의존합니다.
현재 시뮬레이터 결과만으로 이 화면들의 전달·상호작용을 보장하지 않습니다.
[ActivityKit](https://developer.apple.com/documentation/activitykit),
[Apple의 Mac 표시 안내](https://support.apple.com/en-ie/120684).

## Android에서 구분할 것

OS 버전이 높아도 승격을 보장하지 않습니다. 알림 권한, 채널 중요도, 알림의 형식,
사용자의 승격 설정과 실제 OS 관찰 결과를 함께 확인해야 합니다. 일반 지속 알림을
Live Update 성공으로 기록하지 않습니다. 에뮬레이터의 승격 결과는 Samsung One UI의
Now Bar 검증이 아닙니다.
[Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update).

## 데스크톱의 다른 API

Windows는 데이터 바인딩으로 갱신하는 진행률 알림 API가 있지만 이 플러그인의
현재 backend에는 구현하지 않았습니다.
[Windows 진행률 알림](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar).

Linux의 freedesktop 알림과 XDG Notification portal은 같은 ID로 알림을 교체할 수
있습니다. 표시 방식과 기능은 알림 서버에 달려 있고, portal은 사용자에게 실제로
표시됐는지 알려주지 않습니다. 이 역시 현재 구현된 backend가 아닙니다.
[freedesktop 명세](https://specifications.freedesktop.org/notification/latest-single/),
[XDG Notification portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html).

## 이번 보강의 검증 범위

- npm·Cargo 레지스트리의 alpha.1 패키지 두 개를 실제 Tauri 앱에 연결해 실행; alpha.2의 두 레지스트리 조합은 npm 게시 후 재검증
- 진행률 외에 타이머·stale 시점·종료 정책·재시작과 동시 요청 검사
- Android 권한 창 취소, 채널 중요도 변경과 승격 허용/불허 상태 검사
- macOS·Windows·Linux의 기능 조회 및 허가된 IPC 호출에 대한 미지원 오류 검사
- Mochi 간식 배달·낮잠 데모를 앱과 실제 OS 표면에서 촬영

실제 테스트 결과가 없는 기기·OS·표면은 지원 완료로 표시하지 않습니다.

Windows와 Linux의 계약 테스트는
[최종 소스 CI 실행](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/runs/41894264762)의
각 Desktop contract 작업에서 통과했습니다. macOS는 같은 테스트를 로컬에서 실행했습니다.
