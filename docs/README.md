# 개발 문서

설치와 간단한 예시는 [README](../README.ko.md), 현재 구현의 실행 결과는
[알파 검증 기록](validation.md)을 참고합니다.

| 구현 문서 | 내용 |
| --- | --- |
| [iOS 설정](ios-integration.md) | 공유 모델, Widget Extension, 권한과 종료 정책 |
| [Android 설정](android-integration.md) | 알림 권한, 승격, 상태 복구와 제한 |
| [검증 결과](validation.md) | 테스트·에뮬레이터·패키징 결과 |
| [예제 앱](../examples/demo/README.md) | 실행 방법과 실제 브리지 수명주기 검사 |

## 조사 기록

조사 기준: 2026-11-04. 이 문서의 **제안/계획**은 구현 완료나 실기기 지원 인증을
뜻하지 않습니다. 소스·SDK 버전을 고정하고 네이티브 빌드를 수행할 때 다시 확인합니다.

| 문서 | 내용 |
| --- | --- |
| [개발 환경](development.md) | 실제 설치 상태, 남은 설치, 메모리·디스크 예상 |
| [OS 호환성](compatibility.md) | 버전별 기능, 기기 매트릭스, 표시·수명 제약 |
| [권한](permissions.md) | 사전 설정과 사용자 승인의 구분, 서명·배포 준비 |
| [설계](architecture.md) | 대안 비교, 권장 구조, API 계약, 플랫폼별 어댑터 |
| [검증·배포](testing-and-release.md) | 구현 단계, 호환성 테스트, 릴리스 조건 |
| [참고 자료](references.md) | 공식 문서와 조사한 저장소, 라이선스 관례 |
| [조사 검토](review.md) | 발견한 설계 문제, 반영 내용, 후속 구현과 남은 조건 |
| [요청 계약](request-contract.md) | 실행 가능한 입력 schema·fixture와 검증 책임 |
| [레이아웃 DSL RFC](rfc-layout-dsl.md) | 요청 계약 v2 제안: Tauri에서 위젯 UI 작성(해석기 위젯, 스타일 토큰, 아이콘 채널, 액션) |

초기 테스트 대상은 iPhone XS·iPhone 16·Galaxy Note10·Galaxy S23입니다.
실물 보유 여부, 현재 OS/One UI 버전, 개발자 계정은 아직 확인하지 못했습니다.
범위는 iOS·Android·macOS·Windows·Linux이며, iPad와 Apple의 보조 표시 기기는
별도 검증 대상으로 분리합니다. 네 기기만으로 데스크톱 지원을 인증하지 않습니다.
