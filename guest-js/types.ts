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
  /** Pushes: tokens, channels and push-to-start (iOS). */
  readonly push: FeatureSupport;
  readonly maxPayloadBytes: number;
  /**
   * Which notification styles the device draws and what else it offers, for the `android` content of a snapshot and
   * for what follows a device: another style in an update, an update that alerts, a last content that stays. Android
   * only.
   */
  readonly androidPresentation?: AndroidPresentationSupport;
}

/**
 * The notification styles an Android device draws, and what it offers beside them. A member that the Android side
 * does not report is false.
 */
export interface AndroidPresentationSupport {
  readonly standard: boolean;
  readonly bigText: boolean;
  /** The timer style: a clock in the header and nothing else. */
  readonly timer: boolean;
  /** A progress with segments and points: Android 16. */
  readonly progressStyle: boolean;
  /** Up to three metrics: Android 17. */
  readonly metricStyle: boolean;
  readonly actions: boolean;
  readonly images: boolean;
  readonly events: boolean;
  readonly samsungNowBar: boolean;
  /** A clock in the header beside another style: the `chronometer` of a content, and a layout's timer beside its progress. */
  readonly chronometer: boolean;
  /** URLs that a tap on the notification or on an action opens in the app, and what `onOpened` reports. */
  readonly links: boolean;
  /** A snapshot of another notification style than the one the activity shows; `UNSUPPORTED_FEATURE` without it. */
  readonly styleChange: boolean;
  /** An end with the policy `after`, whose last content stays until its time; `UNSUPPORTED_FEATURE` without it. */
  readonly delayedEnd: boolean;
  /** The `foreground` placement of a start; `UNSUPPORTED_FEATURE` without it. */
  readonly foregroundPlacement: boolean;
  /** An update that alerts again. Without it the update is silent and the record names `alert`. */
  readonly alert: boolean;
  /** What a secure lock screen shows in place of the content of a private activity. */
  readonly publicVersion: boolean;
  /** A small icon, an accent color and a sub text. */
  readonly branding: boolean;
}

export interface Permissions {
  readonly notifications: PermissionState;
  readonly liveActivities: PermissionState;
  readonly promotion: PermissionState;
  /** Frequent pushes, a switch in Settings on iOS (`granted` or `denied`); `notApplicable` where there are no pushes. */
  readonly frequentPushes: PermissionState;
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

/** `pending`: scheduled and not started yet (iOS 26). */
export type ActivityState = 'pending' | 'active' | 'stale' | 'ended' | 'dismissed' | 'unknown';
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
  | 'UNSUPPORTED_PLATFORM' | 'UNSUPPORTED_FEATURE' | 'PERMISSION_DENIED' | 'NOT_FOREGROUND'
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
  /** Nonnegative JavaScript safe integer; strictly increases when the values change. Sent as given. */
  readonly revision: number;
  /** The complete map. An update keeps the keys and the value types accepted at start. */
  readonly values: LayoutValues;
  /** UTC Unix epoch milliseconds. */
  readonly staleAt?: number;
  /**
   * When the content was made, UTC Unix epoch milliseconds. ActivityKit (iOS 17.2) drops content older than what it
   * shows; without it iOS takes the time the content is sent. Android keeps it in the record.
   */
  readonly timestamp?: number;
  /**
   * Which of the app's activities the Dynamic Island shows first: the highest score wins. Without it the activity
   * keeps its score, 0 at first. Android ignores it, and an Android record does not repeat it.
   */
  readonly relevance?: number;
  /**
   * What Android shows for this snapshot instead of the projection of the layout. iOS ignores it, and an iOS record
   * does not repeat it.
   */
  readonly android?: AndroidContent;
}

/**
 * What the Android notification shows for a snapshot, in Android's own terms: a progress with segments and points,
 * metrics, the text of the status chip, icons of actions, the URL a tap opens, a clock in the header. It is checked
 * on every platform, so a wrong one is `INVALID_INPUT` on iOS too.
 *
 * A snapshot may have another notification style than the one the activity shows, a content of another style or the
 * projection of the layout after a content, where the device offers `styleChange`; elsewhere it is
 * `UNSUPPORTED_FEATURE` on Android, and the activity keeps what it shows. `getCapabilities().androidPresentation`
 * says which styles the device draws and which members of a presentation it offers. A tap on one of its actions comes
 * through `onAction`, unless the action opens a URL.
 */
