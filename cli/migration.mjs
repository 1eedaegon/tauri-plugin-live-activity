// What setup changes in an app that tauri-plugin-live-activity 0.2 or 0.3 set up, whose widget extension and app
// target compiled the plugin's own Swift: 0.4 takes the widget, the button intent and the custom views registry from
// activitykit's Swift package.
import { createHash } from 'node:crypto';

/** The SHA-256 of each template as a release of the plugin wrote it into the widget folder. */
export const RELEASED = {
  // 0.2.0, 0.2.1 and 0.3.0: the button intent, which activitykit's ActivityKitIntent product replaces.
  'LiveActivityActionIntent.swift': ['cd96e40c42aae84b2e76db2f264f8ead892bf77c282e51f7443dc8624bc3ead5'],
  // 0.3.0: the base of the custom views, which activitykit's ActivityKitViews product replaces.
  'LiveActivityCustomRegistry.swift': ['75c2275fe63da34234fca039ed459151edb851c1acf1faf0e6a400791345983f'],
  // 0.2.x and 0.3.0: the widget bundle on the plugin's own Swift modules.
  'LiveActivityWidget.swift': [
    '2a76d033acbbd208c7050e10394c31c120ad96d0ff55189daed11ad5255cbd2c',
    'a8abe58a70300204b1406e5dbcc0d53f6265b525785903d5b2e6e1d2b317476d',
  ],
};

/** Files that only the plugin's own Swift needed. */
export const RETIRED = ['LiveActivityActionIntent.swift', 'LiveActivityCustomRegistry.swift'];

/** The Swift modules of the plugin before 0.4; a widget file that imports one no longer builds. */
export const OLD_MODULES = /\bimport\s+(LiveActivityShared|LiveActivityUI|LiveActivityCore)\b/;

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** True when `text` is the file `name` exactly as a release wrote it. */
export function released(name, text) {
  return RELEASED[name]?.includes(sha256(text)) ?? false;
}

// The names of 0.3's custom views file and activitykit's, longest first: `LiveActivityCustomView` is a prefix of the
// other two, and the class `LiveActivityCustomViews` keeps its Swift name.
const RENAMES = [
  ['TauriLiveActivityCustomViews', 'ActivityKitCustomViews'],
  ['LiveActivityCustomViewRegistry', 'ActivityKitCustomViewRegistry'],
  ['LiveActivityCustomProps', 'ActivityKitCustomProps'],
  ['LiveActivityCustomView', 'ActivityKitCustomView'],
];

/**
 * The app's custom views file with activitykit's names: the Objective-C name, the registry, the view and props types,
 * and `import ActivityKitViews`. The app's views stay as they are. Undefined when the file has none of 0.3's names.
 */
export function renameCustomViews(text) {
  if (!RENAMES.some(([old]) => new RegExp(`\\b${old}\\b`).test(text))) return undefined;
  let next = RENAMES.reduce((current, [old, name]) => current.replace(new RegExp(`\\b${old}\\b`, 'g'), name), text);
  if (!/^\s*import\s+ActivityKitViews\b/m.test(next)) {
    const swiftUI = /^import SwiftUI[ \t]*$/m.exec(next);
    next = swiftUI
      ? `${next.slice(0, swiftUI.index)}import ActivityKitViews\n${next.slice(swiftUI.index)}`
      : `import ActivityKitViews\n${next}`;
  }
  return next;
}
