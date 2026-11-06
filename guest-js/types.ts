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
  /** Layout activities of request contract v2. */
  readonly layout: FeatureSupport;
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
  /** Backend lifecycle state, not proof of visible UI. iOS stale transitions depend on ActivityKit observation; Android also uses the snapshot deadline. */
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

// Request contract v2: a layout tree, a style table and a value map. Its commands and types are
// separate from contract v1.

/** Text of at most 1000 Unicode code points, a number from -8640000000000000 to 8640000000000000, or a boolean. */
export type LayoutValue = string | number | boolean;

/** At most 32 entries. A key is an ASCII letter followed by up to 31 ASCII letters, digits or `_`. */
export interface LayoutValues {
  readonly [key: string]: LayoutValue;
}

export interface LayoutSnapshot {
  /** Nonnegative JavaScript safe integer; strictly increases when the values change. */
  readonly revision: number;
  /** The complete map. An update keeps the keys and the value types accepted at start. */
  readonly values: LayoutValues;
  /** UTC Unix epoch milliseconds. */
  readonly staleAt?: number;
}

type ColorName =
  | 'primary' | 'secondary' | 'accent' | 'red' | 'orange' | 'yellow' | 'green' | 'mint' | 'teal' | 'cyan'
  | 'blue' | 'indigo' | 'purple' | 'pink' | 'brown' | 'white' | 'black' | 'gray' | 'clear';
/** `#RRGGBB` or `#RRGGBBAA`. */
type HexColor = `#${string}`;

/** A semantic name, one hex color for both appearances, or a light and dark pair. */
export type LayoutColor = ColorName | HexColor | { readonly light: HexColor; readonly dark: HexColor };

type Anchor =
  | 'center' | 'leading' | 'trailing' | 'top' | 'bottom'
  | 'topLeading' | 'topTrailing' | 'bottomLeading' | 'bottomTrailing';

/** At least one member. Sizes are points from 0 to 1024. */
export interface LayoutFrame {
  readonly width?: number;
  readonly height?: number;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number | 'infinity';
  readonly maxHeight?: number | 'infinity';
  readonly alignment?: Anchor;
}

interface StyleFields {
  readonly weight?: 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';
  readonly design?: 'default' | 'rounded' | 'serif' | 'monospaced';
  readonly monospacedDigit?: boolean;
  /** Foreground color. */
  readonly color?: LayoutColor;
  /** Integer from 1 to 10. */
  readonly lineLimit?: number;
  /** From 0.1 to 1. */
  readonly minimumScaleFactor?: number;
  /** Alignment of text that spans several lines. */
  readonly alignment?: 'leading' | 'center' | 'trailing';
  /** Points from 0 to 64: one number for every edge, or `[top, leading, bottom, trailing]`. */
  readonly padding?: number | readonly [number, number, number, number];
  readonly frame?: LayoutFrame;
  readonly background?: LayoutColor;
  /** Points from 0 to 64. */
  readonly cornerRadius?: number;
  /** From 0 to 1. */
  readonly opacity?: number;
  /** Tint of buttons, progress views and gauges. */
  readonly tint?: LayoutColor;
  readonly buttonStyle?: 'automatic' | 'bordered' | 'borderedProminent' | 'plain';
}

/** At least one member. `font`, a system text style, and `size`, points from 6 to 96, exclude each other. */
export type LayoutStyle = StyleFields & (
  | {
    readonly font?: 'largeTitle' | 'title' | 'title2' | 'title3' | 'headline' | 'subheadline' | 'body'
      | 'callout' | 'footnote' | 'caption' | 'caption2';
    readonly size?: never;
  }
  | { readonly size?: number; readonly font?: never }
);

/** Members every node may carry. A condition names a value key; `if` and `unless` exclude each other. */
type NodeFields = {
  /** A token of the request's `styles` table. */
  readonly style?: string;
} & (
  | { readonly if?: string; readonly unless?: never }
  | { readonly unless?: string; readonly if?: never }
);

export type LayoutVStackNode = NodeFields & {
  readonly type: 'vstack';
  /** Between 1 and 12 nodes. */
  readonly children: readonly LayoutNode[];
  /** Points from 0 to 64. */
  readonly spacing?: number;
  readonly alignment?: 'leading' | 'center' | 'trailing';
};

export type LayoutHStackNode = NodeFields & {
  readonly type: 'hstack';
  /** Between 1 and 12 nodes. */
  readonly children: readonly LayoutNode[];
  /** Points from 0 to 64. */
  readonly spacing?: number;
  readonly alignment?: 'top' | 'center' | 'bottom' | 'firstTextBaseline';
};

export type LayoutZStackNode = NodeFields & {
  readonly type: 'zstack';
  /** Between 1 and 12 nodes. */
  readonly children: readonly LayoutNode[];
  readonly alignment?: Anchor;
};

export type LayoutSpacerNode = NodeFields & {
  readonly type: 'spacer';
  /** Points from 0 to 256. */
  readonly minLength?: number;
};

export type LayoutDividerNode = NodeFields & { readonly type: 'divider' };

/** Literal text of at most 200 Unicode code points, or the value of a key. */
export type LayoutTextNode = NodeFields & { readonly type: 'text' } & (
  | { readonly value: string; readonly bind?: never }
  | { readonly bind: string; readonly value?: never }
);