export interface AndroidContent {
  /** The notification's title, 1 to 120 code points. */
  readonly title: string;
  /** The notification's text, 1 to 240 code points. */
  readonly status: string;
  readonly presentation: AndroidPresentation;
}

/**
 * The liveupdate crate's presentation of a notification. The members from `chronometer` on each need a device that
 * offers them, under the name their comment gives in `getCapabilities().androidPresentation`. A content is shown as
 * given or not at all: one that uses a member the device does not offer is `UNSUPPORTED_FEATURE` on Android. The
 * `alert` is the exception, since a revision can be shown without alerting.
 */
export interface AndroidPresentation {
  readonly style: AndroidStyle;
  /** The text of the status chip, at most 7 code points. */
  readonly shortCriticalText?: string;
  readonly largeIcon?: AndroidIcon;
  /** Up to three. */
  readonly actions?: readonly AndroidAction[];
  /** The texts of Samsung's Now Bar, where the title and the status are not what it should show. */
  readonly samsungNowBar?: { readonly primary?: string; readonly secondary?: string };
  /** A clock in the header, beside any style but `timer`, which is that clock alone (`chronometer`). */
  readonly chronometer?: AndroidTimerStyle;
  /**
   * The URL a tap on the notification opens in the app (`links`); without it a tap opens the launch activity. 1 to
   * 2048 printable ASCII characters with a lowercase scheme, which is none of `intent`, `content`, `file`,
   * `javascript`, `data` and `android-app`. An activity of the app declares the scheme: a URL that nothing in the
   * app opens is `INVALID_INPUT` on Android, and the content is not posted.
   */
  readonly openUrl?: string;
  /**
   * Whether this revision alerts again (`alert`); every other one updates silently. The `alert` of an update sets it
   * for both platforms. On a device that does not offer it the revision is silent, and the record names `alert` in
   * `degradedFeatures`.
   */
  readonly alert?: boolean;
  /**
   * What a secure lock screen shows in place of this content (`publicVersion`). Only for an activity that started as
   * `private`, as one does without `android.visibility`: `INVALID_INPUT` for another.
   */
  readonly publicVersion?: AndroidPublicVersion;
  /**
   * The small icon, a drawable or mipmap resource of the app and never a file (`branding`); without it the plugin's
   * own icon. A name that is no resource of the app is `INVALID_INPUT` on Android, and the content is not posted.
   */
  readonly smallIcon?: Extract<AndroidIcon, { readonly kind: 'resource' }>;
  /** The color of the icon and the header, an unsigned ARGB number such as `0xff2196f3` (`branding`). */
  readonly accentColor?: number;
  /** The third text of the header, at most 64 code points (`branding`). */
  readonly subText?: string;
}

export type AndroidStyle =
  | { readonly kind: 'standard' }
  | { readonly kind: 'bigText'; readonly value: { readonly text: string; readonly summary?: string } }
  | { readonly kind: 'progress'; readonly value: AndroidProgressStyle }
  | { readonly kind: 'timer'; readonly value: AndroidTimerStyle }
  | { readonly kind: 'metric'; readonly value: { readonly metrics: readonly AndroidMetric[]; readonly criticalMetric?: number } };

/** A clock in the header of the notification: down to the end of its timer, or up from its start. */
export interface AndroidTimerStyle {
  readonly timer: Timer;
  readonly countsDown: boolean;
}

/** What a secure lock screen shows in place of the content of a private activity. */
export interface AndroidPublicVersion {
  /** 1 to 120 code points. */
  readonly title: string;
  /** 1 to 240 code points. */
  readonly status: string;
}

export type AndroidSemanticStyle = 'unspecified' | 'info' | 'safe' | 'caution' | 'danger';

/** A drawable or mipmap resource of the app by name, or a file under the app's files, such as one `writeImage` wrote. */
export type AndroidIcon =
  | { readonly kind: 'resource'; readonly value: string }
  | { readonly kind: 'appFile'; readonly value: string };

