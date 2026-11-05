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

플러그인은 상태를 표시합니다. 실제 작업과 백그라운드 실행은 호스트 앱이 담당합니다.
알림 표시와 승격 여부는 OS 설정에 따라 달라집니다.

[실행 가능한 예제](https://github.com/1eedaegon/tauri-plugin-live-activity/tree/main/examples/demo) ·
[검증 결과](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/validation.md) ·
[OS별 지원 범위](https://github.com/1eedaegon/tauri-plugin-live-activity/blob/main/docs/platform-coverage.md)

## 라이선스

[MIT](LICENSE-MIT) 또는 [Apache-2.0](LICENSE-APACHE).
