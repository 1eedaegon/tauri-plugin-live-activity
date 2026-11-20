// Reads the few things setup needs from Tauri's XcodeGen spec (gen/apple/project.yml) and writes the
// spec file it includes. This is not a YAML parser: it reads top-level blocks and their child keys.
import { createHash } from 'node:crypto';
import { parseJson } from './steps.mjs';

export const SPEC_FILE = 'live-activity.yml';
export const WIDGET = 'LiveActivityWidget';
/** The extension's entitlements, next to its folder so that XcodeGen does not take them for a source. */
export const WIDGET_ENTITLEMENTS = `${WIDGET}.entitlements`;
/** The Info.plist key of the extension that names the App Group, for activitykit and the widget. */
export const APP_GROUP_KEY = 'ActivityKitAppGroup';
/** The key of 0.2 and 0.3, which a spec they wrote may hold. */
const OLD_APP_GROUP_KEY = 'TauriLiveActivityAppGroup';
/** The Info.plist key of the extension with which activitykit's widget draws the small family. */
export const SMALL_FAMILY_KEY = 'ActivityKitSmallFamily';
/**
 * The files of the widget folder that the app target compiles too. The custom views file is Swift, so the app target
 * compiles Swift, which Xcode needs to take the App Intents metadata of the linked ActivityKitIntent product.
 */
export const APP_SOURCES: readonly string[] = ['LiveActivityCustomViews.swift'];

const DIGEST_LINE = /^# setup-digest: ([0-9a-f]{16})\n/m;

/** A top-level key of the spec: where its lines stand, its own line and the lines under it. */
interface Block {
  readonly start: number;
  readonly end: number;
  readonly head: string;
  readonly body: readonly string[];
}

/** A key one level under a block, with the lines under it. */
interface Child {
  readonly name: string | undefined;
  readonly lines: string[];
}

/** What setup reads of Tauri's XcodeGen spec. */
export interface XcodeProject {
  readonly name: string | undefined;
  /** Tauri's app target, `<name>_iOS`, when the spec has it. */
  readonly appTarget: string | undefined;
  /** The path of the app target's entitlements, when the spec names one. */
  readonly entitlements: string | undefined;
  readonly settingGroups: readonly (string | undefined)[];
  /** The first bundle identifier of the spec. */
  readonly bundleId: string | undefined;
  /** A target that already is a widget extension. */
  readonly widget: string | undefined;
}

/**
 * What `addInclude` did: `added` (with the new `text`), `present`, or `unsupported` when the list has a form it does
 * not edit.
 */
export interface IncludeResult {
  readonly status: 'added' | 'present' | 'unsupported';
  readonly text: string;
}

/** What the included spec is written from. */
export interface WidgetSpec {
  readonly pluginVersion: string;
  /** The folder of activitykit's Swift package. */
  readonly packagePath: string;
  readonly appTarget: string;
  /** The bundle identifier of the widget extension. */
  readonly bundleId: string;
  /** The app's version, which the extension's has to match. Without one the extension's Info.plist names none. */
  readonly appVersion?: string;
  readonly buildVersion?: string;
  /** Whether the spec has Tauri's `app` setting group, which the extension then takes too. */
  readonly teamGroup: boolean;
  readonly fonts?: readonly string[];
  readonly appGroup: string | undefined;
  /** The path of the app target's entitlements. */
  readonly appEntitlements: string;
  readonly smallFamily?: boolean;
}

function unquote(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text || undefined;
}

const isContent = (line: string): boolean => line.trim() !== '' && !line.trim().startsWith('#');

/** The white space that a line begins with. */
const indentOf = (line: string): string => line.slice(0, line.length - line.trimStart().length);

/** The line of a top-level key and the lines under it, up to the next top-level key. */
function topLevel(lines: readonly string[], key: string): Block | undefined {
  const start = lines.findIndex(line => line === `${key}:` || line.startsWith(`${key}:`) && /^\s/.test(line.slice(key.length + 1)));
  const head = lines[start];
  if (head === undefined) return undefined;
  const next = lines.findIndex((line, index) => index > start && isContent(line) && !/^\s/.test(line));
  const end = next === -1 ? lines.length : next;
  return { start, end, head, body: lines.slice(start + 1, end) };
}