export interface AndroidAction {
  /** Reported by `onAction`: starts with a letter or digit, then letters, digits or `._:-`, 64 characters at most. */
  readonly id: string;
  /** 1 to 64 code points. */
  readonly title: string;
  readonly icon?: AndroidIcon;
  /** Whether Android asks the person to unlock before the tap is sent. */
  readonly authenticationRequired?: boolean;
  /**
   * The URL the action opens in the app, by the rules of the presentation's `openUrl` (`links`). Such an action sends
   * no tap: `onOpened` reports the opening with the action's `id`.
   */
  readonly openUrl?: string;
}

/**
 * Android 16 draws the segments, the points and the icons; Android 17 also their semantic styles. Below Android 16
 * it is a plain bar.
 */
export interface AndroidProgressStyle {
  /** In the units of the segments, at most their sum. */
  readonly progress: number;
  readonly indeterminate?: boolean;
  /** Whether Android draws the part behind the progress differently from the part ahead. */
  readonly styledByProgress?: boolean;
  /** 1 to 32. */
  readonly segments: readonly AndroidProgressElement<'length'>[];
  /** Up to 32, each after the one before. */
  readonly points?: readonly AndroidProgressElement<'position'>[];
  readonly startIcon?: AndroidIcon;
  readonly endIcon?: AndroidIcon;
  readonly trackerIcon?: AndroidIcon;
}

/** A segment, with its `length`, or a point, with its `position`: a positive integer, and an optional ARGB color. */
export type AndroidProgressElement<Measure extends 'length' | 'position'> = {
  readonly [M in Measure]: number;
} & {
  readonly id?: number;
  readonly color?: number;
  readonly semanticStyle?: AndroidSemanticStyle;
};

export interface AndroidMetric {
  /** At most 10 code points. */
  readonly label: string;
  readonly value: AndroidMetricValue;
  readonly semanticStyle?: AndroidSemanticStyle;
}

/**
 * A number with an optional unit of at most 8 code points, a text of at most 64, a stopwatch that runs from
 * `startedAt` or a countdown that runs to `endsAt`, both UTC Unix epoch milliseconds.
 */
export type AndroidMetricValue =
  | { readonly kind: 'integer'; readonly value: { readonly value: number; readonly unit?: string } }
  | { readonly kind: 'decimal'; readonly value: { readonly value: number; readonly unit?: string } }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'stopwatch'; readonly value: { readonly startedAt: number } }
  | { readonly kind: 'countdown'; readonly value: { readonly endsAt: number } };

/**
 * An alert that comes with an update, or with a scheduled start. On iOS the device lights up, the Dynamic Island
 * expands and an Apple Watch shows the title and the body. On Android the notification alerts again with that
 * revision, with its own title and text, where the device offers `alert` (`getCapabilities().androidPresentation`);
 * elsewhere the update is silent and the record names `alert` in `degradedFeatures`.
 */
export interface LayoutAlert {
  /** 1 to 120 code points. */
  readonly title: string;
  /** 1 to 240 code points. */
  readonly body: string;
  /**
   * The sound of the alert on iOS: the file name of a sound in the app's bundle or in its `Library/Sounds`, such as
   * `chime.aiff`, 1 to 64 ASCII letters, digits, `.`, `_` and `-`, starting with a letter or digit. Without it the
   * system plays its default sound. Android alerts with the sound of its channel, which is the person's choice, and
   * the record names `alert.sound` in `degradedFeatures`.
   */
  readonly sound?: string;
}

type ColorName =
  | 'primary' | 'secondary' | 'accent' | 'red' | 'orange' | 'yellow' | 'green' | 'mint' | 'teal' | 'cyan'
  | 'blue' | 'indigo' | 'purple' | 'pink' | 'brown' | 'white' | 'black' | 'gray' | 'clear';
/** `#RRGGBB` or `#RRGGBBAA`. */
type HexColor = `#${string}`;

/** A semantic name, one hex color for both appearances, or a light and dark pair. */
export type LayoutColor = ColorName | HexColor | { readonly light: HexColor; readonly dark: HexColor };

/**
 * A value key in place of a literal, as `layout.bind(key)` writes it. The member reads the value on
 * every render, so an update can change it. The value must be what the member takes as a literal: a
 * color name or a hex color (not a light and dark pair), a weight name, a number in the member's range, or
 * a URL. A member of a node's `accessibility` reads a value of any type.
 */
export interface LayoutBound {
  readonly bind: string;
}

/** A literal, or a value key that an update can change. */
export type LayoutBindable<T> = T | LayoutBound;

type FontWeight = 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';

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

