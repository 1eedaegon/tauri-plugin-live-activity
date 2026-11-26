# tauri-plugin-live-activity

[![npm](https://img.shields.io/npm/v/tauri-plugin-live-activity)](https://www.npmjs.com/package/tauri-plugin-live-activity)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-live-activity)](https://crates.io/crates/tauri-plugin-live-activity)
[![CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

**Tauri 2용 iOS Live Activities와 Android Live Updates.** Tauri 2 앱이 하고 있는 일을 iPhone 잠금 화면과
Dynamic Island(ActivityKit)에, Android에서는 Live Update나 진행 중 알림으로 보여 줍니다. 레이아웃은 TSX,
TypeScript 또는 Rust로 적고, 그리는 일은 플러그인이 [liveactivity-rs](https://github.com/1eedaegon/liveactivity-rs)
브리지를 통해 맡습니다.
[English](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/README.md) ·
[사이트](https://1eedaegon.github.io/tauri-plugin-live-activity/ko/)

<table>
  <tr><th>iOS 잠금 화면</th><th>Dynamic Island</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-paths.png" width="400" alt="iOS 잠금 화면에 SVG 패스로 그린 Mochi의 얼굴"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-expanded.png" width="400" alt="펼친 Dynamic Island에 보이는 Mochi의 간식"></td>
  </tr>
  <tr><th>Android 알림</th><th>Samsung Now Bar</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-android.png" width="400" alt="진행률 막대와 Wake Mochi 동작이 있는 Android 알림으로 보이는 Mochi의 낮잠"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/samsung-now-bar.png" width="400" alt="잠긴 Galaxy S23의 One UI Now Bar에 보이는 Mochi의 간식 배달"></td>
  </tr>
</table>

데모가 도는 모습입니다. iPhone 17 Pro 시뮬레이터와 Android 16 에뮬레이터에서 녹화했습니다:

<table>
  <tr><th>iOS: 잠금 화면의 간식 배달과 낮잠 타이머</th><th>iOS: 갱신으로 바뀌는 바인딩된 스타일</th><th>Android: 같은 요청이 잠금 화면의 알림으로</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-demo.gif" width="250" alt="데모가 Mochi의 간식을 출발시키면 잠금 화면에 진행률 막대가 있는 카드가 뜨고(처음에는 시스템의 허용 질문과 함께), 이어서 낮잠을 시작하면 그 카드의 타이머가 줄어듭니다"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-styles.gif" width="250" alt="데모가 새 값을 보내면 잠금 화면 카드의 상태가 빨갛고 굵게 바뀝니다"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-snack.gif" width="250" alt="데모가 Mochi의 간식 배달을 시작하고, 폰을 잠그면 잠금 화면에 알림이 보이며 갱신마다 진행률 막대가 움직이고, 밀어서 풀면 배달이 끝납니다"></td>
  </tr>
</table>

데모가 도는 동안 카드의 TSX를 고치는 모습입니다. 값을 바꾸면 활동이 그 자리에서 갱신되고, 레이아웃이나 스타일을
바꾸면 활동이 다시 시작됩니다([실시간 편집](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/live-editing.md)):

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/live-editing.gif" width="800" alt="왼쪽은 iPhone 17 Pro 시뮬레이터의 화면 녹화로, 데모 위로 끌어내린 잠금 화면과 Mochi의 카드입니다. 오른쪽은 저장 기록으로 그린 편집기 화면의 card.tsx입니다. 값을 저장하면 상태 문구, 남은 시간, 진행률 막대가 그 자리에서 바뀌고, 발바닥을 자전거로 바꾸거나 제목을 키워 저장하면 카드가 사라졌다가 바뀐 모습으로 다시 뜹니다.">

모두 고양이 Mochi를 따라가는 [데모 앱](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo)에서
캡처했습니다.

## 지원 버전

요약하면 iOS 16.1 이상, Android 8 이상에서 동작하고, 데스크톱에는 활동이 없습니다.

| 어디서 | 최소 버전 | 무엇이 되나 |
| --- | --- | --- |
| iPhone | iOS 16.1 | 잠금 화면의 Live Activity, Dynamic Island가 있는 iPhone에서는 Dynamic Island에도. 오래된 표시(stale)와 relevance는 iOS 16.2부터, 버튼·토글·push-to-start는 iOS 17.2부터 |
| iPad | iPadOS 17 | 잠금 화면의 같은 Live Activity |
| Apple Watch | iOS 18과 watchOS 11 | 레이아웃의 `small` 영역이 워치의 Smart Stack에 |
| Android | Android 8.0 (API 26) | 진행률 막대나 타이머, 동작 최대 세 개가 있는 진행 중 알림. 알림 권한은 Android 13 (API 33)부터 묻습니다 |
| Android Live Updates | Android 16 (API 36) | 시스템과 사용자 설정이 허락하면 승격된 Live Update, 아니면 진행 중 알림 |
| Samsung Now Bar | Android 17 (API 37), One UI 9 | One UI의 Now Bar가 보여 주는 제목과 본문. Samsung의 허용 목록에 있는 앱만 |
| macOS, Windows, Linux | 지원 안 함 | 활동이 없고, 활동 명령은 `UNSUPPORTED_PLATFORM`을 돌려줍니다 |

플러그인에는 Tauri 2와 Rust 1.90 이상이 필요합니다. `setup`은 위젯 확장의 배포 대상을 iOS 16.1로, Android
`minSdk`를 26으로 맞춥니다. 기능마다의 최소 버전은
[OS 호환성](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/compatibility.md)에 있습니다.

## 동작 구조

플러그인은 크레이트 네 개 중 Tauri 쪽입니다. Tauri의 명령, 이벤트, 권한과 `setup` 명령을 맡습니다.
[liveactivity-rs](https://github.com/1eedaegon/liveactivity-rs) 브리지(`liveactivity` 크레이트)가 요청 계약과 그
검사, 수명 주기를 맡아 각 요청을 플랫폼의 백엔드에서 돌립니다:

```text
Tauri 2 앱                    TSX, TypeScript 또는 Rust로 적은 레이아웃
  │  시작 · 갱신 · 종료 · 이벤트
  ▼
tauri-plugin-live-activity   Tauri 명령, 이벤트, 권한, setup
  │
  ▼
liveactivity                 liveactivity-rs 브리지: 하나의 요청 계약,
  │                          그 검사, 수명 주기
  ├─ iOS 16.1+ ────────────► activitykit (activitykit-rs)
  │                          Swift 브리지로 부르는 ActivityKit, 앱의 위젯
  │                          확장이 그림: 잠금 화면, Dynamic Island
  └─ Android 8.0+ ─────────► liveupdate (liveupdate-rs)
                             진행 중 알림, Android 16부터 Live Update
```

플러그인 자체의 Swift 코드는 없고, Kotlin은 권한 명령과 liveupdate의 Android 어댑터 호출만 맡습니다. 플러그인
아래의 백엔드는 바꾸거나 층으로 감쌀 수 있습니다: [직접 만든 백엔드](#직접-만든-백엔드).
[iOS 설정](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/ios-integration.md)과
[Android 설정](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md)이
`setup`이 각 프로젝트에서 바꾸는 것을 보여 줍니다.

## 설치

Tauri 2 앱 폴더에서:

```sh
cargo add tauri-plugin-live-activity --manifest-path src-tauri/Cargo.toml
npm i tauri-plugin-live-activity
npx tauri-plugin-live-activity setup
```

그다음 `src-tauri/src/lib.rs`의 빌더에 플러그인을 등록합니다:

```rust
.plugin(tauri_plugin_live_activity::init())
```

`setup`은 플러그인 권한을 허용하고, Android 최소 버전을 API 26으로 올리고, Mac에서는 액티비티를 그리는
위젯 확장을 Xcode 프로젝트에 추가합니다. `tauri ios init` 뒤에 실행하고, `src-tauri/gen/apple`을 새로
만들 때마다 다시 실행합니다. `--dry-run`은 바꿀 내용만 보여 줍니다.

## React와 TSX

레이아웃은 `tauri-plugin-live-activity/jsx`의 컴포넌트로 짠 트리입니다. 이 엔트리는 자체 JSX 소스라
파일에 React가 필요 없고, 서버에서도 같은 트리를 푸시 페이로드용으로 만들 수 있습니다. HTML 요소가 없는
JSX이므로 레이아웃은 별도 파일에 둡니다.

```tsx
/** @jsxImportSource tauri-plugin-live-activity/jsx */
// delivery-layout.tsx
import { Button, HStack, Progress, SFSymbol, Text, VStack } from 'tauri-plugin-live-activity/jsx';

// iOS: 잠금 화면이 이 트리를 그대로 그리고, 펼친 Dynamic Island에도 같은 트리가 보입니다
//      (iOS 16.1 이상, Button은 iOS 17.2 이상).
// Android: 알림이 처음 두 Text를 제목과 본문으로, 첫 Progress를 진행률 막대로, Button을 최대 세 개까지
//      동작으로 가져가고, 심볼과 스타일은 그리지 않습니다.
export const lockScreen = (
  <VStack alignment="leading" spacing={8}>
    <HStack spacing={8}><SFSymbol name="cat.fill" /><Text bind="title" /></HStack>
    <Text bind="status" />
    <Progress bind="done" />
    <Button actionId="done"><Text>All done</Text></Button>
  </VStack>
);
```

`tauri-plugin-live-activity/react`는 액티비티 하나를 컴포넌트와 함께 움직입니다(React 18 이상, 선택적 peer
의존성). 마운트되면 시작하고, 렌더에서 값이 바뀌면 갱신을 보내고, 언마운트나 `enabled: false`에 끝냅니다:

```tsx
// Delivery.tsx
import { getCapabilities, requestPermissions } from 'tauri-plugin-live-activity';
import { useLiveActivity } from 'tauri-plugin-live-activity/react';
import { lockScreen } from './delivery-layout';

// 첫 시작 전에 한 번: Android는 'notifications', iOS는 'liveActivities'.
export async function allowActivities() {
  const { platform } = await getCapabilities();
  await requestPermissions(platform === 'android' ? 'notifications' : 'liveActivities');
}

export function Delivery({ order }: { order: Order }) {
  const { status, error, pushToken } = useLiveActivity({
    activityKey: `delivery:${order.id}`,
    layout: { lockScreen },
    values: { title: order.title, status: order.status, done: order.done },
    enabled: order.open,
    // Android 전용: 잠금 화면에서 알림을 누가 보는지('public', 'private', 'secret').
    android: { visibility: 'public' },
    // iOS 전용: ActivityKit에 이 액티비티의 APNs 토큰을 요청하고, 토큰은 `pushToken`으로 옵니다.
    push: 'token',
    // 이 액티비티의 Button 탭. 탭으로 앱이 켜졌을 때도 옵니다.
    onAction: ({ actionId }) => { if (actionId === 'done') closeOrder(order.id); },
  });
  // pushToken: iOS에서 이 액티비티의 APNs 토큰. 서버에 보낼 것.
  return <p>{status}{error ? ` (${error.message})` : ''}</p>;
}
```

`layout`과 `styles`는 시작할 때만 읽으니, 바꾸려면 `activityKey`를 바꿔 새 액티비티를 시작합니다. 거부된
요청은 `error`에 남습니다. 노드마다 컴포넌트가 하나씩 있고(`VStack`, `HStack`, `ZStack`, `Spacer`, `Divider`,
`Text`, `SFSymbol`, `Image`, `Path`, `Progress`, `Gauge`, `TimerText`, `Button`, `Link`, `Toggle`, `Custom`) 노드의 멤버가 그대로
prop입니다. [더 보기](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#tsx-and-react)

## Rust

같은 요청을 Rust에서는 `app.live_activity()`로 보냅니다. 이 메서드들은 플랫폼의 답이 올 때까지 막히므로
메인 스레드 밖에서 부릅니다(iOS에서 메인 스레드에서 부르면 바로 `NATIVE_ERROR`로 답합니다):

```rust
use std::collections::BTreeMap;
use tauri::{AppHandle, Runtime};
use tauri_plugin_live_activity::activitykit::layout::text;
use tauri_plugin_live_activity::{
    AndroidOptions, AndroidVisibility, Bound, Layout, LayoutEndInput, LayoutSnapshot, LayoutStartInput,
    LayoutUpdateInput, LiveActivityExt, Result, Value,
};

fn snapshot(revision: u64, status: &str) -> LayoutSnapshot {
    let values = BTreeMap::from([("status".to_string(), Value::Text(status.into()))]);
    LayoutSnapshot::new(revision, values)
}

fn deliver<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let layout = Layout::new(text(Bound::key("status")));
    // Android와, Live Activity가 없는 iOS에서는 알림으로 보입니다.
    let mut input = LayoutStartInput::new("mochi:snack", layout, snapshot(0, "On time"));
    // Android 전용: 잠금 화면 표시 범위, 포그라운드 배치, 워치의 Ongoing Activity.
    input.android = Some(AndroidOptions::new(AndroidVisibility::Public).with_wear_ongoing_activity(false));
    // 그 밖에: `ios`(`IosOptions::new(transient)`, iOS 18), `scheduled`(`ScheduledStart::new(at, alert)`,
    // iOS 26과 Android), `push`(`Some(LayoutPush::Token)`, iOS).
    let activity = app.live_activity().start_layout(input)?;
    // 갱신마다 모든 값을 다시, 더 높은 revision으로 보냅니다.
    app.live_activity().update_layout(LayoutUpdateInput::new(activity.id.clone(), snapshot(1, "At the door")))?;
    app.live_activity().end_layout(LayoutEndInput::immediate(activity.id))?;
    Ok(())
}
```

요청은 생성자로 만들고, 열거형은 늘어날 수 있으니 `_` 가지로 매치하면 다음 버전에서도 컴파일됩니다. Android
콘텐츠에 쓰는 liveupdate의 타입은 플러그인이 쓰는 크레이트째로 `tauri_plugin_live_activity::liveupdate`에
있습니다:

```rust
use tauri_plugin_live_activity::liveupdate::{Timer, TimerStyle};
let clock = TimerStyle::new(Timer::new(started_at, ends_at), true); // `ends_at`까지 거꾸로 셉니다
```

놓치면 안 되는 탭은 Rust에서 받습니다. 시스템이 탭 때문에 앱을 켤 때는 웹 뷰가 아직 없을 수 있고,
JavaScript 리스너는 기다려 주지 않습니다. 만들어진 `App`에 `run` 전에 핸들러를 등록합니다:

```rust
let handle = app.handle().clone();
app.live_activity().on_action(move |event| {
    if event.action_id == "done" {
        let _ = handle.live_activity().end_layout(LayoutEndInput::immediate(event.activity_id));
    }
});
```

## TypeScript만으로

React 없이도 명령 세 개와 `layout` 빌더로 같은 일을 합니다:

```ts
import { endLayout, layout, startLayout, updateLayout } from 'tauri-plugin-live-activity';

const { vstack, bound, progress } = layout;
const snack = await startLayout({
  activityKey: 'mochi:snack',
  schemaVersion: 2,
  fallback: 'notification',
  layout: { lockScreen: vstack([bound('title'), bound('status'), progress('done')]) },
  snapshot: { revision: 0, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', done: 0.15 } },
});
await updateLayout({ id: snack.id, snapshot: { revision: 1, values: { title: 'Mochi’s snack', status: 'On the way', done: 0.65 } } });
await endLayout({ id: snack.id, policy: { kind: 'immediate' } });
```

시작 요청에 `scheduled: { at, alert }`를 주면 나중에 시작하고(iOS 26과 Android. Android에서는 사용자가 정확한 알람을 허용해야 제시간에 시작하며, `openExactAlarmSettings()`가 그 설정 화면을 엽니다), `ios: { transient: true }`이면 일시적 액티비티가 됩니다(iOS 18). 레이아웃은 시작한 모습 그대로이고, 갱신마다 모든 값을 더 높은 revision으로 다시 보냅니다. 탭은
`onAction`으로, 푸시 토큰과 푸시된 내용은 `onPushToken`, `onPushToStartToken`, `onUpdated`로, 앱이 호출하지 않은
액티비티의 변화는 `onState`, `onStarted`, `onOpened`(Android: 액티비티의 알림으로 앱을 연 일. 앱을 실행시킨 열림도 페이지가 구독할 때까지 보관됩니다), `onPermissions`, `onUnknown`(`live-activity://unknown`, Android: 액티비티에 대해 저장되어 있지만 이 버전이 이름을 모르는 이벤트), `onHandled`(Android: 앱의 서비스나 리시버가 직접 받은 탭, 아래)로 옵니다. 탭은 자기가 어떤 탭인지 말합니다. `tap.id`는 몇 번 전달돼도 같고, iOS에서 앱이 곧바로 받지 못한 탭(탭이 앱을 띄운 경우)은 나중에 `tap.late`로 오므로, id마다 한 번만 처리합니다:

```ts
await onAction(({ actionId, tap }) => {
  if (tap?.id && handled.has(tap.id)) return; // `handled`: 앱이 실행 사이에 보관하는 id 집합
  if (tap?.id) handled.add(tap.id);
  // actionId 처리
});
```

iOS에서는 `getCapabilities().ios`가 아이폰이 실행하는 기능(`pushToStart`, `pushChannels`, `transient`,
`scheduledStart`, `smallFamily`)을 알려 주므로 요청을 시도해 보지 않아도 됩니다.

Android에서는 시작에 `android: { visibility, publicVersion, placement, wearOngoingActivity, targets }`를 줍니다:

```ts
android: {
  visibility: 'public',       // 잠긴 기기에 보이는 정도: 'public', 'private', 'secret'
  placement: 'foreground',    // 앱의 포그라운드 서비스가 쥐는 알림(`foregroundPlacement`)
  wearOngoingActivity: false, // 워치 화면에서 뺌(Wear OS 3~6, Tauri 앱은 워치에서 돌지 않음)
  // 버튼 `record`의 탭이 화면 없이 앱의 서비스를 바로 실행(`actionTargets`).
  targets: { record: { kind: 'foregroundService', component: 'com.example.RecorderService', action: 'com.example.RECORD' } },
}
```

서비스는 `LiveUpdateForeground.attach(service, type)`(활동이 생기기 전까지 자기 알림을 띄우려면 `attachOr`)로 이 알림을
쥐고, 탭은 `LiveUpdateActions.take(context, intent)`로 먼저 받습니다. 그 탭은 `onAction`이 아니라 `onHandled`로 옵니다.
[더 보기](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/android-integration.md#a-tap-that-runs-your-own-code)

스냅샷에는 `relevance`(앱의 여러 액티비티 중 Dynamic Island가 무엇을 보일지 정하는 점수)와 `android`
콘텐츠(레이아웃 투영 대신 Android 방식 그대로 쓰는 알림: 구간이 있는 진행 막대, 지표, 칩 텍스트)를 넣을 수
있고, `updateLayout`은 iPhone 화면을 켜는 `alert`를 받습니다. [자세히](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#android-content)

## 레이아웃에 넣을 수 있는 것

| 노드 | 보여 주는 것 | iOS | Android |
|---|---|---|---|
| `text`, `bound` | 문자열, 또는 키의 값 | 예 | 처음 둘이 제목과 본문 |
| `symbol` | SF Symbol. `variableBind`는 0~1 값으로 가변 심볼을 채움 | 예 | 아니오 |
| `image` | 위젯 에셋 카탈로그의 그림, 또는 앱이 쓴 PNG | 예 | 처음 그린 이미지가 큰 아이콘 |
| `path` | SVG 패스 데이터 | 예 | 아니오 |
| `gauge` | `min`과 `max` 사이의 숫자를 고리나 막대로 | 예 | 아니오 |
| `progress` | 0~1의 숫자를 고리나 막대로 | 예 | 첫 번째가 알림의 진행률 막대 |
| `timerText` | `end`까지 내려가거나 `start`부터 올라가는 시간. 시스템이 셈 | 예 | 크로노미터 |
| `button` | `onAction` / `on_action`으로 오는 탭 | iOS 17.2 이상 | 최대 세 개의 동작 |
| `link` | 탭하면 그 URL을 앱에서 여는 노드 | 예 | URL을 여는 동작(기기가 `links`를 제공할 때) |
| `toggle` | 불리언 값을 보여 주는 스위치, 탭은 `on`으로 옴 | iOS 17.2 이상 | 레이블을 제목으로 한 동작, 켜진 동안 체크 표시 |
| `vstack`, `hstack`, `zstack`, `spacer`, `divider` | 배치 | 예 | 평평하게 |
| `custom` | 이름으로 고른 자체 SwiftUI 뷰 | 예 | 아니오 |

스타일은 토큰으로 글꼴·색·굵기·프레임 등을 정합니다(`styles: { title: { size: 22 } }`,
`bound('title', { style: 'title' })`). `color`, `background`, `tint`, `opacity`, `size`, `weight`,
`cornerRadius`와 레이아웃의 `background`, `keyline`은 값에 묶어(`color: bind('tone')`) 갱신으로 바꿀 수
있습니다. Android는 스타일을 그리지 않습니다. 레이아웃·스타일·값은 무게 제한 3584를 함께 씁니다. 플랫폼이
빼놓은 것은 레코드의 `degradedFeatures`가 알려 줍니다.

Dynamic Island는 `lockScreen` 옆에 자기 부분을 따로 받습니다. 비워 둔 부분은 잠금 화면 트리(펼친 모습)나
그 첫 심볼(compact leading, minimal)을 보여 줍니다:

```ts
island: {
  expanded: { leading: image('mochi'), center: bound('title'), trailing: bound('eta'), bottom: progress('done') },
  compactLeading: symbol('pawprint.fill'),
  compactTrailing: bound('eta'),
  minimal: progress('done', { kind: 'circular' }),
},
keyline: '#A3D9C2', // 아일랜드 테두리 색
```

iOS에서는 페어링된 Apple Watch(iOS 18)와 CarPlay(iOS 26)가 아일랜드의 compact 부분을 보여 줍니다. 위젯
익스텐션이 그 패밀리를 그리도록 해 두면(`setup --small-family`) `small`이 거기에 자기 트리를 줍니다. 노드는
12개까지이고 버튼·링크·토글은 넣을 수 없습니다: `small: hstack([symbol('pawprint.fill'), bound('eta')])`.
Android에서는 폰의 ongoing 알림이 페어링된 워치로 전달되지 않고 Live Update만 일부 워치에 전달되며, Android
Auto에는 이를 보여 줄 자리가 없습니다. Android는 `small`을 `degradedFeatures`에 적습니다. [더 보기](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#a-watch-and-a-car)

잠금 화면의 카드에는 여백이 없고, 더 좁은 레이아웃은 가운데에 놓입니다. 루트에 padding을 주고, 가장자리에 붙일
노드에는 `frame: { maxWidth: 'infinity', alignment: 'leading' }`인 스타일을 줍니다.
[더 보기](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#placement-on-the-lock-screen)

## 푸시 (iOS)

서버가 APNs로 액티비티를 갱신하고 끝내고 시작합니다. `push: 'token'`(iOS 18에서는 `{ channel }`도)으로
시작하면 액티비티의 토큰이 `onPushToken`으로, 앱의 push-to-start 토큰(iOS 17.2, 플러그인 설정의
`pushToStart`)이 `onPushToStartToken`으로, 푸시가 전달한 내용이 `onUpdated`로 옵니다. 페이지가 구독할 때
플러그인이 이미 쥐고 있던 토큰은 바로 옵니다. 페이로드는 서버에서 activitykit의 `push::Payload`로 만듭니다.
[더 보기](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#pushes)

## 기본 부품 너머

대부분은 Swift 없이 됩니다. `setup --font fonts/Pacifico-Regular.ttf --asset art/paw@3x.png`가 글꼴과 그림을
위젯 확장에 넣어 주고, 스타일과 `image('paw')`에서 이름으로 씁니다. 앱이 그린 그림은 App Group(`setup
--app-group`)을 거칩니다: `writeImage('badge.png', png)` 뒤에 `image({ file: 'badge.png' })`. 자체 뷰는
`gen/apple/LiveActivityWidget/LiveActivityCustomViews.swift`의 SwiftUI로, `setup`이 한 번 만들고 다시
덮어쓰지 않으며, `custom('ring', { props: { level: bind('done') } })`으로 놓습니다. 그린 PNG는 최대 1 MiB,
1224 × 480 픽셀입니다. [더 보기](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/usage.md#beyond-the-built-in-parts)

## 직접 만든 백엔드

`init()`은 `Builder::new().build()`이고, 플랫폼 백엔드 위에서 돕니다: iOS는 ActivityKit, Android는 liveupdate.
`Builder::layer`는 그 위에 층을 씌웁니다. Android가 레이아웃에서 빼는 것을 그리는 렌더러, 로그, 시험용 대역 같은
것입니다. `BackendLayer`는 바꾸는 호출만 덮어쓰고, 나머지 호출은 그대로 아래 백엔드로 갑니다. 그래서 메서드를
빠뜨려도 기능이 꺼지지 않습니다. 탭을 지켜보는 층은 `attach`가 넘기는 `BackendContext`를 감쌉니다.

`Builder::backend`는 플랫폼 백엔드 자리에 직접 만든 백엔드를 넣습니다(예를 들어 데스크톱). 층은 그 위에 씌워집니다.
이때 플랫폼 백엔드는 만들어지지 않습니다. 다만 Android에서는 정확한 알람 설정을 열기 위해 계속 만들어집니다. iOS에서는
플러그인이 kit을 만들지 않으므로, 설정의 `receipts`와 `pushToStart`는 직접 만든 백엔드가 지켜야 합니다. 직접 만든
백엔드는 liveactivity-rs 브리지의 인터페이스인 `LiveActivityBackend`를 구현하고, 탭을 비롯한 이벤트를 `attach`에서
받은 컨텍스트로 보냅니다. 플러그인은 `sync_events`를 부르지 않습니다. liveactivity의 `testkit` 기능(`conformance`)으로
백엔드가 계약을 지키는지 확인할 수 있습니다. 어느 쪽이든 Tauri 쪽인 명령, 이벤트, `live-activity:` 권한은 플러그인이
계속 맡습니다.

```rust
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri_plugin_live_activity::{
    BackendFuture, BackendLayer, Builder, LayoutActivityRecord, LayoutStartInput, LiveActivityBackend,
};

/// 시작하는 레이아웃 활동을 셉니다. 나머지 호출은 그대로 넘어갑니다.
#[derive(Default)]
struct Starts(AtomicUsize);

impl BackendLayer for Starts {
    fn start_layout<'a>(
        &'a self,
        input: LayoutStartInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, LayoutActivityRecord> {
        self.0.fetch_add(1, Ordering::Relaxed);
        next.start_layout(input)
    }
}

// 앱의 빌더에서 `.plugin(tauri_plugin_live_activity::init())` 대신 씁니다. 수는 핸들로 읽습니다:
// `starts.0.load(Ordering::Relaxed)`.
let starts = Arc::new(Starts::default());
// .plugin(Builder::new().layer(starts.clone()).build())
```

## 제약

- iOS: iOS 16.1의 iPhone 또는 iPadOS 17의 iPad, 버튼과 토글은 iOS 17.2부터. iOS 16.1에는 stale 날짜와 relevance 점수가
  없고, `frequentPushes`는 `denied`입니다. 액티비티는 앱이 전면일 때만 시작되고 (아니면 `NOT_FOREGROUND`), 시스템이
  8시간 뒤 끝냅니다.
- iOS는 각 액티비티의 마지막 값을 앱의 Application Support에 평문으로 둡니다. 플러그인 설정에
  `"receipts": "redacted"`를 주면 가립니다.
- 버튼 탭은 Rust `on_action` 핸들러를 최대 4초 기다립니다. JavaScript 리스너는 기다리지 않습니다.
- 푸시는 iOS만. Android는 진행 중 알림을 보여 주고, 시스템이 허용하는 곳에서는 Live Update로 올립니다.
- Android 15부터 시계가 14일보다 오래된 타이머는 `INVALID_INPUT`으로 거절됩니다. Android는 그런 알림을 보여 주지
  않고 앱에도 알리지 않습니다.
- `SYSTEM_LIMIT`은 플랫폼의 한도입니다. Android에서는 살아 있는 액티비티 32개, 1,000,000바이트 저장소가 꽉 찬 경우,
  두 번째 포그라운드 배치이고, iOS에서는 ActivityKit의 한도입니다.
- npm 패키지와 크레이트는 같은 마이너 버전으로 맞춥니다.

## Samsung Now Bar

`tauri.conf.json`에 `"plugins": { "live-activity": { "android": { "samsungNowBar": true } } }`를 두면 One UI 9의
Now Bar가 보여 줄 제목과 본문을 보냅니다. One UI는 Samsung의 허용 목록에 있는 앱이나, 개발자 옵션 "모든 앱의
라이브 알림"이 켜진 동안의 모든 앱에만 Now Bar를 보여 줍니다.

## 자주 묻는 질문

**iOS Live Activity와 Dynamic Island를 위한 Tauri 플러그인이 있나요?** 네, 이 플러그인입니다.
tauri-plugin-live-activity는 커뮤니티 플러그인이고, Tauri 공식 플러그인은 없습니다. 이 플러그인으로 Tauri 2 앱은
iOS 16.1 이상에서 ActivityKit Live Activity를 시작, 갱신, 종료하고, 잠금 화면과 Dynamic Island에 그립니다.

**Xcode에서 Widget Extension을 손으로 넣어야 하나요?** 아니요. `npx tauri-plugin-live-activity setup`이 활동을
그리는 위젯 확장을 `src-tauri/gen/apple`의 Xcode 프로젝트에 넣습니다. `gen/apple`을 새로 만들 때마다 다시
실행하세요.

**Android Live Updates를 지원하나요?** 네. Android 16 (API 36) 이상에서는 시스템과 사용자 설정이 허락하면 승격된
Live Update를 요청하고, 그 밖에는 Android 8.0 (API 26)부터 같은 요청이 진행 중 알림으로 보입니다.

**최소 iOS, Android 버전은요?** iPhone은 iOS 16.1, iPad는 iPadOS 17, Android는 8.0 (API 26)입니다. 더 높은 버전이
필요한 기능은 [지원 버전](#지원-버전)에 있습니다.

**Swift나 Kotlin을 써야 하나요?** 아니요. 레이아웃은 TSX, TypeScript 또는 Rust이고, 네이티브 코드는 플러그인과
그 크레이트에 들어 있습니다. 직접 만든 뷰는 SwiftUI로 넣을 수도 있습니다([기본 부품 너머](#기본-부품-너머)).

**liveactivity-rs가 뭔가요?** 이 플러그인이 올라선 Rust 브리지, `liveactivity` 크레이트입니다. 요청 계약과 수명
주기를 맡고, iOS는 activitykit-rs, Android는 liveupdate-rs 위에서 돌립니다([동작 구조](#동작-구조)).

**백엔드를 바꾸거나 덧붙일 수 있나요?** 네. `Builder::layer`는 플랫폼 백엔드 위에 렌더러, 로그, 시험용 대역 같은
층을 씌우고, `Builder::backend`는 그 자리에 직접 만든 백엔드를 넣습니다. 둘 다 liveactivity-rs 브리지의
`LiveActivityBackend` 인터페이스를 씁니다([직접 만든 백엔드](#직접-만든-백엔드)).

**홈 화면 위젯 플러그인과 무엇이 다른가요?** tauri-plugin-widgets 같은 위젯 플러그인은 홈 화면에 계속 머무는
WidgetKit, Android Glance 위젯을 그립니다. 이 플러그인은 작업 하나가 진행되는 동안 그 작업을 따라가는 Live
Activity와 Android Live Update를 그립니다. 한 앱에서 둘 다 쓸 수 있습니다.

**서버가 활동을 갱신할 수 있나요?** iOS에서는 APNs로 됩니다: 푸시 토큰, iOS 17.2부터 push-to-start, iOS 18부터
broadcast 채널([푸시 (iOS)](#푸시-ios)). Android에는 푸시 경로가 없고, 앱이 알림을 갱신합니다.

**macOS, Windows, Linux에서도 되나요?** 아니요. 그곳에서는 활동 명령이 `UNSUPPORTED_PLATFORM`을 돌려주고,
`getCapabilities()`가 그렇다고 알려 줍니다.

## 더 알아보기

[문서](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/docs)가 나머지를 다룹니다: `setup`이
바꾸는 것과 손으로 하는 법, iOS와 Android 캡처가 있는 모든 노드, 플러그인 옵션, 테스트 기록.

## 라이선스

[MIT](LICENSE-MIT) 또는 [Apache-2.0](LICENSE-APACHE).
