// Reads the few things setup needs from Tauri's XcodeGen spec (gen/apple/project.yml) and writes the
// spec file it includes. This is not a YAML parser: it reads top-level blocks and their child keys.
import { createHash } from 'node:crypto';

export const SPEC_FILE = 'live-activity.yml';
export const WIDGET = 'LiveActivityWidget';
/** The extension's entitlements, next to its folder so that XcodeGen does not take them for a source. */
export const WIDGET_ENTITLEMENTS = `${WIDGET}.entitlements`;
/** The Info.plist key of the extension that names the App Group, for the plugin and the widget. */
export const APP_GROUP_KEY = 'TauriLiveActivityAppGroup';
/** The files of the widget folder that the app target compiles too. */
export const APP_SOURCES = ['LiveActivityActionIntent.swift', 'LiveActivityCustomRegistry.swift', 'LiveActivityCustomViews.swift'];

const DIGEST_LINE = /^# setup-digest: ([0-9a-f]{16})\n/m;

function unquote(value) {
  const text = value?.trim();
  return text && /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text || undefined;
}

const isContent = line => line.trim() !== '' && !line.trim().startsWith('#');

/** The line of a top-level key and the lines under it, up to the next top-level key. */
function topLevel(lines, key) {
  const start = lines.findIndex(line => line === `${key}:` || line.startsWith(`${key}:`) && /\s/.test(line[key.length + 1]));
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length && (!isContent(lines[end]) || /^\s/.test(lines[end]))) end += 1;
  return { start, end, head: lines[start], body: lines.slice(start + 1, end) };
}

/** The keys one level under a block, each with its own lines. */
function children(body) {
  const indent = body.find(isContent)?.match(/^\s*/)[0];
  if (!indent) return [];
  const result = [];
  for (const line of body) {
    const key = line.startsWith(indent) && /^[^\s#-]/.test(line.slice(indent.length))
      ? /^\s*("[^"]*"|'[^']*'|[^:#]+?)\s*:(\s|$)/.exec(line)?.[1] : undefined;
    if (key) result.push({ name: unquote(key), lines: [] });
    else result.at(-1)?.lines.push(line);
  }
  return result;
}

/** The `path` under the `entitlements` key of a target's lines. */
function entitlementsPath(lines) {
  const at = lines.findIndex(line => /^\s+entitlements:\s*$/.test(line));
  if (at === -1) return undefined;
  const indent = /^\s*/.exec(lines[at])[0].length;
  for (const line of lines.slice(at + 1)) {
    if (isContent(line) && /^\s*/.exec(line)[0].length <= indent) break;
    const path = /^\s+path:\s*(.+?)\s*$/.exec(line)?.[1];
    if (path) return unquote(path);
  }
  return undefined;
}

/**
 * The project name, Tauri's app target (`<name>_iOS`) when it exists, the path of its entitlements, the
 * setting groups, the first bundle identifier and a target that already is a widget extension.
 */
export function readProject(text) {
  const lines = text.split('\n');
  const name = unquote(/^name:\s*(.+?)\s*$/m.exec(text)?.[1]);
  const targets = children(topLevel(lines, 'targets')?.body ?? []);
  const isWidget = target => target.name === WIDGET || target.lines.some(line => line.includes('com.apple.widgetkit-extension'));
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

/** The App Group of a spec that setup wrote, so that a later run keeps it. */
export function appGroupOf(spec = '') {
  const value = new RegExp(`^\\s+${APP_GROUP_KEY}: ("[^"\\n]*")$`, 'm').exec(spec)?.[1];
  return value && JSON.parse(value);
}

/**
 * Adds `file` to the spec's `include` list. Status: `added` (with the new `text`), `present`, or
 * `unsupported` when the list has a form this does not edit.
 */
export function addInclude(text, file) {
  const lines = text.split('\n');
  const block = topLevel(lines, 'include');
  if (!block) return { status: 'added', text: `${text.endsWith('\n') ? text : `${text}\n`}\ninclude:\n  - ${file}\n` };
  if ([block.head, ...block.body].some(line => line.includes(file))) return { status: 'present', text };
  const inline = /^include:\s*\[(.*)\]\s*$/.exec(block.head);
  if (inline) {
    const items = inline[1].trim();
    return { status: 'added', text: lines.with(block.start, `include: [${items ? `${items}, ` : ''}${file}]`).join('\n') };
  }
  const item = block.body.find(line => /^\s+-\s/.test(line));
  if (!/^include:\s*$/.test(block.head) || !item) return { status: 'unsupported', text };
  const last = block.start + 1 + block.body.findLastIndex(isContent);
  const entry = `${item.match(/^\s*/)[0]}- ${file}`;
  return { status: 'added', text: [...lines.slice(0, last + 1), entry, ...lines.slice(last + 1)].join('\n') };
}

const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** True when the spec is as setup wrote it: its digest line matches the rest of the file. */
export function writtenBySetup(text) {
  const match = DIGEST_LINE.exec(text);
  return Boolean(match) && digest(text.slice(match.index + match[0].length)) === match[1];
}

const quoted = value => JSON.stringify(String(value));

/**
 * The included spec: the widget extension target, and the button intent, the custom views and the extension
 * in the app target. `fonts` go to the extension's UIAppFonts. An `appGroup` goes to the entitlements of both
 * targets, the app's at `appEntitlements`, and to the extension's Info.plist, where the plugin and the widget
 * read it. XcodeGen merges the app target's part into the target of project.yml.
 */
export function widgetSpec({
  pluginVersion, packagePath, appTarget, bundleId, appVersion, buildVersion, teamGroup, fonts = [], appGroup, appEntitlements,
}) {
  const versions = appVersion === undefined ? [] : [
    `        CFBundleShortVersionString: ${quoted(appVersion)}`,
    `        CFBundleVersion: ${quoted(buildVersion ?? appVersion)}`,
  ];
  const fontList = fonts.length === 0 ? [] : ['        UIAppFonts:', ...fonts.map(font => `          - ${quoted(font)}`)];
  const group = appGroup === undefined ? [] : [`        ${APP_GROUP_KEY}: ${quoted(appGroup)}`];
  const entitlements = path => (appGroup === undefined ? [] : [
    '    entitlements:',
    `      path: ${path}`,
    '      properties:',
    `        com.apple.security.application-groups: [${quoted(appGroup)}]`,
  ]);
  const body = [
    'packages:',
    '  LiveActivity:',
    `    path: ${quoted(packagePath)}`,
    'targets:',
    `  ${quoted(appTarget)}:`,
    `    sources: [${APP_SOURCES.map(file => `${WIDGET}/${file}`).join(', ')}]`,
    `    dependencies: [{ target: ${WIDGET} }]`,
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
    '      - package: LiveActivity',
    '        product: LiveActivityShared',
    '      - package: LiveActivity',
    '        product: LiveActivityUI',
    '    info:',
    `      path: ${WIDGET}/Info.plist`,
    '      properties:',
    ...versions,
    '        NSExtension:',
    '          NSExtensionPointIdentifier: com.apple.widgetkit-extension',
    '        # startLayout answers CONFIGURATION_REQUIRED without an extension that declares this.',
    '        TauriLiveActivityLayout: 2',
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
    '# project.yml includes it. Setup writes it again for a new plugin version or app version, unless',
    '# the lines below were changed by hand.',
    `# setup-digest: ${digest(body)}`,
    body,
  ].join('\n');
}
