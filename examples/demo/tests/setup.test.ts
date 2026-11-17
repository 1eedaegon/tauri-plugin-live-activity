// The demo is set up for layouts the way docs/usage.md tells an app to be, on activitykit's Swift products.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { activitykitDir } from '../../../tools/activitykit.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const project = read('../src-tauri/gen/apple/project.yml');

/** The YAML of one target in the XcodeGen spec, up to the next target. */
function target(name) {
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
  const body = text => text.slice(text.indexOf('@main'));
  assert.equal(body(read('../widget/MochiWidgets.swift')), body(template));
  assert.match(project, /\npackages:\n(?:\s*#.*\n)?\s+ActivityKit:\n\s+path: activitykit\/swift\n/);
  assert.match(read('../src-tauri/gen/apple/.gitignore'), /^\/activitykit$/m);
});

// TP-SETUP-2
test('the widget extension links ActivityKitWidget and declares layout support, the app links the intent', () => {
  const widget = target('LiveActivityWidget');
  assert.match(widget, /- package: ActivityKit\n\s+product: ActivityKitWidget\n/);
  assert.match(widget, /deploymentTarget: "16\.2"\n/);
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
  const config = JSON.parse(read('../src-tauri/tauri.conf.json'));
  assert.deepEqual(config.plugins['live-activity'], { android: { samsungNowBar: true } });
  const { permissions } = JSON.parse(read('../src-tauri/capabilities/default.json'));
  for (const permission of ['core:default', 'live-activity:allow-start-layout', 'live-activity:allow-update-layout',
    'live-activity:allow-end-layout']) assert.ok(permissions.includes(permission), permission);
});

// TP-ANDROID-18
test('the demo is an app that can be allowed exact alarms: it declares the permission and grants the command', () => {
  // Android's setting lists an app only when its own manifest asks for the permission; the plugin's library asks for none.
  const manifest = read('../src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /<uses-permission android:name="android\.permission\.SCHEDULE_EXACT_ALARM" \/>/);
  assert.doesNotMatch(read('../../../android/src/main/AndroidManifest.xml'), /SCHEDULE_EXACT_ALARM/);
  // The page's button calls the command, which is not in the plugin's default set.
  const { permissions } = JSON.parse(read('../src-tauri/capabilities/default.json'));
  assert.ok(permissions.includes('live-activity:allow-open-exact-alarm-settings'));
  assert.match(read('../src/index.html'), /<button id="exact-alarms"/);
  const page = read('../src/main.ts');
  assert.ok(page.includes("'exact-alarms'"), 'the page has no handler for the button');
  assert.ok(page.includes('activity.openExactAlarmSettings()'), 'the page does not call the command');
});
