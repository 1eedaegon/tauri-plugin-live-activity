# 조사 검토와 후속 작업

검토일: 2026-11-04. 조사 작업이 완료된 후 README와 docs 전체, 로컬 도구 상태를
확인했습니다. 아래는 구현 준비 검토이며 플랫폼 지원 승인이나 출시 검증이 아닙니다.

## 판단

공통 수명주기 계약 + OS별 어댑터를 채택합니다. Flutter 런타임을 포함하지 않고
iOS ContentState 직접 전달, Android 표준 알림, 명시적인 데스크톱 대체 경로를
사용하는 방향은 유지합니다. 다음 모호함을 해소한 뒤 네이티브 구현으로 진행합니다.

| 우선순위 | 발견한 문제 | 반영할 계약 |
| --- | --- | --- |
| 높음 | promotion의 requested와 promoted는 동시에 참일 수 있는데 하나의 enum에 혼합됨 | 요청 여부와 관측 상태를 별도 필드로 분리 |
| 높음 | fallback none을 실제 승격·지속 표시의 보장으로 읽을 수 있음 | 플러그인의 대체 선택 정책이며 OS의 나중 강등을 막지 않음을 명시 |
| 높음 | OS가 상태의 기준이라는 설명만으로는 조회 불가능한 portal을 구현할 수 없음 | 저장된 요청 상태와 OS 관측 상태를 분리하고 관측 불가를 unknown으로 유지 |
| 중간 | 숫자·시각·문자열의 wire 형식과 범위가 미정 | revision은 JS 안전 정수, 시각은 UTC epoch 밀리초, 알 수 없는 필드는 거부 |
| 중간 | 멱등 종료와 같은 key 재사용 시 이전 update의 처리 기준이 불명확 | 생성마다 불투명 handle을 사용하고 종료된 handle을 새 활동에 재할당하지 않음 |

근거: [Android의 승격 조회·사용자 해제](https://developer.android.com/develop/ui/views/notifications/live-update),
[portal의 표시 관측 한계](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html),
[Windows 갱신 결과와 사용자 제거](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar).
숫자 범위와 handle 정책은 이 프로젝트의 설계 결정입니다.

## 이번 후속 구현의 범위

Xcode와 Android SDK 없이 실행할 수 있는 **요청 계약 검증 도구**를 먼저 추가했습니다.
이는 공개 플러그인 API나 JS→Rust bridge 구현이 아닙니다. 네이티브 도구 준비와
병행할 수 있는 작업이며 네이티브 spike를 대체하지 않습니다.

- PRD: 호출자가 잘못된 진행률·시간·revision을 전달하면 OS 호출 전에 거부합니다.
- 시스템 설계: JSON Schema와 공유 JSON fixture를 기준으로 언어별 구현을 대조합니다.
- 기술 문서: [요청 계약](request-contract.md)에 형식, 경계, 검증 책임을 정의합니다.
- 재사용: 검증 엔진은 Ajv, 테스트는 Node 기본 runner를 사용합니다. 자체 schema engine을 만들지 않습니다.
- 작업 순서: 실패하는 테스트 → schema/검증 도구 → 통과 및 coverage → 코드·보안 검토.

개발 전용 의존성은 npm lockfile로 고정합니다. 실제 플러그인은 Rust에서 다시 검증해야
하며 Swift의 인코딩 후 4KB 검사도 별도로 필요합니다. fixture 통과는 OS 테스트가 아닙니다.

## 남은 실행 순서

1. Xcode·SDK·NDK 준비, 실기기 OS/One UI 확인, Swift 공유 모듈과 위젯 타깃 spike.
2. 이번 fixture를 Rust validator에 적용하고 IPC 모델·permission 생성 구조 구현.
3. iOS/Android 어댑터와 예제 앱 구현 후 실제 시작→갱신→종료 및 탭 이동 검증.
4. 데스크톱 어댑터는 OS별 호스트에서 별도 검증. 미검증 플랫폼을 지원 완료로 표시하지 않음.
5. 배포용 패키지 점검과 실제 기기 결과가 모인 뒤 릴리스 판단.

이 검토 당시에는 연결 기기·계정이 확인되지 않았고 Xcode/Android SDK도 없었습니다.
후속 환경 준비에서 도구 설치와 최소 네이티브 라이브러리 빌드를 확인했습니다.
최신 설치·서명·기기 상태는 [개발 환경](development.md)을 기준으로 합니다.
플러그인 기기 E2E 결과를 계약 테스트 통과로 대체하지 않습니다.

## 검증 결과

- TDD: 검증 모듈이 없는 상태에서 테스트 실패를 확인한 뒤 구현했습니다.
- Node 26.12.1 및 선언한 최소 Node 22.12.0에서 50개 테스트 통과.
- 개발용 `tools/validate-request.mjs` 줄·분기·함수 coverage 각각 100%.
  JSON Schema, Ajv 생성 코드, 미구현 Rust/Swift/Kotlin·OS 동작의 coverage를 뜻하지 않습니다.
- Markdown 11개 문서의 로컬 링크 검사 통과. 개발 의존성 설치 시 npm audit 0건.
- 코드·보안 검토: 입력 강제 변환/수정 없음, 알 수 없는 필드 거부, 오류에 입력값 노출 없음,
  외부 명령·경로·네트워크를 입력으로 실행하지 않음. 검토 범위에서 CRITICAL/HIGH 문제 없음.
- 네이티브 integration/E2E·실기기 테스트·패키지 배포는 미실행입니다.
