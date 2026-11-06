# tauri-plugin-live-activity

[![npm](https://img.shields.io/npm/v/tauri-plugin-live-activity/next)](https://www.npmjs.com/package/tauri-plugin-live-activity)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-live-activity)](https://crates.io/crates/tauri-plugin-live-activity)
[![CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml)

Tauri 2에서 iOS Live Activities(ActivityKit·Dynamic Island)와 Android Live Updates를 표시하는 커뮤니티 플러그인입니다.
Android에서는 지원 조건에 따라 일반 진행 알림으로 표시합니다.
**초기 알파 버전입니다.** [English](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/README.md)

| 플랫폼 | 표시 방식 |
| --- | --- |
| iOS 16.1+ / iPadOS 17+ | ActivityKit · 잠금 화면 / 지원 기기의 Dynamic Island |
| Android API 26+ | 진행 알림 · API 36+에서 조건 충족 시 Live Update 승격 |
| macOS / Windows / Linux | 미구현 |

<table>
  <tr><th>Mochi 데모</th><th>iOS Live Activity</th><th>Android Live Update</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-demo.png" width="240" alt="고양이 Mochi의 간식 배달을 보여 주는 Tauri 데모 앱"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-ios-live-activity.png" width="240" alt="iPhone 잠금 화면의 Mochi 간식 배달과 낮잠 타이머"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-android-live-activity.png" width="240" alt="Mochi의 간식 배달 진행률을 표시한 Android 알림"></td>
  </tr>
</table>

iOS 27.2 시뮬레이터와 Android API 37 에뮬레이터에서 직접 캡처했습니다.
예제 앱이 전달한 간식 배달 진행률과 낮잠 시간을 실제 네이티브 UI로 표시한 화면입니다.
[Dynamic Island 화면](https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-ios-dynamic-island.png)도 확인할 수 있습니다.
구형 Android에서는 같은 예제가 [일반 진행 알림](https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/mochi-android-notification-fallback.png)으로 표시됩니다.

## 설치

Tauri 2와 Rust 1.90 이상이 필요합니다.
Android는 API 26 이상과 업데이트된 WebView가 필요하며, 빌드에는 Android SDK 37을 사용합니다.
기능별 OS 조건과 도구 버전은 [호환성 정책](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/compatibility.md)에 정리했습니다.

```sh
npm install tauri-plugin-live-activity@next
```

`src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-live-activity = "=0.1.0-alpha.4"
```

Tauri 빌더에 등록합니다.

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
    // ...
```

앱 capability의 `permissions`에 추가합니다.

```json
[
  "live-activity:default",
  "live-activity:allow-request-permissions",
  "live-activity:allow-start",
  "live-activity:allow-update",
  "live-activity:allow-end"
]
```

**iOS는 Widget Extension 설정이 필요합니다.**
[iOS 설정](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-integration.md) ·
[Android 설정](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md)

## 사용 예시

```ts
import { start, update, end } from 'tauri-plugin-live-activity';

// 먼저 Android 알림 권한 또는 iOS Live Activity 설정을 확인합니다.
const snack = await start({
  activityKey: 'mochi:snack',
  schemaVersion: 1,
  template: 'progress',
  fallback: 'notification',
  snapshot: {
    revision: 0, title: 'Mochi의 간식 배달', status: '작은 간식을 포장하는 중', progress: 0.15,
  },
});

await update({
  id: snack.id,
  snapshot: {
    revision: 1, title: 'Mochi의 간식 배달', status: 'Mochi에게 가는 중', progress: 0.65,
  },
});

await end({ id: snack.id, policy: { kind: 'immediate' } });
```

갱신할 때는 `revision`을 늘리고 전체 snapshot을 보냅니다.
재실행 후에는 `list()`로 상태를 다시 조회합니다. 타이머는 `template: 'timer'`와
`timer: { startedAt, endsAt }`을 사용하며, 시각 단위는 Unix 밀리초입니다.

플러그인은 상태를 표시하고, 레이아웃에서는 버튼 탭을 앱에 전달합니다. 실제 작업과
백그라운드 실행은 호스트 앱이 담당합니다. 알림 표시와 승격 여부는 OS 설정에 따라 달라집니다.

[실행 가능한 예제](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo) ·
[검증 결과](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/validation.md) ·
[OS별 지원 범위](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/platform-coverage.md)

## 레이아웃 (미출시)

요청 계약 v2는 `main`에만 있으며 0.1.0-alpha.4에는 들어 있지 않습니다.

레이아웃을 쓰면 `progress`나 `timer` 템플릿을 고르는 대신 앱이 화면을 직접 구성합니다.
앱은 노드 트리(스택, 텍스트, SF Symbol, 이미지, 경로, 진행 표시, 게이지, 타이머, 버튼)와
스타일 표, 값 맵을 보냅니다. iOS에서는 플러그인의 위젯 템플릿이 트리를 그리므로 앱에서
SwiftUI 코드를 따로 작성할 필요가 없습니다. 트리는 시작할 때 고정되고, 갱신할 때는 값만
바꿉니다. 레이아웃·스타일·값은 ActivityKit의 4 KiB 한도를 함께 씁니다. 노드와 스타일,
각종 한도는 [요청 계약](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/request-contract.md#request-contract-v2-layout)에 정리했습니다.

레이아웃 명령 권한도 추가합니다.

```json
[
  "live-activity:allow-start-layout",
  "live-activity:allow-update-layout",
  "live-activity:allow-end-layout"
]
```

`list_layout`은 `live-activity:default`에 이미 들어 있습니다. `onAction`은 Tauri 이벤트
권한(`core:event:default`)을 사용합니다.

```ts
import {
  layout, startLayout, updateLayout, endLayout, onAction,
} from 'tauri-plugin-live-activity';

const { vstack, hstack, symbol, bound, progress, button, text } = layout;

const nap = await startLayout({
  activityKey: 'mochi:nap',
  schemaVersion: 2,
  fallback: 'notification',
  layout: {
    lockScreen: vstack([
      hstack([symbol('moon.zzz.fill'), bound('title', { style: 'title' })], { spacing: 8 }),
      bound('status'),
      progress('sleep'),
      button('wake', text('Mochi 깨우기')),
    ], { alignment: 'leading' }),
  },
  styles: { title: { font: 'headline' } },
  snapshot: { revision: 0, values: { title: 'Mochi의 낮잠', status: '꾸벅꾸벅 조는 중', sleep: 0.2 } },
});

await updateLayout({
  id: nap.id,
  snapshot: { revision: 1, values: { title: 'Mochi의 낮잠', status: '깊이 자는 중', sleep: 0.6 } },
});

await onAction(async ({ actionId, activityId }) => {
  if (actionId === 'wake') await endLayout({ id: activityId, policy: { kind: 'immediate' } });
});
```

갱신할 때는 시작할 때의 키와 값 타입을 그대로 유지합니다. 재실행 후에는 `listLayout()`으로
레이아웃 활동을 다시 조회합니다. 템플릿 활동과 레이아웃 활동은 서로 분리되어 있어서,
`list()`는 템플릿 활동만 돌려주고 레이아웃 id로 `update`나 `end`를 호출하면 `NOT_FOUND`가 됩니다.

### iOS 위젯

레이아웃을 쓰려면 [iOS 설정](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-integration.md#add-the-widget)대로
플러그인 템플릿으로 위젯 확장을 만들어야 합니다. 확장에는 `LiveActivityShared`와
`LiveActivityUI` 제품을 링크하고, Info.plist의 `TauriLiveActivityLayout` = `2`를 유지합니다.
`templates/ios/Info.plist`에는 이 값이 이미 들어 있습니다. 버튼을 쓰려면
`templates/ios/LiveActivityActionIntent.swift`를 위젯 확장과 앱 타깃 양쪽에 추가하고, 타입
이름은 바꾸지 않습니다. 위젯은 이 파일로 버튼을 만들고, 시스템은 인텐트를 앱 프로세스에서
실행하므로 앱에도 같은 파일이 필요합니다.

### 버튼

`button` 노드를 탭하면 Rust의 `on_action` 핸들러가 먼저 실행되고, 이어서 `onAction`이 받는
`live-activity://action` 이벤트가 발생합니다. 이벤트에는 `actionId`와 `activityId`가 들어
있고, 플러그인이 해당 활동을 알고 있으면 `activityKey`도 들어 있습니다. 탭만으로는 활동이
바뀌지 않으니 핸들러에서 갱신하거나 종료합니다.

시스템이 탭을 처리하려고 앱을 백그라운드에서 실행할 수도 있습니다. 이때 Tauri는 `setup`을
실행하지 않거나 웹뷰를 만들지 않을 수 있어서 `onAction`이 탭을 받지 못합니다. 이런 탭은
Rust에서 처리합니다. 빌드한 `App`에 `run` 전에 핸들러를 등록합니다.

```rust
use tauri_plugin_live_activity::{EndInput, EndPolicy, LiveActivityExt};

let app = tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
let handle = app.handle().clone();
app.live_activity().on_action(move |event| {
    if event.action_id == "wake" {
        let input = EndInput { id: event.activity_id, policy: EndPolicy::Immediate {} };
        let _ = handle.live_activity().end_layout(input);
    }
});
app.run(|_, _| {});
```

핸들러는 메인 스레드가 아닌 플러그인 스레드에서 실행되므로 핸들러 안에서 플러그인을 호출해도
됩니다. iOS에서 버튼은 iOS 17 이상에서 동작하며(`getCapabilities()`의 `actions`), 인텐트는
핸들러가 끝날 때까지 최대 4초 기다립니다. Android에서 종료된 프로세스를 다시 띄운 탭은
메모리에서 기다리다가, 그 프로세스에서 Tauri 런타임이 시작되지 않으면 사라집니다.

### Android

알림은 레이아웃을 그릴 수 없어서 Android는 잠금 화면 트리의 일부만 보여 줍니다. 첫 번째
`text`는 제목, 두 번째는 본문이 되고, 첫 번째 `progress`와 `timerText`는 진행 막대와
크로노미터가 됩니다. `button`은 세 개까지 알림 액션이 되며, 버튼 안의 첫 텍스트가 라벨이
됩니다. 표시하지 못한 요소는 `degradedFeatures`에 남깁니다. 위 예시라면 `layout.symbol`과
`layout.styles`가 들어갑니다. 시작 요청의 `android: { visibility }`로 잠금 화면 공개 범위를
정합니다. 자세한 내용은 [Android 설정](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md#layout-activities-contract-v2)에 있습니다.

### Samsung Now Bar

One UI는 Samsung의 허용 목록에 패키지가 있거나, 사용자가 개발자 옵션 "Live notifications for
all apps"를 켠 경우에만 앱의 승격된 알림을 Now Bar에 표시합니다. 허용 목록은 One UI에
내장되어 있고 Samsung 서버에서 갱신됩니다. 목록에 넣을 앱은 Samsung이 비공개로 승인하며,
공개된 신청 경로는 찾지 못했습니다. 설정의 Now bar 화면에는 허용 목록에 있는 앱만 나옵니다.
Samsung의 `RON` 플래그가 붙은 항목은 바로 나오고, 그 밖의 항목은 앱이 매니페스트 메타데이터
`com.samsung.android.support.ongoing_activity` = `true`도 선언해야 나옵니다. 메타데이터만으로는
목록에 나오지 않으며, 플러그인은 이 메타데이터를 추가하지 않습니다.

`android.samsungNowBar` 옵션을 켜면 Android 17 이상에서 레이아웃 알림에 One UI의 텍스트
extra를 붙입니다. 개발자 옵션이 켜져 있으면 Now Bar의 두 줄에 제목과 본문(본문이 없으면 상태
칩 텍스트)이 표시됩니다. 이 옵션을 켠다고 허용 목록에 오르지는 않습니다. Galaxy S23(One UI 9)에서
측정한 결과이며, 자세한 내용은 [Samsung Now Bar](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md#samsung-now-bar)에 있습니다.

## 플러그인 설정 (미출시)

`tauri.conf.json`의 `plugins.live-activity`는 생략해도 됩니다.

```json
{ "plugins": { "live-activity": { "receipts": "redacted", "android": { "samsungNowBar": true } } } }
```

- `receipts`: iOS는 수락한 요청마다 기록(receipt)을 남겨, 재실행 후에도 늦게 도착한
  ActivityKit 조회 결과가 이전 revision을 되살리지 못하게 합니다. 기본값 `full`은 snapshot과
  그 텍스트를 저장합니다. `redacted`는 snapshot의 SHA-256 digest만 저장하는데, digest는 추측할
  수 없는 값만 가려 줍니다. 템플릿 활동과 레이아웃 활동 모두에 적용됩니다. Android는 아직 이
  옵션을 무시하고 앱 전용 preferences에 기록 전체를 저장합니다.
  자세한 내용은 [Receipts](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-integration.md#receipts)에 있습니다.
- `android.samsungNowBar`: [Samsung Now Bar](#samsung-now-bar)의 extra를 붙입니다. 생략하면 꺼져 있습니다.

## 라이선스

[MIT](LICENSE-MIT) 또는 [Apache-2.0](LICENSE-APACHE).
