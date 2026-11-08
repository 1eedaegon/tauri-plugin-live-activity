import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ActionEvent, ActivityRecord, Capabilities, EndInput, LayoutActivityRecord, LayoutStartInput,
  LayoutUpdateInput, PermissionKind, Permissions, StartInput, UpdateInput,
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

/** End this layout generation. A late update cannot revive it. */
export function endLayout(input: EndInput): Promise<LayoutActivityRecord> {
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
 * that `setup --app-group` configures (`CONFIGURATION_REQUIRED` without one); on Android the first such image
 * becomes the notification's large icon.
 */
export function writeImage(name: string, png: Uint8Array | ArrayBuffer): Promise<void> {
  const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
  return invoke('plugin:live-activity|write_image', { input: { name, png: Array.from(bytes) } });
}

/**
 * Receive button taps while this webview is alive; resolves to the function that stops listening.
 * Listening uses Tauri's event permissions (`core:event:default`).
 */
export function onAction(handler: (event: ActionEvent) => void): Promise<UnlistenFn> {
  return listen<ActionEvent>('live-activity://action', event => handler(event.payload));
}