/** The keys one level under a block, each with its own lines. */
function children(body: readonly string[]): Child[] {
  const first = body.find(isContent);
  const indent = first === undefined ? '' : indentOf(first);
  if (!indent) return [];
  const result: Child[] = [];
  for (const line of body) {
    const key = line.startsWith(indent) && /^[^\s#-]/.test(line.slice(indent.length))
      ? /^\s*("[^"]*"|'[^']*'|[^:#]+?)\s*:(\s|$)/.exec(line)?.[1] : undefined;
    if (key) result.push({ name: unquote(key), lines: [] });
    else result.at(-1)?.lines.push(line);
  }
  return result;
}

/** The `path` under the `entitlements` key of a target's lines. */
function entitlementsPath(lines: readonly string[]): string | undefined {
  const at = lines.findIndex(line => /^\s+entitlements:\s*$/.test(line));
  const head = lines[at];
  if (head === undefined) return undefined;
  const indent = indentOf(head).length;
  for (const line of lines.slice(at + 1)) {
    if (isContent(line) && indentOf(line).length <= indent) break;
    const path = /^\s+path:\s*(.+?)\s*$/.exec(line)?.[1];
    if (path) return unquote(path);
  }
  return undefined;
}

/**
 * The project name, Tauri's app target (`<name>_iOS`) when it exists, the path of its entitlements, the
 * setting groups, the first bundle identifier and a target that already is a widget extension.
 */
export function readProject(text: string): XcodeProject {
  const lines = text.split('\n');
  const name = unquote(/^name:\s*(.+?)\s*$/m.exec(text)?.[1]);
  const targets = children(topLevel(lines, 'targets')?.body ?? []);
  const isWidget = (target: Child): boolean => target.name === WIDGET || target.lines.some(line => line.includes('com.apple.widgetkit-extension'));
  const app = targets.find(target => name && target.name === `${name}_iOS`);
  return {
    name,
    appTarget: app?.name,
    entitlements: app && entitlementsPath(app.lines),
    settingGroups: children(topLevel(lines, 'settingGroups')?.body ?? []).map(group => group.name),
    bundleId: unquote(/^\s*PRODUCT_BUNDLE_IDENTIFIER:\s*(\S+)\s*$/m.exec(text)?.[1]),
    widget: targets.find(isWidget)?.name,
  };
}

/** The App Group of a spec that setup wrote, this version or 0.2 and 0.3, so that a later run keeps it. */
export function appGroupOf(spec = ''): string | undefined {
  const value = new RegExp(`^\\s+(?:${APP_GROUP_KEY}|${OLD_APP_GROUP_KEY}): ("[^"\\n]*")$`, 'm').exec(spec)?.[1];
  const group = value === undefined ? undefined : parseJson(value);
  return typeof group === 'string' ? group : undefined;
}

/** Whether a spec that setup wrote has the widget draw the small family, so that a later run keeps that. */
export function drawsSmallFamily(spec = ''): boolean {
  return new RegExp(`^\\s+${SMALL_FAMILY_KEY}: true$`, 'm').test(spec);
}

/**
 * Adds `file` to the spec's `include` list. Status: `added` (with the new `text`), `present`, or
 * `unsupported` when the list has a form this does not edit.
 */
export function addInclude(text: string, file: string): IncludeResult {
  const lines = text.split('\n');
  const block = topLevel(lines, 'include');
  if (!block) return { status: 'added', text: `${text.endsWith('\n') ? text : `${text}\n`}\ninclude:\n  - ${file}\n` };
  if ([block.head, ...block.body].some(line => line.includes(file))) return { status: 'present', text };
  if (/^include:\s*\[.*\]\s*$/.test(block.head)) {
    const items = block.head.slice(block.head.indexOf('[') + 1, block.head.lastIndexOf(']')).trim();
    return { status: 'added', text: lines.with(block.start, `include: [${items ? `${items}, ` : ''}${file}]`).join('\n') };
  }
  const item = block.body.find(line => /^\s+-\s/.test(line));
  if (!/^include:\s*$/.test(block.head) || !item) return { status: 'unsupported', text };
  const last = block.start + 1 + block.body.findLastIndex(isContent);
  const entry = `${indentOf(item)}- ${file}`;
  return { status: 'added', text: [...lines.slice(0, last + 1), entry, ...lines.slice(last + 1)].join('\n') };
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** True when the spec is as setup wrote it: its digest line matches the rest of the file. */
export function writtenBySetup(text: string): boolean {
  const match = DIGEST_LINE.exec(text);
  return match !== null && digest(text.slice(match.index + match[0].length)) === match[1];
}

const quoted = (value: string): string => JSON.stringify(value);

/**
 * The included spec: activitykit's Swift package, the widget extension target, and in the app target the extension,
 * the button intent and the custom views. `fonts` go to the extension's UIAppFonts. An `appGroup` goes to the
 * entitlements of both targets, the app's at `appEntitlements`, and to the extension's Info.plist, where activitykit
 * and the widget read it. With `smallFamily` the extension's Info.plist says that the widget draws the small family,
 * for a paired Apple Watch and CarPlay. XcodeGen merges the app target's part into the target of project.yml.
 */
export function widgetSpec({
  pluginVersion, packagePath, appTarget, bundleId, appVersion, buildVersion, teamGroup, fonts = [], appGroup, appEntitlements,
  smallFamily = false,
}: WidgetSpec): string {
  const versions = appVersion === undefined ? [] : [
    `        CFBundleShortVersionString: ${quoted(appVersion)}`,
    `        CFBundleVersion: ${quoted(buildVersion ?? appVersion)}`,
  ];
  const fontList = fonts.length === 0 ? [] : ['        UIAppFonts:', ...fonts.map(font => `          - ${quoted(font)}`)];
  const group = appGroup === undefined ? [] : [`        ${APP_GROUP_KEY}: ${quoted(appGroup)}`];
  const entitlements = (path: string): string[] => (appGroup === undefined ? [] : [
    '    entitlements:',
    `      path: ${path}`,
    '      properties:',
    `        com.apple.security.application-groups: [${quoted(appGroup)}]`,
  ]);
  const product = (name: string): string[] => ['      - package: ActivityKit', `        product: ${name}`];
  const body = [
    'packages:',
    '  ActivityKit:',
    `    path: ${quoted(packagePath)}`,
    'targets:',
    `  ${quoted(appTarget)}:`,
    `    sources: [${APP_SOURCES.map(file => `${WIDGET}/${file}`).join(', ')}]`,
    '    dependencies:',
    `      - target: ${WIDGET}`,
    // The system runs a button's intent in the app. The bridge itself is in the Rust library already.
    ...product('ActivityKitIntent'),
    ...product('ActivityKitViews'),
    ...entitlements(quoted(appEntitlements)),
    '    settings:',
    '      base:',
    '        SWIFT_VERSION: "5.0"',
    `  ${WIDGET}:`,
    '    type: app-extension',
    '    platform: iOS',
    '    deploymentTarget: "16.1"',
    `    sources: [${WIDGET}]`,
    '    dependencies:',
    ...product('ActivityKitWidget'),
    ...product('ActivityKitViews'),
    '    info:',
    `      path: ${WIDGET}/Info.plist`,
    '      properties:',
    ...versions,
    '        NSExtension:',
    '          NSExtensionPointIdentifier: com.apple.widgetkit-extension',
    '        # A start answers CONFIGURATION_REQUIRED without an extension that declares this.',
    '        ActivityKitLayout: 2',
    ...(smallFamily ? [`        ${SMALL_FAMILY_KEY}: true`] : []),
    ...fontList,
    ...group,
    ...entitlements(WIDGET_ENTITLEMENTS),
    '    settings:',
    ...(teamGroup ? ['      groups: [app]'] : []),
    '      base:',
    `        PRODUCT_NAME: ${WIDGET}`,
    `        PRODUCT_BUNDLE_IDENTIFIER: ${quoted(bundleId)}`,
    '        SWIFT_VERSION: "5.0"',
    '        APPLICATION_EXTENSION_API_ONLY: YES',
    '        SKIP_INSTALL: YES',
    '',
  ].join('\n');
  return [
    `# Written by \`npx tauri-plugin-live-activity setup\` for tauri-plugin-live-activity ${pluginVersion}.`,
    '# project.yml includes it. Setup writes it again for a new plugin or activitykit version or app version, unless',
    '# the lines below were changed by hand.',
    `# setup-digest: ${digest(body)}`,
    body,
  ].join('\n');
}
