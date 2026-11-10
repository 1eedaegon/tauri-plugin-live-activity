import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ActionEvent, ActivityRecord, Capabilities, EndInput, LayoutActivityRecord, LayoutEndInput, LayoutStartInput,
  LayoutUpdateInput, PermissionKind, Permissions, PushToStartTokenEvent, PushTokenEvent, PushTokens, StartInput,
  UpdateInput, UpdatedEvent,
} from './types.js';

export type * from './types.js';
/** Builders for the nodes of a layout tree. */
export * as layout from './layout.js';

/** Read backend features; this does not request OS permissions. */
export function getCapabilities(): Promise<Capabilities> {
  return invoke('plugin:live-activity|get_capabilities', {});
}

/** Read current OS permission states without showing a permission prompt. */
export function checkPermissions(): Promise<Permissions> {
  return invoke('plugin:live-activity|check_permissions', {});
}

/** Request an OS permission where supported; settings-only controls report that state. */
export function requestPermissions(kind: PermissionKind): Promise<Permissions> {
  return invoke('plugin:live-activity|request_permissions', { kind });
}

/** Start an activity; repeated identical starts for an active key are idempotent. */
export function start(input: StartInput): Promise<ActivityRecord> {
  return invoke('plugin:live-activity|start', { input });
}

/** Replace the entire snapshot with a newer revision. */
export function update(input: UpdateInput): Promise<ActivityRecord> {
  return invoke('plugin:live-activity|update', { input });
}

/** End this generation. A late update cannot revive it. */
export function end(input: EndInput): Promise<ActivityRecord> {
  return invoke('plugin:live-activity|end', { input });
}

/** Reconcile plugin-owned records with the OS; unknown is a valid observed state. */
export function list(): Promise<readonly ActivityRecord[]> {
  return invoke('plugin:live-activity|list', {});
}

/** Start a layout activity (contract v2); repeated identical starts for an active key are idempotent. */
export function startLayout(input: LayoutStartInput): Promise<LayoutActivityRecord> {
  return invoke('plugin:live-activity|start_layout', { input });
}

/** Replace every value with a newer revision; the layout stays as started. */
export function updateLayout(input: LayoutUpdateInput): Promise<LayoutActivityRecord> {
  return invoke('plugin:live-activity|update_layout', { input });
}

/** End this layout generation, with final content when `snapshot` is given. A late update cannot revive it. */
export function endLayout(input: LayoutEndInput): Promise<LayoutActivityRecord> {
  return invoke('plugin:live-activity|end_layout', { input });
}

/** Reconcile plugin-owned layout records with the OS; `list` reports contract v1 activities. */
export function listLayout(): Promise<readonly LayoutActivityRecord[]> {
  return invoke('plugin:live-activity|list_layout', {});
}

/**
 * Write a PNG that `image` nodes with the source `{ file: name }` show, replacing one of that name. The widget
 * reads it each time it draws the activity, on start and on every update, so write the picture first and then
 * update. At most 1 MiB and 1224 x 480 pixels (`PAYLOAD_TOO_LARGE` beyond). On iOS it needs the App Group
 * that `setup --app-group` configures (`CONFIGURATION_REQUIRED` without one), where activitykit writes it to
 * `activitykit/images`; on Android the first such image
 * becomes the notification's large icon.
 */
export function writeImage(name: string, png: Uint8Array | ArrayBuffer): Promise<void> {
  const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
  return invoke('plugin:live-activity|write_image', { input: { name, png: Array.from(bytes) } });
}

/**
 * Receive button taps while this webview is alive; resolves to the function that stops listening.
 * Listening uses Tauri's event permissions (`core:event:default`). The tap reaches the page after the Rust
 * `on_action` handlers have run; the tap's intent does not wait for this handler, which runs in the webview whenever it
 * gets the event, and not at all while the webview is suspended or was never created. Act on taps in Rust when they
 * must not be lost.
 */
export function onAction(handler: (event: ActionEvent) => void): Promise<UnlistenFn> {
  return listen<ActionEvent>('live-activity://action', event => handler(event.payload));
}

/**
 * The push tokens the plugin holds since launch (iOS): the newest token of each of the last 32 activities that got
 * one, and the app's push-to-start token. The events report each token as it comes, but an event reaches only the
 * listeners there are when it goes out, and a token may come before the page listens, at launch above all:
 * `onPushToken` and `onPushToStartToken` read this right after subscribing. Empty where there are no pushes. The
 * read is in the plugin's `default` permission.
 */
export function pushTokens(): Promise<PushTokens> {
  return invoke('plugin:live-activity|push_tokens');
}

/**
 * Receive the push token of each activity that asked for one (`push: 'token'`), when ActivityKit gives it and each
 * time it changes (iOS), and first those the plugin already holds, each token once. Send it to the server, which
 * pushes to it with activitykit's `push::Payload`. Rejects, subscribed to nothing, when the plugin cannot be asked
 * for the tokens it holds.
 */
export async function onPushToken(handler: (event: PushTokenEvent) => void): Promise<UnlistenFn> {
  const delivered = new Map<string, string>();
  const deliver = (event: PushTokenEvent): void => {
    if (delivered.get(event.activityId) === event.token) return;
    delivered.set(event.activityId, event.token);
    handler(event);
  };
  const unlisten = await listen<PushTokenEvent>('live-activity://push-token', event => deliver(event.payload));
  const held = await heldTokens(unlisten);
  // An event that came while the plugin was asked is newer than what it held for that activity.
  for (const event of held.activities) if (!delivered.has(event.activityId)) deliver(event);
  return unlisten;
}

/**
 * Receive the app's push-to-start token, with `pushToStart: true` in the plugin configuration (iOS 17.2), when the
 * system gives it and each time it changes, and first the one the plugin already holds, each token once. The server
 * starts activities with it. Rejects, subscribed to nothing, when the plugin cannot be asked for the token it holds.
 */
export async function onPushToStartToken(handler: (event: PushToStartTokenEvent) => void): Promise<UnlistenFn> {
  let last: string | undefined;
  const deliver = (event: PushToStartTokenEvent): void => {
    if (event.token === last) return;
    last = event.token;
    handler(event);
  };
  const unlisten = await listen<PushToStartTokenEvent>('live-activity://push-to-start-token', event => deliver(event.payload));
  const held = await heldTokens(unlisten);
  if (last === undefined && held.pushToStart !== undefined) deliver({ token: held.pushToStart });
  return unlisten;
}

/** What the plugin holds, or the subscription given up and the failure passed on. */
async function heldTokens(unlisten: UnlistenFn): Promise<PushTokens> {
  try {
    return await pushTokens();
  } catch (error) {
    unlisten();
    throw error;
  }
}

/**
 * Receive the record of an activity whose content a push changed (iOS): content above every revision this app sent
 * or accepted, so the app's own updates do not come this way. Content pushed before the page listened is in the
 * activity's record, as `listLayout` gives it.
 */
export function onUpdated(handler: (event: UpdatedEvent) => void): Promise<UnlistenFn> {
  return listen<UpdatedEvent>('live-activity://updated', event => handler(event.payload));
}
