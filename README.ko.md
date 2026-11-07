# tauri-plugin-live-activity

[![npm](https://img.shields.io/npm/v/tauri-plugin-live-activity)](https://www.npmjs.com/package/tauri-plugin-live-activity)
[![crates.io](https://img.shields.io/crates/v/tauri-plugin-live-activity)](https://crates.io/crates/tauri-plugin-live-activity)
[![CI](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/1eedaegon/tauri-plugin-live-activity/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

Tauri 2 앱이 하고 있는 일을 iPhone 잠금 화면과 Dynamic Island에, Android에서는 진행 중 알림으로
보여 줍니다. 레이아웃은 TypeScript로 적고, 그리는 일은 플러그인이 맡습니다.
[English](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/README.md)

<table>
  <tr><th>iOS 잠금 화면</th><th>Dynamic Island</th></tr>
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

네 장 모두 고양이 Mochi를 따라가는 [데모 앱](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo)에서
캡처했습니다. 플러그인은 iOS 16.1 이상과 Android 8 이상에서 동작하고, 데스크톱에서는 활동 명령이
`UNSUPPORTED_PLATFORM`을 돌려줍니다. 1.0 전까지는 마이너 버전이 바뀔 때 API도 바뀔 수 있습니다.

## 설치

Tauri 2 앱 폴더에서 실행합니다.

```sh
cargo add tauri-plugin-live-activity --manifest-path src-tauri/Cargo.toml
npm i tauri-plugin-live-activity
npx tauri-plugin-live-activity setup
```

그리고 `src-tauri/src/lib.rs`의 빌더에 한 줄을 더합니다.

```rust
.plugin(tauri_plugin_live_activity::init())
```

`setup`은 플러그인 권한을 허용하고, Android 최소 버전을 API 26으로 올리고, Mac에서는 활동을 그리는
위젯 확장을 Xcode 프로젝트에 추가합니다. `tauri ios init` 뒤에 실행하고, 나중에 `src-tauri/gen/apple`을
처음부터 다시 만들었다면 한 번 더 실행하세요. 무엇이 바뀔지는 `--dry-run`으로 먼저 볼 수 있습니다.

## 사용법

```ts
import { getCapabilities, layout, requestPermissions, startLayout, updateLayout, endLayout } from 'tauri-plugin-live-activity';

const { vstack, bound, progress } = layout;
const { platform } = await getCapabilities();
await requestPermissions(platform === 'android' ? 'notifications' : 'liveActivities');

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

레이아웃은 시작할 때 모습 그대로 유지됩니다. 갱신할 때는 모든 값을 더 높은 revision과 함께 다시
보냅니다.

## 레이아웃에 넣을 수 있는 것

- `text`, `bound`: 고정된 글자나 키의 값을 원하는 스타일로
- `symbol`: SF Symbols. 값에 따라 채울 수도 있습니다
- `image`: 위젯 asset catalog에 넣은 그림
- `path`: SVG 경로 데이터로 그린 도형
- `gauge`, `progress`: 숫자를 링이나 막대로
- `timerText`: 시스템이 대신 세는 타이머. 줄어들게도, 늘어나게도 셉니다
- `button`: `onAction`이나 Rust의 `on_action`으로 전달되는 탭(iOS 17 이상)
- 배치에 쓰는 `vstack`, `hstack`, `zstack`, `spacer`, `divider`, 그리고 Dynamic Island의 각 부분을
  따로 정하는 `island`

<table>
  <tr><th>심볼</th><th>이미지</th><th>게이지</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-symbols.png" width="260" alt="고양이, 다색 하트, 35% 채운 스피커 심볼"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-image.png" width="260" alt="위젯 asset catalog에서 가져온 Mochi 초상"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-gauge.png" width="260" alt="100 중 80을 가리키는 원형 게이지와 막대 게이지"></td>
  </tr>
  <tr><th>진행률</th><th>타이머</th><th>버튼</th></tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-progress.png" width="260" alt="65%의 링과 막대"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-timer.png" width="260" alt="Mochi 낮잠 아래 4:50에서 줄어드는 타이머"></td>
    <td><img src="https://raw.githubusercontent.com/1eedaegon/tauri-plugin-live-activity/main/docs/images/ios-layout-buttons-after.png" width="260" alt="한 번 쓰다듬은 뒤의 Pet Mochi, All done 버튼"></td>
  </tr>
</table>

Android에서는 레이아웃을 알림으로 보여 줍니다. 첫 두 텍스트가 제목과 본문이 되고, 첫 진행 막대와
타이머, 버튼 세 개까지 들어갑니다. 빠진 것은 `degradedFeatures`에 남습니다.

## Samsung Now Bar

`tauri.conf.json`에 `"plugins": { "live-activity": { "android": { "samsungNowBar": true } } }`를 넣으면
One UI 9의 Now Bar가 보여 줄 제목과 본문을 함께 보냅니다. 다만 One UI는 Samsung 허용 목록에 있는
앱만 Now Bar에 띄우고(개발자 옵션 "Live notifications for all apps"를 켜면 모든 앱), 플러그인이 앱을
그 목록에 넣을 수는 없습니다.

## 더 알아보기

나머지는 [문서](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/docs)에 있습니다.
`setup`이 바꾸는 내용과 손으로 설정하는 방법, iOS·Android 캡처가 붙은 레이아웃 노드 전체, Rust에서
버튼을 처리하는 방법, 진행률·타이머 템플릿, 플러그인 옵션, 테스트 기록을 영어로 정리했습니다.

## 라이선스

[MIT](LICENSE-MIT) 또는 [Apache-2.0](LICENSE-APACHE).
