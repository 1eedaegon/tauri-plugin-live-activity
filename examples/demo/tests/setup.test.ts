// The demo is set up for layouts the way docs/usage.md tells an app to be, on activitykit's Swift products.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { list, member } from '../../../tests/support.ts';
import { activitykitDir } from '../../../tools/activitykit.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const project = read('../src-tauri/gen/apple/project.yml');

/** The YAML of one target in the XcodeGen spec, up to the next target. */
function target(name: string): string {
  const start = project.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, name);
  const rest = project.slice(start + 1);
  const end = rest.slice(1).search(/\n  [A-Za-z_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

// TP-SETUP-2
test("the demo widget is activitykit's widget template, and the project names activitykit's package", () => {
  const dir = activitykitDir({ manifest: new URL('../src-tauri/Cargo.toml', import.meta.url).pathname });
  const template = readFileSync(join(dir, 'templates/ios/Widget.swift'), 'utf8');
  const body = (text: string): string => text.slice(text.indexOf('@main'));
  assert.equal(body(read('../widget/MochiWidgets.swift')), body(template));
  assert.match(project, /\npackages:\n(?:\s*#.*\n)?\s+ActivityKit:\n\s+path: activitykit\/swift\n/);
  assert.match(read('../src-tauri/gen/apple/.gitignore'), /^\/activitykit$/m);
});

// TP-SETUP-2
test('the widget extension links ActivityKitWidget and declares layout support, the app links the intent', () => {
  const widget = target('LiveActivityWidget');
  assert.match(widget, /- package: ActivityKit\n\s+product: ActivityKitWidget\n/);
  assert.match(widget, /deploymentTarget: "16\.1"\n/);
  assert.match(widget, /ActivityKitLayout: 2\n/);
  for (const source of ['widget/MochiWidgets.swift', 'widget/Assets.xcassets']) assert.ok(widget.includes(source), source);
  assert.doesNotMatch(project, /LiveActivityShared|LiveActivityUI|TauriLiveActivity|templates\/ios/);
  const app = target('live-activity-demo_iOS');
  assert.match(app, /- package: ActivityKit\n\s+product: ActivityKitIntent\n/);
  assert.ok(app.includes('app/ActivityKitIntents.swift'));
  assert.match(read('../app/ActivityKitIntents.swift'), /^import ActivityKitIntent$/m);
});

// TP-SETUP-8
test('the widget extension draws the small family, as a Boolean in its Info.plist', () => {
  assert.match(target('LiveActivityWidget'), /\n {8}ActivityKitLayout: 2\n(?: {8}#.*\n)* {8}ActivityKitSmallFamily: true\n/);
  // XcodeGen writes the file from the spec; activitykit's widget reads a Boolean there, and no text.
  assert.match(read('../src-tauri/gen/apple/LiveActivityWidget/Info.plist'), /\t<key>ActivityKitSmallFamily<\/key>\n\t<true\/>\n/);
});

test('the app turns on the Samsung Now Bar extras and grants the layout commands', () => {
  const config: unknown = JSON.parse(read('../src-tauri/tauri.conf.json'));
  assert.deepEqual(member(config, 'plugins', 'live-activity'), { android: { samsungNowBar: true } });
  const permissions = list(member(JSON.parse(read('../src-tauri/capabilities/default.json')), 'permissions'), 'the permissions');
  for (const permission of ['core:default', 'live-activity:allow-start-layout', 'live-activity:allow-update-layout',
    'live-activity:allow-end-layout']) assert.ok(permissions.includes(permission), permission);
});

test('the page draws its two ornaments itself, and has neither as a character', () => {
  const page = read('../src/index.html');
  // U+273F and U+2726: the simulator of iOS 26.3 has no glyph for either and showed a boxed question mark.
  assert.doesNotMatch(page, /[\u273F\u2726]/u);
  for (const drawing of ['flower', 'spark']) {
    assert.ok(page.includes(`<symbol id="${drawing}" `), `no drawing of the ${drawing}`);
    assert.ok(page.includes(`<use href="#${drawing}"/>`), `the ${drawing} is drawn nowhere`);
  }
  // The app's content security policy takes no style of the page's own, as an attribute or as an element: the style
  // sheet gives the drawings their size.
  assert.doesNotMatch(page, /\sstyle\s*=|<style[\s>]/);
  assert.match(read('../src/styles.css'), /^\.glyph \{ width: 1em; height: 1em; /m);
});

test('the report of the browser check is of the check as it stands: its checks by their names, and the previews it keeps', () => {
  // No workflow runs examples/demo/tests/browser-qa.ts, so nothing else says when its report was left behind.
  const script = read('./browser-qa.ts');
  const report: unknown = JSON.parse(read('../design/browser-report.json'));
  const checks = [...script.matchAll(/await check\('([^']+)'/g)].map(match => match[1]);
  const previews = [...script.matchAll(/await capture\(\w+, '([^']+)'/g)].map(match => `${match[1]}.png`);
  assert.ok(checks.length > 0 && previews.length > 0, 'the script names its checks and previews in another way now');
  assert.deepEqual(list(member(report, 'checks'), 'the checks of the report'), checks);
  assert.deepEqual(list(member(report, 'renderedEvidence'), 'the previews of the report').map(preview => member(preview, 'artifact')), previews);
  for (const preview of previews) assert.ok(existsSync(new URL(`../design/${preview}`, import.meta.url)), `no file ${preview}`);
});

// TP-ANDROID-18
test('the demo is an app that can be allowed exact alarms: it declares the permission and grants the command', () => {
  // Android's setting lists an app only when its own manifest asks for the permission; the plugin's library asks for none.
  const manifest = read('../src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /<uses-permission android:name="android\.permission\.SCHEDULE_EXACT_ALARM" \/>/);
  assert.doesNotMatch(read('../../../android/src/main/AndroidManifest.xml'), /SCHEDULE_EXACT_ALARM/);
  // The page's button calls the command, which is not in the plugin's default set.
  const permissions = list(member(JSON.parse(read('../src-tauri/capabilities/default.json')), 'permissions'), 'the permissions');
  assert.ok(permissions.includes('live-activity:allow-open-exact-alarm-settings'));
  assert.match(read('../src/index.html'), /<button id="exact-alarms"/);
  const page = read('../src/main.ts');
  assert.ok(page.includes("'exact-alarms'"), 'the page has no handler for the button');
  assert.ok(page.includes('activity.openExactAlarmSettings()'), 'the page does not call the command');
});
