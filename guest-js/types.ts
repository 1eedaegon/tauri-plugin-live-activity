/** OS capability, independent from the current permission or actual visibility. */
export type FeatureSupport = 'supported' | 'unsupported' | 'unknown';
export type Backend = 'activityKit' | 'androidNotification' | 'unsupported';
export type PermissionState =
  | 'granted' | 'denied' | 'prompt' | 'settingsRequired' | 'notApplicable' | 'unknown';
export type PermissionKind = 'notifications' | 'liveActivities' | 'promotion';

export interface Capabilities {
  readonly platform: string;
  readonly backend: Backend;
  readonly start: FeatureSupport;
  readonly update: FeatureSupport;
  readonly end: FeatureSupport;
  readonly progress: FeatureSupport;
  readonly timer: FeatureSupport;
  readonly actions: FeatureSupport;
  readonly stateObservation: FeatureSupport;
  readonly silentUpdate: FeatureSupport;
  readonly nativeLiveActivity: FeatureSupport;
  readonly maxPayloadBytes: number;
}

export interface Permissions {
  readonly notifications: PermissionState;
  readonly liveActivities: PermissionState;
  readonly promotion: PermissionState;
}

interface SnapshotFields {
  /** Nonnegative JavaScript safe integer; strictly increases when content changes. */
  readonly revision: number;
  /** Between 1 and 120 Unicode code points, excluding whitespace-only text. */
  readonly title: string;
  /** Between 1 and 240 Unicode code points, excluding whitespace-only text. */
  readonly status: string;
  /** UTC Unix epoch milliseconds. */
  readonly staleAt?: number;
}

export interface Timer {
  /** UTC Unix epoch milliseconds. */
  readonly startedAt: number;
  /** UTC Unix epoch milliseconds, strictly greater than startedAt. */
  readonly endsAt: number;
}

export interface ProgressSnapshot extends SnapshotFields {
  /** Finite normalized progress from 0 to 1 inclusive. */
  readonly progress: number;
  readonly timer?: never;
}

export interface TimerSnapshot extends SnapshotFields {
  readonly timer: Timer;
  readonly progress?: never;
}

export type Snapshot = ProgressSnapshot | TimerSnapshot;
export type Fallback = 'none' | 'notification';

interface StartFields {
  /** Stable app-owned key; do not put credentials or private data in this key. */
  readonly activityKey: string;
  readonly schemaVersion: 1;
  /** Explicitly permits or forbids selection of the notification fallback. */
  readonly fallback: Fallback;
}

export type StartInput = StartFields & (
  | { readonly template: 'progress'; readonly snapshot: ProgressSnapshot }
  | { readonly template: 'timer'; readonly snapshot: TimerSnapshot }
);

export interface UpdateInput {
  readonly id: string;
  /** Complete replacement snapshot, not a partial update. */
  readonly snapshot: Snapshot;
}

export type EndPolicy =
  | { readonly kind: 'immediate' | 'default' }
  | { readonly kind: 'after'; readonly at: number };

export interface EndInput {
  readonly id: string;
  /** Unsupported policies fail explicitly instead of being silently ignored. */
  readonly policy: EndPolicy;
}

export type ActivityState = 'active' | 'stale' | 'ended' | 'dismissed' | 'unknown';
export type PromotionState = 'promoted' | 'notPromoted' | 'unknown' | 'notApplicable';

export interface ActivityRecord {
  /** Opaque handle for this generation; a later start receives a new handle. */
  readonly id: string;
  readonly activityKey: string;
  readonly schemaVersion: 1;
  readonly template: 'progress' | 'timer';
  readonly snapshot: Snapshot;
  readonly backend: Backend;
  readonly state: ActivityState;
  /** A successful OS call does not prove that the user can see the activity. */
  readonly visibility: 'unknown';
  readonly degradedFeatures: readonly string[];
  readonly promotionRequested: boolean;
  readonly promotionState: PromotionState;
}

export type ErrorCode =
  | 'UNSUPPORTED_PLATFORM' | 'UNSUPPORTED_FEATURE' | 'PERMISSION_DENIED'
  | 'CONFIGURATION_REQUIRED' | 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE'
  | 'NOT_FOUND' | 'STALE_REVISION' | 'CONFLICT' | 'SYSTEM_LIMIT' | 'NATIVE_ERROR';

/** Native plugin rejections are structured objects, not JavaScript Error instances. */
export interface LiveActivityError {
  readonly code: ErrorCode;
  readonly message: string;
}
