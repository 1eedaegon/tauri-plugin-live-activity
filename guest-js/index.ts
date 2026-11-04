import { invoke } from '@tauri-apps/api/core';
import type {
  ActivityRecord, Capabilities, EndInput, PermissionKind, Permissions, StartInput, UpdateInput,
} from './types.js';

export type * from './types.js';

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
