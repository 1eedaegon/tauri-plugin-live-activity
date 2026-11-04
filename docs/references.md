# 조사 자료와 관례

조사일: 2026-11-04. 온라인 문서와 main/v2 브랜치는 변경될 수 있으므로 구현 시 SDK와
dependency 버전을 고정하고 다시 확인합니다. 외부 코드는 이번 작업에서 복사하지 않았으며
문서 구조와 설계 판단의 참고 자료로 사용했습니다.

## Tauri 저장소 관례

GitHub의 `tauri-plugin in:name` 별점순 검색으로 널리 사용되는 프로젝트를 살펴본 뒤,
현재 Tauri v2 공식 workspace와 관련성이 높은 플러그인을 중심으로 비교했습니다.
검색은 모든 플러그인의 절대 인기 순위를 보장하지 않습니다. 구형 standalone 저장소의
설정을 현재 Tauri v2 관례로 그대로 사용하지 않았습니다.

| 자료 | 참고 내용 |
| --- | --- |
| [공식 notification README](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/plugins/notification/README.md) | 지원 표, Rust core/JS binding 설치, capability, 사용법, 기여·라이선스 순서 |
| [공식 store README](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/plugins/store/README.md) | 간결한 설명과 설치/사용 문서 구조 |
| [공식 .gitignore](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/.gitignore) | Rust/JS 산출물, 예제 캐시, 환경·에디터 파일 제외 |
| [공식 Cargo workspace](https://github.com/tauri-apps/plugins-workspace/blob/cd94082746d897c7bcc3d5b1b6b737b209a0e7c9/Cargo.toml) | workspace.package.license = Apache-2.0 OR MIT 확인 |
| [tauri-plugin-decorum](https://github.com/clearlysid/tauri-plugin-decorum/tree/ea72a1f9d1f28f0ca6ea59fe5f6b5ab6c7293faf) | 커뮤니티 플러그인의 간결한 README, 예제 앱 중심 안내, ignore 구성 |

공식 workspace와 decorum은 일부 lockfile을 무시하지만, 이 프로젝트는 모바일·데스크톱
소비자 예제의 재현 가능한 검증을 위해 lockfile을 보존하는 방침입니다. 생성된 native
프로젝트 전체를 무시하지 않아 위젯 타깃·서명 설정의 비밀이 아닌 부분·Gradle wrapper를
검토할 수 있게 합니다. signing private key와 로컬 경로 파일은 별도로 제외합니다.

README에 아직 없는 npm/crates.io 배지, 설치 명령, 성공한 CI·플랫폼 지원 표시는 넣지
않았습니다. LICENSE는 선택권 안내, LICENSE-APACHE와 LICENSE-MIT는 전문입니다.
향후 제3자 코드를 가져오면 그 코드의 고지·라이선스 조건은 별도 보존합니다.

## 설계 근거

| 공식/작성자 자료 | 사용한 판단 |
| --- | --- |
| [Tauri 모바일 플러그인](https://v2.tauri.app/develop/plugins/develop-mobile/) | Rust와 Swift/Kotlin의 공식 bridge 구조 |
| [Tauri 플러그인 개발](https://v2.tauri.app/develop/plugins/) | 패키지 구조, command permissions, 플랫폼 metadata |
| [Tauri capabilities](https://v2.tauri.app/security/capabilities/) | frontend 명령 허용과 OS 권한의 분리 |
| [Flutter live_activities 패키지](https://pub.dev/packages/live_activities) | 네이티브 Widget Extension·App Groups 통합 사례 |
| [Flutter 참고 소스](https://github.com/istornz/flutter_live_activities/tree/663fe5ec3505edba7641cf9c6c4352cf7e124937) | Swift UserDefaults/ContentState 전달, Kotlin 알림 관리자 구조 |
| [Apple ActivityKit 가이드](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) | 직접 상태 전달, UI 확장, 수명·크기 제약 |
| [Apple 권한 상태](https://developer.apple.com/documentation/activitykit/activityauthorizationinfo) | 활동 허용 상태와 빈번한 업데이트 허용 조회 |
| [Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update) | 표준 스타일, 승격 조건, OEM 차이, RemoteViews 제한 |
| [Android 알림 권한](https://developer.android.com/develop/ui/views/notifications/notification-permission) | API 33+ runtime permission |
| [Windows 진행 알림](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-progress-bar) | 데이터 binding 기반 상태 갱신 |
| [freedesktop 알림 명세](https://specifications.freedesktop.org/notification/latest-single/) | replaces_id, 서버 capabilities, persistence 차이 |
| [XDG Notification portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Notification.html) | sandbox에서 알림 게시·교체·삭제 |
| [Mac의 iPhone Live Activity](https://support.apple.com/en-ie/120684) | macOS 독립 구현과 iPhone 미러링의 구분 |

GitHub에서 `tauri live activity`, `tauri-plugin-live`, `ActivityKit tauri`를 검색했으나
이 조사 범위에서 그대로 채택할 검증된 멀티플랫폼 구현은 확인하지 못했습니다.
이는 다른 구현이 존재하지 않는다는 뜻이 아닙니다. 기존 notification 기반 코드의
재사용 범위와 각 native dependency는 실제 구현 전에 추가 검증합니다.