/** Points from 0 to 64: one number for every edge, or `[top, leading, bottom, trailing]`. */
export type LayoutPadding = number | readonly [number, number, number, number];

/**
 * `weight`, `color`, `background`, `cornerRadius`, `opacity`, `tint` and `size` may be bound to a value
 * with `layout.bind(key)`. The other members are fixed at start.
 */
interface StyleFields {
  readonly weight?: LayoutBindable<FontWeight>;
  readonly monospacedDigit?: boolean;
  /** Foreground color. */
  readonly color?: LayoutBindable<LayoutColor>;
  /** Integer from 1 to 10. */
  readonly lineLimit?: number;
  /** From 0.1 to 1. */
  readonly minimumScaleFactor?: number;
  /** Alignment of text that spans several lines. */
  readonly alignment?: 'leading' | 'center' | 'trailing';
  readonly padding?: LayoutPadding;
  readonly frame?: LayoutFrame;
  readonly background?: LayoutBindable<LayoutColor>;
  /** Points from 0 to 64. */
  readonly cornerRadius?: LayoutBindable<number>;
  /** From 0 to 1. */
  readonly opacity?: LayoutBindable<number>;
  /** Tint of buttons, toggles, progress views and gauges. */
  readonly tint?: LayoutBindable<LayoutColor>;
  readonly buttonStyle?: 'automatic' | 'bordered' | 'borderedProminent' | 'plain';
  /**
   * How text and symbols with the style change when an update gives them another value. `numericText` rolls the
   * digits upward, `numericTextDown` the other way.
   */
  readonly contentTransition?: 'numericText' | 'numericTextDown' | 'opacity' | 'interpolate' | 'identity';
}

/**
 * At least one member. `font`, a system text style, and `size`, points from 6 to 96, exclude each other.
 * `fontFamily`, the PostScript or family name of a font that the widget extension bundles (`setup --font`),
 * and `design`, a design of the system font, exclude each other too.
 */
export type LayoutStyle = StyleFields & (
  | {
    readonly font?: 'largeTitle' | 'title' | 'title2' | 'title3' | 'headline' | 'subheadline' | 'body'
      | 'callout' | 'footnote' | 'caption' | 'caption2';
    readonly size?: never;
  }
  | { readonly size?: LayoutBindable<number>; readonly font?: never }
) & (
  | { readonly design?: 'default' | 'rounded' | 'serif' | 'monospaced'; readonly fontFamily?: never }
  /** 1 to 64 ASCII letters, digits, spaces, `.`, `_` and `-`, starting with a letter or digit. */
  | { readonly fontFamily?: string; readonly design?: never }
);

/**
 * What a node tells assistive technologies such as VoiceOver: at least one member. `label`, `value` and `hint` are
 * text of 1 to 200 code points, or `layout.bind(key)` for a value of any type, which is read as a text node shows it;
 * a value that is missing or empty leaves its member out. On a stack or a custom node, any of the three makes the
 * node one element that stands for what is inside; a button or a link inside stays an action of it. Without a member
 * the system reads its own: the text of a text node, the title of a button, the name of an SF Symbol. A path, an
 * image and a custom view have none: label them or hide them. Android has no label per node.
 */
export type LayoutAccessibility =
  | {
    /** What the node is, in a few words. */
    readonly label?: LayoutBindable<string>;
    /** What the node shows now, such as `40 percent`. */
    readonly value?: LayoutBindable<string>;
    /** What happens when the person acts on the node. */
    readonly hint?: LayoutBindable<string>;
    readonly hidden?: false;
  }
  /** `hidden: true` hides the node and its subtree, for what is decoration, and then stands alone. */
  | { readonly hidden: true; readonly label?: never; readonly value?: never; readonly hint?: never };

/** How a node comes and goes when its `if` or `unless` shows or hides it. iOS runs these and no others. */
export type LayoutTransition =
  | 'opacity' | 'slide' | 'moveTop' | 'moveBottom' | 'moveLeading' | 'moveTrailing'
  | 'pushTop' | 'pushBottom' | 'pushLeading' | 'pushTrailing';

