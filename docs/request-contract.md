# 요청 계약 v1 초안

상태: `0.1.0-alpha.1`에서 사용하는 요청 입력 명세입니다.
`contracts/request.schema.json`과 `tests/fixtures/requests.json`을 다른 언어의
validator 테스트에도 재사용합니다. `tools/validate-request.mjs`는 개발 전용 기준 구현입니다.

## 형식

테스트 envelope는 `{ "command": "start" | "update" | "end", "input": ... }`입니다.
실제 Tauri start/update/end 명령은 `{ input: ... }`을 받습니다. 알 수 없는 필드, null,
숫자 문자열은 허용하지 않으며 입력을 자동 수정하거나 형 변환하지 않습니다.

| 값 | 규칙 |
| --- | --- |
| activityKey | 1–128자, 영문·숫자로 시작하며 영문·숫자·점·밑줄·콜론·하이픈 허용; 비밀을 포함하지 않는 앱 내부 key |
| id | 플러그인이 돌려준 1–256자 불투명 handle; 경로·URL로 해석하지 않음 |
| schemaVersion | 1 |
| template | progress 또는 timer |
| fallback | none 또는 notification, start에서 명시적으로 필수 |
| revision | 0..9007199254740991 범위의 정수, 문자열 아님 |
| title / status | 각각 1–120 / 1–240 Unicode code point; 공백만 있는 문자열 거부 |
| progress | 유한 숫자 0..1 |
| timer | startedAt, endsAt 모두 필수, endsAt > startedAt |
| 시각 | UTC Unix epoch 밀리초 정수, 0..8640000000000000; 현지 문자열·초 단위 금지 |
| staleAt | 선택적 시각; 과거 값도 허용(이미 stale일 수 있음) |

start는 activityKey, schemaVersion, template, fallback, snapshot을 받습니다.
snapshot은 revision, title, status 및 progress 또는 timer 중 정확히 하나를 포함합니다.
start의 template은 snapshot 형태와 일치해야 합니다. update는 id와 완전한 snapshot을
받으며, 생략 필드가 이전 값과 병합되는 patch가 아닙니다. 기존 활동의 template 변경은
네이티브 상태를 아는 Rust 계층에서 거부합니다.

end는 id, policy를 받습니다. policy는 `{ "kind": "immediate" }`,
`{ "kind": "default" }`, `{ "kind": "after", "at": ... }` 중 하나입니다.
after의 OS별 허용 범위는 네이티브 검증 대상이며 schema 통과만으로 지원을 뜻하지 않습니다.

## 관측·복구 계약 보완

- 승격 결과: `promotionRequested: boolean`과 `promotionState: promoted | notPromoted | unknown | notApplicable`을 분리합니다.
- 기능: supported/unsupported/unknown을 구분합니다. 아직 검증하지 않은 기능은 supported로 취급하지 않습니다.
- 표시: native 호출 성공은 표시 증명이 아닙니다. `visibility: unknown`은 정상적인 결과입니다.
- `fallback: none`은 플러그인이 일반 알림 backend를 대신 선택하지 않는다는 뜻입니다.
  Android가 게시 후 승격하지 않거나 사용자가 강등하는 일을 막지는 못합니다.
  승격만 허용하는 강한 보장이 필요한 요구는 현재 API가 지원하지 않는다고 안내합니다.
- OS 조회가 없는 backend에서는 로컬 기록을 active로 단정하지 않습니다. 요청 이력과
  마지막 관측 결과를 구분합니다. 종료된 handle은 다시 할당하지 않습니다.
- 같은 key의 활성 start는 같은 생성 건을 가리키며 다른 내용의 재요청은 충돌입니다.
  완료 후 명시적인 새 start는 새 handle을 받습니다. 이전 handle로 update해도 새 활동에
  적용되지 않습니다. 알려진 종료 건의 end만 멱등 성공; 알 수 없는 handle은 NOT_FOUND입니다.

동시성·재시작·멱등성은 상태를 가진 Rust/native 계층에서 검증할 사항입니다.
개발용 입력 validator는 수명주기를 구현하지 않으며, 네이티브 테스트에서 별도로 검증합니다.

## 검증 책임과 실행

JSON Schema는 모양·길이·범위·template 매칭을 검증합니다. 기준 도구는 여기에 timer
시각의 순서를 검사합니다. 이 규칙은 Rust·Swift·Kotlin fixture 테스트에도 적용합니다.
상태/속성의 최종 Swift 인코딩 크기, 실제 OS capability·권한, ID 소유권과 revision
이전 값 비교는 네이티브 구현에서 검사합니다. 문자 제한은 4KB 검사의 대안이 아닙니다.

```sh
npm ci
npm test
```

루트 npm 패키지는 TypeScript API이며, Rust crate와 함께 사용합니다. 테스트에는 Unit과
공유 fixture 통합 검증이 포함됩니다. 네이티브 integration/E2E와 각 계층의 coverage는
[검증 결과](validation.md)에 구분해서 기록합니다.
