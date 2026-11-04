# 구현·검증·배포 계획

현재 네이티브 플러그인 소스와 예제 앱은 없습니다. 공통 요청의 schema·fixture·개발용
validator는 추가되어 `npm ci && npm test`로 실행할 수 있습니다. 이는 OS 호출 전 입력
계약의 검증이며 아래 네이티브 완료 조건의 통과 결과가 아닙니다.
[요청 계약](request-contract.md)과 [검토 기록](review.md)을 참고하세요.

## 구현 순서

1. **환경 및 호환성 spike**: Xcode/SDK/NDK 설치, 계정·기기 연결, OS 버전 기록.
   Swift 모델 공유와 위젯 embed, Android 알림·승격, desktop 갱신 API를 검증합니다.
2. **계약 설계와 테스트**: 모델·capability·오류·권한·직렬화 fixture를 먼저 작성합니다.
   실패하는 테스트 확인 후 최소 구현을 추가합니다. 버전과 package manager를 고정합니다.
   SDK 없이 가능한 입력 schema/fixture 검증은 1단계 환경 준비와 병행합니다.
3. **모바일 MVP**: start/update/end/list, iOS 위젯 템플릿, Android 일반 알림 및
   Live Updates 분기, 최소 권한, 예제 앱을 구현합니다.
4. **데스크톱 어댑터**: macOS/Windows/Linux에 같은 계약을 적용합니다.
   지원하지 못하는 기능은 capability로 알리고 compile-only 성공과 runtime 지원을 분리합니다.
5. **복구·성능**: 권한 철회, process death, 재실행, 중복/역순 갱신, 메모리·전력 측정.
6. **패키징·문서·릴리스**: 깨끗한 소비자 앱에서 패키지를 설치해 모든 주장된 플랫폼을 검증합니다.

## 테스트 범위

| 종류 | 필수 시나리오 |
| --- | --- |
| Unit | payload 경계, enum/시간 직렬화, revision 비교, fallback 선택, ID namespace, 오류 매핑 |
| Integration | JS→Rust→Swift/Kotlin/desktop 왕복, Tauri 명령 권한 거부, native 에러 전달 |
| E2E | 시작→갱신→종료, 실제 표시 확인, 알림 탭으로 앱 열기, 사용자 제거 후 재등장 방지 |
| 호환성 | 최소 OS 분기, 최신 OS, unsupported 호출, Android 채널 차단·승격 거부, desktop backend 부재 |
| 복구 | 앱 background/suspended/종료/재실행, OS 재부팅, 이벤트 구독 재연결, 로컬 매핑 불일치 |
| 동시성 | 중복 시작, 같은 revision 충돌, 역순 갱신, update/end 경합, 여러 활동의 독립성 |
| 패키징 | Cargo/npm 포함 파일, Swift/Kotlin source와 권한 포함, widget integration, secret 제외 |

관리 대상 로직의 테스트 커버리지는 80% 이상을 목표로 측정하고 Rust/JS/native 결과를
각각 기록합니다. OS UI는 coverage 수치로 대체하지 않습니다. 자동화하기 어려운 검증은
수동 절차·OS/모델·빌드 버전·실제 결과를 기록합니다. 생성/외부 코드를 제외한 이유도 명시합니다.

테스트 결과에는 날짜, 앱 revision, OS/build, 모델, backend, 권한/채널 상태,
요청/실제 승격 결과, 재현 절차를 기록합니다. 기기 serial, 인증서, 토큰은 남기지 않습니다.
초기 모바일 네 기기 외에 Windows 및 Linux GNOME/KDE 테스트 환경이 필요합니다.
구형 API 경계는 별도 simulator/emulator로 보완하되 실물 OEM 검증을 대체하지 않습니다.

## 메모리 측정

같은 release 예제 앱에서 플러그인 미사용, 유휴, 활동 1개, 활동 여러 개,
연속 생성/종료 이후를 비교합니다. JS heap뿐 아니라 앱 native 메모리와 iOS 확장
프로세스도 구분합니다. Xcode Instruments, Android Studio Profiler와 각 desktop
도구로 peak/steady-state 및 종료 후 회수를 측정합니다. 앱 전체와 플러그인 증분을
섞지 않고 샘플 payload·반복 횟수·업데이트 빈도·OS·측정 도구를 함께 기록합니다.

## 라이브러리 릴리스 조건

- 주장하는 플랫폼별 빌드·런타임 테스트 통과, 미검증 항목 명시.
- 코드·보안 리뷰와 관련 테스트 완료. 권한 및 최소 OS 안내가 실제 패키지와 일치.
- npm/crates.io 이름과 게시 권한 확인, 버전·호환성 표·변경 기록 작성.
- Cargo/npm manifest의 `license`를 `Apache-2.0 OR MIT`로 지정하고 라이선스 전문 포함.
- package dry-run/파일 목록 검사 후 깨끗한 소비자 앱에서 설치·빌드.
- CI secret 또는 지원되는 trusted publishing 구성, 토큰 저장소 커밋 금지.

실제 패키지는 루트 Cargo.toml과 package.json, 예제는 examples/demo에 있습니다.
CI는 .github/workflows/ci.yml에서 실행합니다. 사용자 요청에 따라 첫 알파 검증 후
crates.io와 npm에 게시하며, 결과는 [검증 기록](validation.md)에 남깁니다.

## 앱 배포와의 구분

플러그인 레지스트리 공개와 샘플 앱의 App Store/Google Play 배포는 별도 절차입니다.
서명된 APK의 테스트 기기 설치는 가능하지만, iOS 서명과 TestFlight/스토어 심사,
Play 계정별 테스트 조건은 로컬 테스트 통과만으로 생략되지 않습니다.
계정 조건은 [권한 문서](permissions.md)의 공식 자료에서 배포 직전에 재확인합니다.

macOS 앱은 배포 방식에 맞는 서명·notarization, Windows 앱은 설치·서명·activation,
Linux 앱은 배포 형식과 desktop ID/portal 설정을 검증해야 합니다.