/** Members every node may carry. A condition names a value key; `if` and `unless` exclude each other. */
type NodeFields = {
  /** A token of the request's `styles` table. */
  readonly style?: string;
  /**
   * `true`: the node and its subtree are drawn only while the content is stale; `false`: only while it is not.
   * Content is stale once the snapshot's `staleAt` has passed and no newer content has come: iOS then draws the stale
   * nodes without an update and without the app running. Beside `if` or `unless` the node is drawn while both hold.
   * Android draws the layout as it is while fresh and names `layout.ifStale` in `degradedFeatures`.
   */
  readonly ifStale?: boolean;
  /** What assistive technologies read of the node. */
  readonly accessibility?: LayoutAccessibility;
  /** How the node comes and goes when its `if` or `unless` shows or hides it. Without it the system chooses. */
  readonly transition?: LayoutTransition;
  /**
   * `sensitive` marks what the node and its subtree show as private: iOS hides it on a locked device and in the
   * always-on display when the person has asked for that.
   */
  readonly privacy?: 'sensitive';
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

/**
 * `asset`: an image in the widget extension's asset catalog. `file`: a PNG that the app wrote with
 * `writeImage(file, png)`. A name is 1 to 64 ASCII letters, digits, `.`, `_` and `-`, starting with a letter or digit.
 */
export type LayoutImageSource =
  | { readonly asset: string; readonly file?: never }
  | { readonly file: string; readonly asset?: never };

export type LayoutImageNode = NodeFields & {
  readonly type: 'image';
  readonly source: LayoutImageSource;
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

/**
 * Allowed in the lock screen and the expanded regions, never inside a button, a link or a toggle. A region holds at
 * most 4 buttons, links and toggles together.
 */
export type LayoutButtonNode = NodeFields & {
  readonly type: 'button';
  /** Reported by `onAction`: starts with a letter or digit, then letters, digits or `._:-`, 64 characters at most. */
  readonly actionId: string;
  readonly child: LayoutNode;
};

/**
 * A tap on the child opens the app with the URL, which the app receives as any URL it is opened with; no event
 * reports it on iOS. A link stands where a button may, and neither holds the other. On Android, where the device
 * offers `links`, it is an action of the notification that opens its URL, and `onOpened` reports it.
 */
export type LayoutLinkNode = NodeFields & {
  readonly type: 'link';
  /**
   * 1 to 1024 ASCII characters: a scheme, a colon and at least one more character, such as `myapp://delivery/7`, in
   * the characters of RFC 3986 with a `%` only before two hex digits. Or `layout.bind(key)` for a text value that is
   * such a URL. Only the form is checked: the app decides what it follows.
   */
  readonly url: LayoutBindable<string>;
  readonly child: LayoutNode;
};

/**
 * A switch beside its label (iOS 17; before, the label alone). It shows the boolean value of `bind`. A tap comes
 * through `onAction` with `on`, the state the person asked for, and does not move the switch: send an update with
 * the new value, or none to refuse the change. A toggle stands where a button may.
 */
export type LayoutToggleNode = NodeFields & {
  readonly type: 'toggle';
  /** Reported by `onAction`, as a button's. */
  readonly actionId: string;
  /** Key of a boolean value: the state the switch shows. */
  readonly bind: string;
  /** The label. */
  readonly child: LayoutNode;
};

/**
 * A SwiftUI view that the app registers under `name` in LiveActivityCustomViews.swift of its widget extension.
 * A name without a view draws nothing and is reported in `degradedFeatures` as `layout.custom.<name>`; Android
 * shows no custom view (`layout.custom`).
 */
export type LayoutCustomNode = NodeFields & {
  readonly type: 'custom';
  /** 1 to 64 ASCII letters, digits, `.`, `_` and `-`, starting with a letter or digit. */
  readonly name: string;
  /**
   * 1 to 16 inputs of the view under value-key names: text of at most 200 code points, a number, a boolean, or
   * `layout.bind(key)` for a value that each update can change.
   */
  readonly props?: { readonly [name: string]: LayoutBindable<LayoutValue> };
};

export type LayoutNode =
  | LayoutVStackNode | LayoutHStackNode | LayoutZStackNode | LayoutSpacerNode | LayoutDividerNode
  | LayoutTextNode | LayoutSymbolNode | LayoutImageNode | LayoutPathNode | LayoutProgressNode
  | LayoutGaugeNode | LayoutTimerTextNode | LayoutButtonNode | LayoutLinkNode | LayoutToggleNode | LayoutCustomNode;

/** At least one region, each of at most 12 nodes. `priority` and `belowIfTooWide` are options, and no region. */
export interface LayoutIslandExpanded {
  readonly leading?: LayoutNode;
  readonly trailing?: LayoutNode;
  readonly center?: LayoutNode;
  readonly bottom?: LayoutNode;
  /**
   * At least one member, each a number from 0 to 100 for a region the layout has. The region with the higher one gets
   * the width first; a region without one has 0.
   */
  readonly priority?: {
    readonly leading?: number;
    readonly trailing?: number;
    readonly center?: number;
    readonly bottom?: number;
  };
  /**
   * The regions beside the camera that go below it when they are too wide to stand beside it: `leading`, `trailing`
   * or both, each once and each a region the layout has.
   */
  readonly belowIfTooWide?: readonly ('leading' | 'trailing')[];
}

/**
 * The margins between a presentation of the Dynamic Island and what it shows, as a style's `padding`. At least one
 * member; a presentation without them keeps the system's.
 */
export interface LayoutIslandMargins {
  readonly expanded?: LayoutPadding;
  readonly compactLeading?: LayoutPadding;
  readonly compactTrailing?: LayoutPadding;
  readonly minimal?: LayoutPadding;
}

/** At least one part; a missing part renders a default. `margins` are an option, and no part. */
export interface LayoutIsland {
  readonly expanded?: LayoutIslandExpanded;
  /** At most 3 nodes and no button, link or toggle. */
  readonly compactLeading?: LayoutNode;
  /** At most 3 nodes and no button, link or toggle. */
  readonly compactTrailing?: LayoutNode;
  /** At most 3 nodes and no button, link or toggle. */
  readonly minimal?: LayoutNode;
  readonly margins?: LayoutIslandMargins;
}

/** Trees are at most 8 levels deep and hold at most 4 buttons, links and toggles per region. */
export interface Layout {
  /** At most 40 nodes. */
  readonly lockScreen: LayoutNode;
  readonly island?: LayoutIsland;
  /** Tint behind the lock screen presentation. */
  readonly background?: LayoutBindable<LayoutColor>;
  /** Tint of the Dynamic Island keyline. */
  readonly keyline?: LayoutBindable<LayoutColor>;
  /**
   * The URL a tap on the activity opens the app with, on the Lock Screen and in every presentation of the Dynamic
   * Island: a URL as a link node's, or `layout.bind(key)` for a text value that is one. Without it a tap opens the
   * app without a URL. On Android, where the device offers `links`, it is what a tap on the notification opens.
   */
  readonly url?: LayoutBindable<string>;
}

/** What only Android reads of a start. */
export interface LayoutAndroidOptions {
  /** Lock screen visibility of the notification. A start without `android` is `private`. */
  readonly visibility: 'public' | 'private' | 'secret';
  /**
   * What a secure lock screen shows in place of the content. Only with the visibility `private`: `INVALID_INPUT`
   * otherwise, on every platform. It goes with every snapshot that has no public version of its own. On a device that
   * does not offer `publicVersion` the snapshot is shown without it, and the record names `publicVersion` in
   * `degradedFeatures`.
   */
  readonly publicVersion?: AndroidPublicVersion;
  /**
   * How Android keys the notification. `tagged`, which it is when absent, is a notification of its own. `foreground`
   * is the one that a foreground service of the app holds, so that the service shows no second one: one running
   * activity has it at a time (`SYSTEM_LIMIT` for a second), and a device that does not offer `foregroundPlacement`
   * answers `UNSUPPORTED_FEATURE`.
   */
  readonly placement?: 'tagged' | 'foreground';
}

/**
 * What a layout activity asks ActivityKit for on iOS: a push token of its own, which `onPushToken` reports, or a
 * broadcast channel the server made at APNs (iOS 18; `UNSUPPORTED_FEATURE` before). Android ignores it.
 */
export type LayoutPush = 'token' | { readonly channel: string };

/**
 * What only iOS reads of a start. Android ignores it, and the options are no part of what makes two starts the same
 * activity.
 */
export interface LayoutIosOptions {
  /**
   * `true` asks for a transient activity (iOS 18; `UNSUPPORTED_FEATURE` before). By Apple's description it shows in
   * the expanded Dynamic Island, and the system ends it when the person locks the device, collapses that presentation
   * or leaves the app.
   */
  readonly transient: boolean;
}

/**
 * A start at a later time instead of now (iOS 26; an older iOS and Android answer `UNSUPPORTED_FEATURE`, and nothing
 * is kept). Until then the record is `pending`: the activity holds its key, it can be ended, and an update is
 * `CONFLICT`, since it begins with the content of its start. `onState` reports `active` when it begins.
 */
export interface LayoutScheduledStart {
  /** UTC Unix epoch milliseconds. A time that has passed starts the activity at once. */
  readonly at: number;
  /** The alert the system shows when it starts the activity: it requires one. */
  readonly alert: LayoutAlert;
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
  /** Ignored on Android. */
  readonly ios?: LayoutIosOptions;
  /** Starts the activity at a later time instead of now. */
  readonly scheduled?: LayoutScheduledStart;
  /** Ignored on Android. */
  readonly push?: LayoutPush;
}

export interface LayoutUpdateInput {
  readonly id: string;
  /** Complete replacement snapshot, not a partial update. */
  readonly snapshot: LayoutSnapshot;
  /** An alert that comes with the update; without it the update is silent. */
  readonly alert?: LayoutAlert;
}

/**
 * The end of a layout activity. With `snapshot` it ends with that final content, checked as an update; without one it
 * ends with the last accepted values.
 */
export interface LayoutEndInput extends EndInput {
  readonly snapshot?: LayoutSnapshot;
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

/** A push token of an activity, new or changed: what the server sends to. */
export interface PushTokenEvent {
  readonly activityId: string;
  /** The key of that activity, when the plugin knows it. */
  readonly activityKey?: string;
  /** Lowercase hex, as APNs takes it. */
  readonly token: string;
}

/** The app's push-to-start token, new or changed (`pushToStart` in the plugin configuration, iOS 17.2). */
export interface PushToStartTokenEvent {
  readonly token: string;
}

/**
 * Content a push delivered: the activity's record with it, above every revision the app sent or accepted. The record
 * is the activity's state when the plugin reads the event: two pushes close together may both report the later one.
 */
export interface UpdatedEvent {
  readonly record: LayoutActivityRecord;
}

/** A layout activity that began while the app ran: one the app started, or one a push started (iOS). */
export interface StartedEvent {
  readonly record: LayoutActivityRecord;
}

/**
 * A new lifecycle state of an activity, of a template or a layout. iOS reports the changes ActivityKit tells of
 * while the app runs. Android reports the state an activity has when the plugin looks, if it is another than the
 * one it reported last: `active` once Android shows the notification, `stale` after the snapshot's `staleAt`,
 * `ended`, and `dismissed` when the person removed the notification. An activity is over at `ended` and at
 * `dismissed`: take either as its end.
 */
export interface StateEvent {
  /** Handle of the activity. */
  readonly activityId: string;
  /** The key of that activity, when the plugin knows it. */
  readonly activityKey?: string;
  readonly state: ActivityState;
}

/**
 * The push tokens the plugin holds since launch (iOS): the newest token of each of the last 32 activities that got
 * one, and the app's push-to-start token. Empty where there are no pushes.
 */
export interface PushTokens {
  readonly pushToStart?: string;
  /** In the order the activities' first tokens came. */
  readonly activities: readonly PushTokenEvent[];
}

/** A tap on a button or a toggle node, or on an action of an Android content. */
export interface ActionEvent {
  readonly actionId: string;
  /** Handle of the activity that showed it. */
  readonly activityId: string;
  /** The key of that activity, when the plugin knows it. */
  readonly activityKey?: string;
  /**
   * For a toggle: the state the person asked for, the other one than the value the switch showed. The tap changes
   * nothing: send an update with that value to move the switch. Absent for a button and for an action of an Android
   * content.
   */
  readonly on?: boolean;
}

/**
 * The person opened the app from the notification of an activity (Android): by the notification itself, or by one
 * of its actions that opens a URL. The app receives the URL as any deep link; this says which activity it came
 * from.
 */
export interface OpenedEvent {
  /** Handle of the activity. */
  readonly activityId: string;
  /** The key of that activity, when the plugin knows it. */
  readonly activityKey?: string;
  /**
   * The action that opened the app, when the person tapped one and not the notification itself: `link:<n>` for the
   * nth `link` node of the layout, or the id of an action of an Android content.
   */
  readonly actionId?: string;
}
