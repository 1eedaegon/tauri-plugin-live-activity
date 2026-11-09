// The demo is set up for layouts the way docs/usage.md tells an app to be, on activitykit's Swift products.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { activitykitDir } from '../../../tools/sync-contract.mjs';

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

test('the app turns on the Samsung Now Bar extras and grants the layout commands', () => {
  const config = JSON.parse(read('../src-tauri/tauri.conf.json'));
  assert.deepEqual(config.plugins['live-activity'], { android: { samsungNowBar: true } });
  const { permissions } = JSON.parse(read('../src-tauri/capabilities/default.json'));
  for (const permission of ['core:default', 'live-activity:allow-start-layout', 'live-activity:allow-update-layout',
    'live-activity:allow-end-layout']) assert.ok(permissions.includes(permission), permission);
});
