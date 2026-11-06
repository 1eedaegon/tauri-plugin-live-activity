// The demo is set up for layouts the way the README tells an app to be.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const template = read('../../../templates/ios/LiveActivityWidget.swift');
const project = read('../src-tauri/gen/apple/project.yml');

/** The YAML of one target in the XcodeGen spec, up to the next target. */
function target(name) {
  const start = project.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, name);
  const rest = project.slice(start + 1);
  const end = rest.slice(1).search(/\n  [A-Za-z_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

test('the demo widget carries the template layout widget unchanged', () => {
  const begin = template.indexOf('/// Layout activities');
  const end = template.indexOf('@main');
  assert.ok(begin > 0 && end > begin);
  assert.ok(read('../widget/LiveActivityLayoutWidget.swift').includes(template.slice(begin, end).trim()));
  assert.match(read('../widget/MochiWidget.swift'), /MochiWidget\(\)\s+LiveActivityLayoutWidget\(\)/);
});

test('the widget extension links both package products, has the intent and declares layout support', () => {
  const widget = target('LiveActivityWidget');
  for (const product of ['LiveActivityShared', 'LiveActivityUI']) assert.match(widget, new RegExp(`product: ${product}\\n`));
  for (const source of ['widget/MochiWidget.swift', 'widget/LiveActivityLayoutWidget.swift', 'widget/Assets.xcassets',
    'templates/ios/LiveActivityActionIntent.swift']) assert.ok(widget.includes(source), source);
  assert.match(widget, /TauriLiveActivityLayout: 2\n/);
  assert.match(read('../src-tauri/gen/apple/LiveActivityWidget/Info.plist'),
    /<key>TauriLiveActivityLayout<\/key>\s*<integer>2<\/integer>/);
});

test('the app target compiles its own copy of the intent and links no package product', () => {
  const app = target('live-activity-demo_iOS');
  assert.ok(app.includes('templates/ios/LiveActivityActionIntent.swift'));
  assert.doesNotMatch(app, /package: LiveActivity/);
});

test('the app turns on the Samsung Now Bar extras and grants the layout commands', () => {
  const config = JSON.parse(read('../src-tauri/tauri.conf.json'));
  assert.deepEqual(config.plugins['live-activity'], { android: { samsungNowBar: true } });
  const { permissions } = JSON.parse(read('../src-tauri/capabilities/default.json'));
  for (const permission of ['core:default', 'live-activity:allow-start-layout', 'live-activity:allow-update-layout',
    'live-activity:allow-end-layout']) assert.ok(permissions.includes(permission), permission);
});
