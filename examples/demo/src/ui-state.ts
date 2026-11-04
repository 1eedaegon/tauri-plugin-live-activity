import type { ActivityRecord, PermissionKind, PermissionState } from '../../../guest-js/index.js';

export function permissionFeedback(state: PermissionState): string {
  if (state === 'granted') return 'All set for your next little moment.';
  if (state === 'notApplicable') return 'No permission is needed for this activity.';
  if (state === 'prompt' || state === 'unknown') return 'Access is not confirmed yet. You can try the permission button again.';
  return 'Permission checked. Allow access in Settings, then refresh.';
}

export function permissionAction(platform: string): { readonly kind: PermissionKind; readonly label: string } {
  return platform === 'ios'
    ? { kind: 'liveActivities', label: 'Check Live Activity settings' }
    : { kind: 'notifications', label: 'Request notification permission' };
}

export function selectCurrent(
  records: readonly ActivityRecord[], previous: ActivityRecord | undefined,
): ActivityRecord | undefined {
  const retained = records.find(record => record.id === previous?.id
    && record.state !== 'ended' && record.state !== 'dismissed');
  return retained ?? records.find(record => record.state === 'active' || record.state === 'stale');
}