export type LayoutSymbolNode = NodeFields & {
  readonly type: 'symbol';
  /** SF Symbol name: lowercase letters and digits in parts joined by dots, 64 characters at most. */
  readonly name: string;
  readonly rendering?: 'monochrome' | 'hierarchical' | 'palette' | 'multicolor';
  /** Key of a number value: the symbol's variable value, from 0 to 1. */
  readonly variableBind?: string;
};

export type LayoutImageNode = NodeFields & {
  readonly type: 'image';
  /** Name of an image in the widget extension's asset catalog. */
  readonly source: { readonly asset: string };
  readonly resizable?: boolean;
  readonly contentMode?: 'fit' | 'fill';
};

export type LayoutPathNode = NodeFields & {
  readonly type: 'path';
  /** SVG path data of at most 512 bytes; commands `M L H V C S Q T Z` in either case, no arcs. */
  readonly d: string;
  /** `[width, height]` of the coordinate space of `d`, each from 1 to 1024. */
  readonly box: readonly [number, number];
  /** Line width from 0.5 to 16; the path is filled when absent. */
  readonly stroke?: number;
};

export type LayoutProgressNode = NodeFields & {
  readonly type: 'progress';
  /** Key of a number value, shown clamped to 0..1. */
  readonly bind: string;
  readonly kind?: 'linear' | 'circular';
};

export type LayoutGaugeNode = NodeFields & {
  readonly type: 'gauge';
  /** Key of a number value. */
  readonly bind: string;
  /** Defaults to 0; less than `max`. */
  readonly min?: number;
  /** Defaults to 1. */
  readonly max?: number;
  readonly kind?: 'linear' | 'circular';
};

export type LayoutTimerTextNode = NodeFields & {
  readonly type: 'timerText';
  /** Key of a number value: UTC Unix epoch milliseconds. */
  readonly start: string;
  /** Key of a number value: UTC Unix epoch milliseconds after `start`. */
  readonly end: string;
  /** Defaults to true. */
  readonly countsDown?: boolean;
};

/** Allowed in the lock screen and the expanded regions, never inside another button. */
export type LayoutButtonNode = NodeFields & {
  readonly type: 'button';
  /** Reported by `onAction`: starts with a letter or digit, then letters, digits or `._:-`, 64 characters at most. */
  readonly actionId: string;
  readonly child: LayoutNode;
};

export type LayoutNode =
  | LayoutVStackNode | LayoutHStackNode | LayoutZStackNode | LayoutSpacerNode | LayoutDividerNode
  | LayoutTextNode | LayoutSymbolNode | LayoutImageNode | LayoutPathNode | LayoutProgressNode
  | LayoutGaugeNode | LayoutTimerTextNode | LayoutButtonNode;

/** At least one region, each of at most 12 nodes. */
export interface LayoutIslandExpanded {
  readonly leading?: LayoutNode;
  readonly trailing?: LayoutNode;
  readonly center?: LayoutNode;
  readonly bottom?: LayoutNode;
}

/** At least one member; a missing part renders a default. */
export interface LayoutIsland {
  readonly expanded?: LayoutIslandExpanded;
  /** At most 3 nodes and no button. */
  readonly compactLeading?: LayoutNode;
  /** At most 3 nodes and no button. */
  readonly compactTrailing?: LayoutNode;
  /** At most 2 nodes and no button. */
  readonly minimal?: LayoutNode;
}

/** Trees are at most 8 levels deep and hold at most 4 buttons per region. */
export interface Layout {
  /** At most 40 nodes. */
  readonly lockScreen: LayoutNode;
  readonly island?: LayoutIsland;
  /** Tint behind the lock screen presentation. */
  readonly background?: LayoutColor;
  /** Tint of the Dynamic Island keyline. */
  readonly keyline?: LayoutColor;
}

export interface LayoutAndroidOptions {
  /** Lock screen visibility of the notification. */
  readonly visibility: 'public' | 'private' | 'secret';
}

export interface LayoutStartInput {
  /** Stable app-owned key; do not put credentials or private data in this key. */
  readonly activityKey: string;
  readonly schemaVersion: 2;
  /** Explicitly permits or forbids selection of the notification fallback. */
  readonly fallback: Fallback;
  /** Fixed for this generation; updates replace the values only. */
  readonly layout: Layout;
  /** Between 1 and 24 styles by token; a token follows the rule for value keys. */
  readonly styles?: { readonly [token: string]: LayoutStyle };
  readonly snapshot: LayoutSnapshot;
  /** Ignored on iOS. */
  readonly android?: LayoutAndroidOptions;
}

export interface LayoutUpdateInput {
  readonly id: string;
  /** Complete replacement snapshot, not a partial update. */
  readonly snapshot: LayoutSnapshot;
}

/** The record does not repeat the layout. */
export interface LayoutActivityRecord {
  /** Opaque handle for this generation; contract v1 commands do not see it. */
  readonly id: string;
  readonly activityKey: string;
  readonly schemaVersion: 2;
  readonly snapshot: LayoutSnapshot;
  readonly backend: Backend;
  readonly state: ActivityState;
  /** A successful OS call does not prove that the user can see the activity. */
  readonly visibility: 'unknown';
  /** What this backend left out, for example `layout.island` on Android. */
  readonly degradedFeatures: readonly string[];
  readonly promotionRequested: boolean;
  readonly promotionState: PromotionState;
}

/** A tap on a button node. */
export interface ActionEvent {
  readonly actionId: string;
  /** Handle of the activity that showed the button. */
  readonly activityId: string;
  /** The key of that activity, when the plugin knows it. */
  readonly activityKey?: string;
}
