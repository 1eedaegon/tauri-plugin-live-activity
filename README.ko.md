# tauri-plugin-live-activity

[![npm](https://img.shields.io/npm/v/tauri-plugin-live-activity)](https://www.npmjs.com/package/tauri-plugin-live-activity)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-live-activity)](https://crates.io/crates/tauri-plugin-live-activity)
[![CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml)

Tauri 2에서 iOS Live Activities(ActivityKit·Dynamic Island)와 Android Live Updates를 표시하는 커뮤니티 플러그인입니다.
Android에서는 지원 조건에 따라 일반 진행 알림으로 표시합니다.
**1.0 이전에는 마이너 버전이 바뀔 때 API도 바뀔 수 있습니다.** [English](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/README.md)

| 플랫폼 | 표시 방식 |
| --- | --- |
| iOS 16.1+ / iPadOS 17+ | ActivityKit · 잠금 화면 / 지원 기기의 Dynamic Island |
| Android API 26+ | 진행 알림 · API 36+에서 조건 충족 시 Live Update 승격 |
| macOS / Windows / Linux | 미구현 |

## 데모

<table>
  <tr><th>iOS 잠금 화면</th><th>iOS Dynamic Island</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-paths.png" width="400" alt="iOS 잠금 화면에 SVG 경로로 그린 Mochi 얼굴"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-expanded.png" width="400" alt="펼친 Dynamic Island에 표시한 Mochi의 간식"></td>
  </tr>
  <tr><th>Android 알림</th><th>Samsung Now Bar</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-android.png" width="400" alt="진행 막대와 Wake Mochi 액션이 있는 Android 알림의 Mochi 낮잠"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/samsung-now-bar.png" width="400" alt="잠긴 Galaxy S23의 One UI Now Bar에 표시한 Mochi의 간식 배달"></td>
  </tr>
</table>

고양이 Mochi를 따라가는 [데모 앱](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo)에서
캡처했습니다. iOS는 iPhone 17 시뮬레이터(iOS 26.3), Android는 Android 16(API 36) 에뮬레이터,
Now Bar는 잠긴 Galaxy S23(One UI 9, Android 17)입니다.

## 설치

Tauri 2와 Rust 1.90 이상이 필요합니다. 아래 명령은 모두 앱의 루트 폴더에서 실행합니다.
npm 패키지와 crate는 같은 마이너 버전을 사용해야 합니다.

```sh
npm i tauri-plugin-live-activity@0.2 && cargo add tauri-plugin-live-activity@0.2 --manifest-path src-tauri/Cargo.toml
for p in default allow-request-permissions allow-start allow-update allow-end allow-start-layout allow-update-layout allow-end-layout; do npx tauri permission add live-activity:$p; done
```

그다음 `src-tauri/src/lib.rs`에서 플러그인을 등록합니다.

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
```

### iOS

활동은 플러그인 템플릿으로 만든 위젯 확장이 그립니다. Mac에서 `tauri ios init`을 실행한 뒤,
같은 셸에서 아래 명령을 차례로 실행합니다. 각 줄이 하는 일은 다음과 같습니다.

1. 플러그인 폴더를 찾습니다. `jq`는 macOS 15부터 기본으로 들어 있습니다.
2. 위젯, 버튼 인텐트, 확장의 Info.plist를 복사합니다. 이 Info.plist에는 `TauriLiveActivityLayout` = 2가
   들어 있습니다.
3. `src-tauri/Info.ios.plist`에 `NSSupportsLiveActivities`를 추가합니다. Tauri가 이 파일을 앱의
   Info.plist에 합칩니다.
4. 플러그인 Swift 패키지가 쓰는 Tauri 의존성을 준비합니다. Apple silicon Mac에서는
   `--target aarch64-apple-ios-sim`을 씁니다.

```sh
LA=$(cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml | jq -r '.packages[] | select(.name == "tauri-plugin-live-activity") | .manifest_path | rtrimstr("Cargo.toml")')
mkdir -p src-tauri/gen/apple/LiveActivityWidget && cp "$LA"templates/ios/* src-tauri/gen/apple/LiveActivityWidget/
/usr/libexec/PlistBuddy -c 'Add :NSSupportsLiveActivities bool true' src-tauri/Info.ios.plist
IPHONEOS_DEPLOYMENT_TARGET=16.1 cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-apple-ios
```

Tauri는 XcodeGen으로 Xcode 프로젝트를 만들고, 새 타깃은 XcodeGen YAML 블록이라 한 줄로
쓸 수 없습니다. 아래 블록을 붙여 넣고 마지막 줄을 실행합니다.

```sh
cat > src-tauri/gen/apple/live-activity.yml <<EOF
packages:
  LiveActivity: { path: "${LA}ios" }
targets:
  $(sed -n 's/^name: //p' src-tauri/gen/apple/project.yml)_iOS:
    sources: [LiveActivityWidget/LiveActivityActionIntent.swift]
    dependencies: [{ target: LiveActivityWidget }]
    settings: { base: { SWIFT_VERSION: "5.0" } }
  LiveActivityWidget:
    type: app-extension
    platform: iOS
    deploymentTarget: "16.1"
    sources: [LiveActivityWidget]
    dependencies: [{ package: LiveActivity, product: LiveActivityShared }, { package: LiveActivity, product: LiveActivityUI }]
    info: { path: LiveActivityWidget/Info.plist, properties: { NSExtension: { NSExtensionPointIdentifier: com.apple.widgetkit-extension }, TauriLiveActivityLayout: 2 } }
    settings: { base: { PRODUCT_BUNDLE_IDENTIFIER: $(jq -r .identifier src-tauri/tauri.conf.json).widget, SWIFT_VERSION: "5.0" } }
EOF
printf '\ninclude: [live-activity.yml]\n' >> src-tauri/gen/apple/project.yml && xcodegen generate --spec src-tauri/gen/apple/project.yml
```

인텐트 파일은 두 타깃에 모두 들어갑니다. 위젯은 이 파일로 버튼을 만들고, 시스템은 인텐트를
앱에서 실행합니다. `tauri ios init`을 다시 실행하면 `project.yml`이 새로 써지므로 마지막 줄을
다시 실행합니다. 확장의 버전은 1.0 (1)이 되니, App Store에 올리기 전에 앱과 같은 버전으로 맞춥니다.

### Android

알림 권한과 리시버는 플러그인 매니페스트가 추가합니다. 빌드에는 Android SDK 37이 필요합니다.
최소 버전은 Android 8(API 26)인데, 새 Tauri 앱은 24로 시작합니다. 첫 줄은 `tauri android init`에
쓰일 값을, 둘째 줄은 이미 만든 프로젝트의 값을 바꿉니다.

```sh
node -e 'f="src-tauri/tauri.conf.json";c=require("./"+f);(c.bundle.android??={}).minSdkVersion=26;require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
perl -pi -e 's/minSdk = 2[0-5]$/minSdk = 26/' src-tauri/gen/android/app/build.gradle.kts
```

## 사용법

플러그인은 앱이 보낸 상태를 표시합니다. 실제 작업, 백그라운드 실행, 갱신 주기는 앱이
담당합니다. 활동이 어디에 보일지는 OS 권한, 집중 모드, 승격 규칙이 정합니다.
`fallback: 'none'`은 네이티브 백엔드를 쓸 수 없을 때 시작을 거부할 뿐, Android가 알림을
승격하도록 강제하지는 못합니다.

캡처는 iPhone 17 시뮬레이터(iOS 26.3)와 Android 16 에뮬레이터에서 했습니다. 데모는 여기
코드에 Mochi의 색과 여백을 더했습니다.

### 진행률

```ts
import { getCapabilities, requestPermissions, start, update, end } from 'tauri-plugin-live-activity';

const { platform } = await getCapabilities();
await requestPermissions(platform === 'android' ? 'notifications' : 'liveActivities');

const snack = await start({
  activityKey: 'mochi:snack',
  schemaVersion: 1,
  template: 'progress',
  fallback: 'notification',
  snapshot: { revision: 0, title: 'Mochi’s snack delivery', status: 'Packing a tiny treat', progress: 0.15 },
});
await update({
  id: snack.id,
  snapshot: { revision: 1, title: 'Mochi’s snack delivery', status: 'On the way to Mochi', progress: 0.65 },
});
await end({ id: snack.id, policy: { kind: 'immediate' } });
```

갱신할 때마다 `revision`을 올리고 snapshot 전체를 보냅니다. 앱을 다시 실행한 뒤에는 `list()`로
활동을 다시 찾습니다.

<table>
  <tr><th>iOS 26.3 시뮬레이터</th><th>Android 16 에뮬레이터</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-v1-progress.png" width="400" alt="iOS 잠금 화면에서 65%인 Mochi의 간식 배달"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-v1-progress.png" width="400" alt="Android 알림 창에서 진행 막대가 있는 Mochi의 간식 배달"></td>
  </tr>
</table>

iOS의 고양이 그림은 데모 앱의 자체 위젯이 그립니다. 플러그인 템플릿은 같은 제목, 상태,
진행 막대를 표시합니다.

### 타이머

```ts
import { start } from 'tauri-plugin-live-activity';

const now = Date.now();
await start({
  activityKey: 'mochi:nap',
  schemaVersion: 1,
  template: 'timer',
  fallback: 'notification',
  snapshot: {
    revision: 0, title: 'Mochi’s nap', status: 'A little snooze, a little peace',
    timer: { startedAt: now, endsAt: now + 5 * 60_000 },
  },
});
```

시각은 Unix 밀리초입니다. 카운트다운은 시스템이 하므로 앱이 매초 보낼 것은 없습니다.

<table>
  <tr><th>iOS 26.3 시뮬레이터</th><th>Android 16 에뮬레이터</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-v1-timer.png" width="400" alt="iOS 잠금 화면에서 4:48부터 줄어드는 Mochi의 낮잠"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-v1-timer.png" width="400" alt="Android 알림 머리글의 카운트다운과 Mochi의 낮잠"></td>
  </tr>
</table>

## 레이아웃

레이아웃을 쓰면 앱이 활동의 화면을 직접 구성합니다. 노드 트리, 스타일 표, 값 맵을 보내면
iOS에서는 플러그인의 위젯 템플릿이 그리므로 앱에 SwiftUI 코드가 필요 없습니다. Android는
그중 일부를 알림으로 보여 줍니다. 트리는 시작할 때 고정되고, 갱신할 때는 같은 키와 타입으로
값만 보냅니다. 레이아웃·스타일·값은 ActivityKit의 4 KiB 한도를 함께 씁니다.

### 텍스트, 값, 스타일

```ts
import { layout, startLayout, updateLayout, endLayout } from 'tauri-plugin-live-activity';

const { vstack, bound, text } = layout;

const card = await startLayout({
  activityKey: 'mochi:text',
  schemaVersion: 2,
  fallback: 'notification',
  layout: {
    lockScreen: vstack([
      bound('title', { style: 'title' }),
      bound('status', { style: 'status', unless: 'arrived' }),
      text('Snack time! Made it home', { style: 'done', if: 'arrived' }),
    ], { alignment: 'leading' }),
  },
  styles: {
    title: { font: 'headline' },
    status: { font: 'subheadline', color: 'secondary' },
    done: { font: 'subheadline', weight: 'bold', color: '#C9654D' },
  },
  snapshot: { revision: 0, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', arrived: false } },
});

await updateLayout({
  id: card.id,
  snapshot: { revision: 1, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', arrived: true } },
});

await endLayout({ id: card.id, policy: { kind: 'immediate' } });
```

`bound`는 값을, `text`는 고정 문자열을 표시합니다. `if`는 값이 참으로 평가될 때만, `unless`는
그렇지 않을 때만 노드를 보여 줍니다. 아래 예시는 `fallback` 다음의 멤버만 보여 주며, 빌더는 모두
`layout`에 있습니다.

<table>
  <tr><th></th><th>iOS 26.3 시뮬레이터</th><th>Android 16 에뮬레이터</th></tr>
  <tr>
    <td><code>arrived: false</code></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-text.png" width="380" alt="iOS 잠금 화면의 제목과 상태 텍스트"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-text.png" width="380" alt="같은 제목과 상태를 표시한 Android 알림"></td>
  </tr>
  <tr>
    <td><code>arrived: true</code></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-text-arrived.png" width="380" alt="iOS에서 상태 대신 굵은 산호색 Snack time 텍스트"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-text-arrived.png" width="380" alt="Android에서 본문이 Snack time으로 바뀐 알림"></td>
  </tr>
</table>

Android는 스타일을 버리고 첫 텍스트를 제목, 둘째 텍스트를 본문으로 씁니다.

### SF Symbol

```ts
layout: {
  lockScreen: hstack([
    symbol('cat.fill'),
    symbol('heart.fill', { rendering: 'multicolor' }),
    symbol('speaker.wave.3.fill', { variableBind: 'purr' }),
    bound('title'),
  ], { spacing: 12 }),
},
snapshot: { revision: 0, values: { title: 'Purr meter', purr: 0.35 } },
```

`variableBind`는 0과 1 사이의 숫자로 가변 심볼을 채웁니다.

| iOS 26.3 시뮬레이터 | Android |
| --- | --- |
| <img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-symbols.png" width="400" alt="iOS 잠금 화면의 고양이, 다색 하트, 35% 채운 스피커 심볼"> | 표시하지 않습니다. `degradedFeatures`에 `layout.symbol`로 남깁니다. |

### 이미지

```ts
layout: {
  lockScreen: hstack([image('mochi', { resizable: true, style: 'portrait' }), bound('title')], { spacing: 12 }),
},
styles: { portrait: { frame: { width: 56, height: 56 } } },
snapshot: { revision: 0, values: { title: 'Mochi’s portrait' } },
```

`image`는 위젯 확장의 에셋 카탈로그에 있는 그림의 이름입니다. `src-tauri/gen/apple/LiveActivityWidget`에
`Assets.xcassets` 폴더를 두고 `xcodegen generate --spec src-tauri/gen/apple/project.yml`을 실행하면
위젯 타깃에 들어갑니다. 데모의 `mochi`는 SVG 파일에서 만든 PNG입니다.

| iOS 26.3 시뮬레이터 | Android |
| --- | --- |
| <img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-image.png" width="400" alt="iOS 잠금 화면에 위젯 에셋 카탈로그에서 가져온 Mochi 초상화"> | 표시하지 않습니다. `layout.image`로 남깁니다. |

### 경로(SVG path 데이터)

```ts
const head = 'M14 40C12 32 11 22 14 14Q15 11 18 13L35 27Q50 23 65 27L82 13Q85 11 86 14C89 22 88 32 86 40C93 48 94 61 87 71C79 81 66 85 50 85C34 85 21 81 13 71C6 61 7 48 14 40Z';
layout: {
  lockScreen: zstack([
    path(head, [100, 90], { style: 'fur' }),
    path(head, [100, 90], { stroke: 1.5 }),
    path('M28 54Q33 58 38 54M62 54Q67 58 72 54', [100, 90], { stroke: 2 }),
    path('M48 64Q50 62 52 64Q50 66 48 64Z', [100, 90], { style: 'nose' }),
  ], { style: 'face' }),
},
styles: { face: { frame: { width: 60, height: 54 } }, fur: { color: '#F6E9CD' }, nose: { color: '#C9654D' } },
snapshot: { revision: 0, values: {} },
```

`path`는 SVG `<path>`의 `d`를 `[너비, 높이]` 크기의 `box` 안에 비율을 지켜 그립니다. 기본은
채우기이고, `stroke`로 선 굵기를 주면 선으로 그립니다. `d`는 `M L H V C S Q T Z` 명령을
512바이트까지 받습니다. 호(`A`)는 지원하지 않으니 먼저 곡선으로 바꿉니다.

| iOS 26.3 시뮬레이터 | Android |
| --- | --- |
| <img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-paths.png" width="400" alt="iOS 잠금 화면에 경로 네 개로 그린 Mochi 얼굴"> | 표시하지 않습니다. `layout.path`로 남깁니다. |

### 게이지

```ts
layout: {
  lockScreen: hstack([gauge('bowl', { max: 100, kind: 'circular' }), gauge('bowl', { max: 100 })], { spacing: 12 }),
},
snapshot: { revision: 0, values: { bowl: 80 } },
```

게이지는 `min`과 `max`(생략하면 0과 1) 사이의 숫자를 원이나 막대로 보여 줍니다.

| iOS 26.3 시뮬레이터 | Android |
| --- | --- |
| <img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-gauge.png" width="400" alt="iOS 잠금 화면에서 100 중 80을 가리키는 원형·막대 게이지"> | 표시하지 않습니다. `layout.gauge`로 남깁니다. |

### 진행 표시

```ts
layout: {
  lockScreen: vstack([bound('title'), progress('done', { kind: 'circular' }), progress('done')]),
},
snapshot: { revision: 0, values: { title: 'Mochi’s snack delivery', done: 0.65 } },
```

진행 표시는 0부터 1까지의 숫자를 막대나 원으로 보여 줍니다.

<table>
  <tr><th>iOS 26.3 시뮬레이터</th><th>Android 16 에뮬레이터</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-progress.png" width="400" alt="iOS 잠금 화면에서 65%인 원과 막대"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-progress.png" width="400" alt="Android 알림의 진행 막대가 된 첫 진행 표시"></td>
  </tr>
</table>

Android는 첫 진행 표시를 알림의 진행 막대로 씁니다.

### 타이머 텍스트

```ts
layout: {
  lockScreen: vstack([bound('title'), timerText('start', 'end')]),
},
snapshot: { revision: 0, values: { title: 'Mochi’s nap', start: Date.now(), end: Date.now() + 5 * 60_000 } },
```

`timerText`는 `end` 값까지 거꾸로 세고, `countsDown: false`이면 `start`부터 셉니다.

<table>
  <tr><th>iOS 26.3 시뮬레이터</th><th>Android 16 에뮬레이터</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-timer.png" width="400" alt="iOS 잠금 화면에서 4:50부터 줄어드는 Mochi의 낮잠"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-timer.png" width="400" alt="Android 알림 머리글의 크로노미터가 된 카운트다운"></td>
  </tr>
</table>

Android는 첫 타이머를 알림의 크로노미터로 씁니다.

### 스택

```ts
layout: {
  lockScreen: vstack([
    hstack([zstack([symbol('circle.fill'), symbol('pawprint.fill', { style: 'mark' })]), bound('title'), spacer(), bound('eta')]),
    divider(),
    hstack([bound('from'), spacer(), bound('to')]),
  ], { spacing: 10 }),
},
styles: { mark: { size: 13, color: 'white' } },
snapshot: { revision: 0, values: { title: 'Snack route', eta: '4 min', from: 'Kitchen', to: 'Mochi’s bowl' } },
```

`vstack`, `hstack`, `zstack`은 노드를 세로로, 가로로, 겹쳐서 놓습니다. `spacer`는 남는 공간을
차지하고 `divider`는 구분선을 그립니다.

| iOS 26.3 시뮬레이터 | Android |
| --- | --- |
| <img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-stacks.png" width="400" alt="iOS 잠금 화면의 발바닥 배지·제목·시간 한 줄, 구분선, 아래의 From과 To"> | 첫 두 텍스트만 제목과 본문으로 표시합니다. 캡처는 없습니다. |

### 버튼

```ts
layout: {
  lockScreen: vstack([
    bound('title'),
    bound('status'),
    hstack([button('pet', text('Pet Mochi')), button('done', text('All done'))], { spacing: 8 }),
  ], { alignment: 'leading' }),
},
snapshot: { revision: 0, values: { title: 'Mochi wants attention', status: 'No pets yet', pets: 0 } },
```

버튼을 탭하면 버튼의 액션 ID가 앱에 전달됩니다. 탭만으로는 활동이 바뀌지 않으니 핸들러에서
갱신하거나 종료합니다. 웹뷰가 실행 중이면 `onAction`이 탭을 받습니다.

```ts
import { endLayout, onAction } from 'tauri-plugin-live-activity';

await onAction(async ({ actionId, activityId }) => {
  if (actionId === 'done') await endLayout({ id: activityId, policy: { kind: 'immediate' } });
});
```

시스템이 탭을 처리하려고 앱을 백그라운드에서 실행하면 Tauri가 웹뷰를 만들지 않을 수 있습니다.
그때도 동작해야 하는 탭은 Rust에서 처리합니다. 빌드한 `App`에 `run` 전에 핸들러를 등록합니다.

```rust
use tauri_plugin_live_activity::{EndInput, EndPolicy, LiveActivityExt};

let app = tauri::Builder::default()
    .plugin(tauri_plugin_live_activity::init())
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
let handle = app.handle().clone();
app.live_activity().on_action(move |event| {
    if event.action_id == "done" {
        let input = EndInput { id: event.activity_id, policy: EndPolicy::Immediate {} };
        let _ = handle.live_activity().end_layout(input);
    }
});
app.run(|_, _| {});
```

Rust 핸들러가 먼저 플러그인 스레드에서 실행되며, 핸들러 안에서 플러그인을 호출해도 됩니다.
`onAction`에는 `core:event:default` 권한이 필요한데, 새 앱에는 이미 들어 있습니다.

<table>
  <tr><th></th><th>iOS 26.3 시뮬레이터</th><th>Android 16 에뮬레이터</th></tr>
  <tr>
    <td>시작</td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-buttons-before.png" width="380" alt="iOS 잠금 화면의 Pet Mochi와 All done 버튼"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-buttons-before.png" width="380" alt="Android 알림 액션이 된 Pet Mochi와 All done"></td>
  </tr>
  <tr>
    <td>Pet Mochi 탭 후</td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-buttons-after.png" width="380" alt="iOS에서 한 번 탭한 뒤 Purring. 1 pet so far로 바뀐 상태"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-buttons-after.png" width="380" alt="Android에서 두 번 탭한 뒤 Purring. 2 pets so far로 바뀐 본문"></td>
  </tr>
</table>

데모의 Rust 핸들러가 쓰다듬은 횟수를 세어 상태를 갱신합니다. 버튼은 iOS 17 이상에서
동작합니다(`getCapabilities()`의 `actions`). Android는 버튼을 세 개까지 알림 액션으로 보여 줍니다. Android에서 종료된 앱을
다시 띄운 탭은 메모리에서 기다리다가, Tauri 런타임이 시작되지 않으면 사라집니다.

### Dynamic Island

```ts
layout: {
  lockScreen: vstack([bound('title'), bound('status'), progress('done')]),
  island: {
    expanded: {
      leading: image('mochi', { resizable: true, style: 'portrait' }),
      center: bound('title'),
      trailing: bound('eta'),
      bottom: vstack([bound('status'), progress('done')]),
    },
    compactLeading: symbol('pawprint.fill'),
    compactTrailing: bound('eta'),
    minimal: progress('done', { kind: 'circular' }),
  },
  keyline: '#A3D9C2',
},
styles: { portrait: { frame: { width: 44, height: 44 } } },
snapshot: { revision: 0, values: { title: 'Mochi’s snack', status: 'Packing a tiny treat', done: 0.15, eta: '9 min' } },
```

`island`로 각 영역에 노드를 따로 줍니다. 생략한 영역은 기본값을 씁니다. 펼친 화면은 잠금 화면
트리를, compact leading과 minimal은 그 트리의 첫 심볼을 보여 줍니다. `keyline`은 아일랜드
테두리 색입니다.

<table>
  <tr><th>Compact</th><th>Minimal</th><th>Expanded</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-compact.png" width="270" alt="compact Dynamic Island 왼쪽의 발바닥과 오른쪽의 9 min"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-minimal.png" width="180" alt="minimal Dynamic Island의 진행 원"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-island-expanded.png" width="265" alt="펼친 Dynamic Island의 초상화, 제목, 시간, 상태, 진행 막대"></td>
  </tr>
</table>

iPhone 17 시뮬레이터(iOS 26.3)에서 캡처했습니다. Android에는 Dynamic Island가 없어서
`layout.island`로 남깁니다.

### Android

알림은 레이아웃을 그릴 수 없습니다. Android는 현재 값으로 잠금 화면 트리를 차례로 살펴
아래 부분만 씁니다.

| 레이아웃 | 알림 |
| --- | --- |
| 첫 번째 `text` | 제목 |
| 두 번째 `text` | 본문 |
| 첫 번째 `progress` | 진행 막대 |
| 첫 번째 `timerText` | 크로노미터 |
| `button` 세 개까지 | 액션. 버튼 안의 첫 텍스트가 라벨 |
| `android.visibility` | 잠금 화면 공개 범위: `public`, `private`(기본), `secret` |

나머지는 `degradedFeatures`에 남깁니다. 아래 예시라면 `layout.symbol`과 `layout.styles`입니다.

```ts
layout: {
  lockScreen: vstack([
    hstack([symbol('moon.zzz.fill'), bound('title', { style: 'title' })], { spacing: 8 }),
    bound('status'),
    progress('sleep'),
    button('wake', text('Wake Mochi')),
  ], { alignment: 'leading' }),
},
styles: { title: { font: 'headline' } },
snapshot: { revision: 0, values: { title: 'Mochi’s nap', status: 'Dozing off', sleep: 0.2 } },
android: { visibility: 'public' },
```

| iOS | Android 16 에뮬레이터 |
| --- | --- |
| 위 예시들처럼 작성한 그대로 그립니다. | <img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/android-layout-android.png" width="400" alt="Android 알림 창에서 60%이고 Wake Mochi 액션이 있는 Mochi의 낮잠"> |

캡처는 `Fast asleep`, `0.6`으로 한 번 갱신한 뒤의 화면입니다. Android 16 이상에서는 앱이 승격된
알림을 보낼 수 있을 때 플러그인이 Live Update 승격을 요청하고, 그 결과는 `promotionState`에 나옵니다.

### Samsung Now Bar

One UI는 Samsung의 허용 목록에 있는 앱의 승격된 알림만 Now Bar에 보여 줍니다. 사용자가 개발자
옵션 "Live notifications for all apps"를 켜 두면 모든 앱이 대상이 됩니다. 목록에 넣을 앱은
Samsung이 비공개로 정하며, 공개된 신청 경로는 찾지 못했습니다. Android 17 이상에서 제목과
본문을 Now Bar에 보이려면 플러그인의 One UI extra를 켭니다.

```sh
node -e 'f="src-tauri/tauri.conf.json";c=require("./"+f);((c.plugins??={})["live-activity"]??={}).android={samsungNowBar:true};require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
```

| Galaxy S23, One UI 9(Android 17), 잠금 상태 |
| --- |
| <img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/samsung-now-bar.png" width="400" alt="One UI Now Bar에 표시한 Mochi’s snack delivery와 On the way to Mochi"> |

데모의 Now Bar 예시(제목, 상태, 진행 막대에 `android: { visibility: 'public' }`)를 한 번 갱신한
뒤, 개발자 옵션을 켠 상태에서 캡처했습니다. extra를 켠다고 허용 목록에 오르지는 않습니다. Samsung이 `RON` 플래그 없이 앱을
목록에 넣었다면 아래 매니페스트 항목도 필요합니다. 플러그인은 이 항목을 추가하지 않습니다.

```sh
f=src-tauri/gen/android/app/src/main/AndroidManifest.xml; grep -q ongoing_activity $f || perl -0pi -e 's|<application\b[^>]*>|$&\n        <meta-data android:name="com.samsung.android.support.ongoing_activity" android:value="true" />|' $f
```

## 플러그인 설정

`tauri.conf.json`의 `plugins.live-activity`는 생략해도 됩니다.

```json
{ "plugins": { "live-activity": { "receipts": "redacted", "android": { "samsungNowBar": true } } } }
```

- `receipts`: iOS는 수락한 요청마다 기록(receipt)을 남겨, 재실행 후에도 늦게 도착한
  ActivityKit 조회 결과가 이전 revision을 되살리지 못하게 합니다. 기본값 `full`은 snapshot과
  그 텍스트를 저장합니다. `redacted`는 snapshot의 SHA-256 digest만 저장하는데, digest는 추측할
  수 없는 값만 가려 줍니다. Android는 아직 이 옵션을 무시하고 앱 전용 preferences에 기록 전체를
  저장합니다.
- `android.samsungNowBar`: [Samsung Now Bar](#samsung-now-bar)의 extra를 붙입니다. 생략하면 꺼져 있습니다.

## 데모 실행

<img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-demo-picker.png" width="300" alt="예시마다 칩이 하나씩 있는 데모의 Layouts 탭">

데모의 Layouts 탭에서 이 문서의 레이아웃 예시를 하나씩 시작할 수 있습니다. 모바일 도구를
설정한 뒤 저장소 루트에서 실행합니다.

```sh
npm ci && npm run build:demo && cd examples/demo && npm run tauri -- ios dev
```

Android는 `android dev`를 씁니다. 요청 계약, 자세한 설정, 테스트 기록은
[docs](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/docs)에 있습니다.

## 라이선스

[MIT](LICENSE-MIT) 또는 [Apache-2.0](LICENSE-APACHE).
