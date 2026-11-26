import type {
  ActivityRecord, AndroidPresentationSupport, PermissionKind, PermissionState, Permissions,
} from '../../../guest-js/index.js';

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

/**
 * Whether to offer Android's setting for exact alarms: a start can be scheduled, and would begin when Android
 * chooses instead of at its time. Of the capabilities it reads what Android's presentation says of a scheduled start.
 */
export function offersExactAlarms(
  capabilities: { readonly androidPresentation?: Pick<AndroidPresentationSupport, 'scheduledStart' | 'exactStart'> },
): boolean {
  const android = capabilities.androidPresentation;
  return android !== undefined && android.scheduledStart && !android.exactStart;
}

export function exactAlarmFeedback(allowed: boolean): string {
  return allowed
    ? 'Exact alarms are allowed: a scheduled start begins on the minute.'
    : 'Exact alarms are still off: a scheduled start may begin minutes late.';
}

/**
 * Whether to offer Android's screen of Live Updates: Android 16 promotes notifications, and the person turned them
 * off for this app or minimized its channel, which the plugin reads as `settingsRequired`, Android having no dialog
 * for them.
 */
export function offersPromotionSettings(permissions: Pick<Permissions, 'promotion'>): boolean {
  return permissions.promotion === 'settingsRequired';
}

/** What the page says once Android was asked for that screen, which does not tell when the person is back. */
export function promotionFeedback(): string {
  return 'Allow Live Updates for this app in Android’s screen, then come back and refresh.';
}

/** The record that the page goes on with: the one it had while that lives, or the first that is on the screen. */
export function selectCurrent<Listed extends Pick<ActivityRecord, 'id' | 'state'>>(
  records: readonly Listed[], previous: Pick<ActivityRecord, 'id'> | undefined,
): Listed | undefined {
  const retained = records.find(record => record.id === previous?.id
    && record.state !== 'ended' && record.state !== 'dismissed');
  return retained ?? records.find(record => record.state === 'active' || record.state === 'stale');
}
