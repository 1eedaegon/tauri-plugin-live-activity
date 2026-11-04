import type { ActivityRecord, PermissionKind } from '../../../guest-js/index.js';

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
