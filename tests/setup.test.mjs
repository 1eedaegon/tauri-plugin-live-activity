// `npx tauri-plugin-live-activity setup` against copies of a fresh Tauri 2 app. The fixture under
// fixtures/setup/fresh-app comes from `tauri init`, `tauri ios init` and `tauri android init` of
// @tauri-apps/cli 2.12.4. Fake `cargo` and `xcodegen` executables stand in for the real tools.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from '../cli/main.mjs';
import { setTrueKey } from '../cli/plist.mjs';
import { formatReport } from '../cli/report.mjs';
import { PERMISSIONS, SetupError, findCrates, setup } from '../cli/setup.mjs';
import { fontNames } from '../cli/widget-files.mjs';
import { addInclude, appGroupOf, readProject } from '../cli/xcodegen.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
// The crate the fixtures stand in for has the package's own version unless a test says otherwise.
const packageVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const laterPatch = n => packageVersion.replace(/\d+$/, patch => String(Number(patch) + n));
const fixtures = join(repo, 'tests', 'fixtures', 'setup');
const nodeDir = dirname(process.execPath);

const FAKE_CARGO = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.FAKE_CARGO_FAIL) { process.stderr.write('error: failed to load manifest\\n'); process.exit(101); }
process.stdout.write(fs.readFileSync(process.env.FAKE_METADATA, 'utf8'));
`;

// Writes a project.pbxproj that names the widget target when the spec includes it, like XcodeGen.
const FAKE_XCODEGEN = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(process.env.FAKE_XCODEGEN_LOG, process.argv.slice(2).join(' ') + '\\n');
if (process.env.FAKE_XCODEGEN_FAIL) { process.stderr.write('Spec validation error\\n'); process.exit(1); }
const spec = process.argv[process.argv.indexOf('--spec') + 1];
const dir = path.dirname(spec);
const name = /^name: (.+)$/m.exec(fs.readFileSync(spec, 'utf8'))[1];
const widget = fs.readFileSync(spec, 'utf8').includes('live-activity.yml') ? '/* LiveActivityWidget */' : '';
fs.mkdirSync(path.join(dir, name + '.xcodeproj'), { recursive: true });
fs.writeFileSync(path.join(dir, name + '.xcodeproj', 'project.pbxproj'), '// ' + name + '_iOS ' + widget + '\\n');
`;

function executable(path, text) {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/** activitykit's widget template, as the fake activitykit crate holds it. */
const AK_WIDGET = 'import ActivityKitWidget\nimport SwiftUI\nimport WidgetKit\n\n@main\nstruct Widgets: WidgetBundle {\n    var body: some Widget { ActivityKitLayoutWidget() }\n}\n';
const customViewsStub = readFileSync(join(repo, 'cli/templates/LiveActivityCustomViews.swift'), 'utf8');

/** A temporary app from a fixture, the plugin and activitykit crates in a fake registry, and fake tools. */
function makeApp(t, { fixture = 'fresh-app', pluginVersion = packageVersion, xcodegen = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'la-setup-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const app = join(base, 'app');
  cpSync(join(fixtures, fixture), app, { recursive: true });
  const bin = join(base, 'bin');
  mkdirSync(bin);
  executable(join(bin, 'cargo'), FAKE_CARGO);
  if (xcodegen) executable(join(bin, 'xcodegen'), FAKE_XCODEGEN);
  const env = {
    PATH: `${bin}:${nodeDir}`,
    CARGO: join(bin, 'cargo'),
    FAKE_METADATA: join(base, 'metadata.json'),
    FAKE_XCODEGEN_LOG: join(base, 'xcodegen.log'),
  };
  const context = { base, app, bin, env, srcTauri: join(app, 'src-tauri') };
  usePlugin(context, pluginVersion);
  return context;
}

/** Points cargo metadata at a plugin crate of `version` that depends on an activitykit crate of `kitVersion`. */
function usePlugin(context, version, kitVersion = '0.1.0', { kit = true } = {}) {
  const plugin = join(context.base, 'registry', `tauri-plugin-live-activity-${version}`);
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'Cargo.toml'), `[package]\nname = "tauri-plugin-live-activity"\nversion = "${version}"\n`);
  const activitykit = join(context.base, 'registry', `activitykit-${kitVersion}`);
  for (const [file, text] of [
    ['Cargo.toml', `[package]\nname = "activitykit"\nversion = "${kitVersion}"\n`],
    ['swift/Package.swift', '// swift-tools-version:5.9\n'],
    ['templates/ios/Widget.swift', AK_WIDGET],
  ]) {
    mkdirSync(dirname(join(activitykit, file)), { recursive: true });
    writeFileSync(join(activitykit, file), text);
  }
  const metadata = {
    packages: [
      { name: 'app', version: '0.1.0', id: 'app', manifest_path: join(context.srcTauri, 'Cargo.toml') },
      { name: 'tauri-plugin-live-activity', version, id: 'plugin', manifest_path: join(plugin, 'Cargo.toml') },
      ...(kit ? [{ name: 'activitykit', version: kitVersion, id: 'activitykit', manifest_path: join(activitykit, 'Cargo.toml') }] : []),
    ],
    resolve: { nodes: [{ id: 'plugin', deps: kit ? [{ name: 'activitykit', pkg: 'activitykit' }] : [] }] },
  };
  writeFileSync(context.env.FAKE_METADATA, JSON.stringify(metadata));
  context.plugin = plugin;
  context.activitykit = activitykit;
  return activitykit;
}

/** Every file under a folder with its bytes, to compare two states of an app. */
function snapshot(dir) {
  const files = {};
  const walk = current => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(dir);
  return files;
}

const read = (context, path) => readFileSync(join(context.srcTauri, path), 'utf8');
const statuses = result => Object.fromEntries(result.steps.map(step => [step.path, step.status]));
const xcodegenRuns = context => (existsSync(context.env.FAKE_XCODEGEN_LOG)
  ? readFileSync(context.env.FAKE_XCODEGEN_LOG, 'utf8').trim().split('\n') : []);
const run = (context, options = {}) => setup({ cwd: context.app, env: context.env, platform: 'darwin', ...options });

// TP-SETUP-1, TP-SETUP-2
test('setup finds the real activitykit crate with cargo metadata and links the products its Swift package declares', t => {
  const context = makeApp(t);
  // The app depends on this checkout of the plugin, through the real cargo, with the versions of the demo's lock file.
  const manifest = join(context.srcTauri, 'Cargo.toml');
  writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}tauri-plugin-live-activity = { path = ${JSON.stringify(repo)} }\n`);
  cpSync(join(repo, 'examples/demo/src-tauri/Cargo.lock'), join(context.srcTauri, 'Cargo.lock'));
  // The real cargo; XcodeGen stays the fake one, first on PATH.
  const cargo = spawnSync('sh', ['-c', 'command -v cargo'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(cargo, 'cargo is on PATH');
  const env = { ...process.env, FAKE_XCODEGEN_LOG: context.env.FAKE_XCODEGEN_LOG, CARGO: cargo, PATH: `${context.bin}:${process.env.PATH}` };
  const { plugin, activitykit } = findCrates({ srcTauri: context.srcTauri }, env);
  assert.equal(plugin.dir, repo.replace(/\/$/, ''));
  const locked = /name = "activitykit"\nversion = "([^"]+)"/.exec(readFileSync(join(repo, 'Cargo.lock'), 'utf8'))[1];
  assert.equal(activitykit.version, locked);
  const declared = [...readFileSync(join(activitykit.dir, 'swift/Package.swift'), 'utf8').matchAll(/\.library\(name: "(\w+)"/g)]
    .map(match => match[1]);
  for (const product of ['ActivityKitWidget', 'ActivityKitViews', 'ActivityKitIntent']) assert.ok(declared.includes(product), product);
  const result = run({ ...context, env });
  assert.equal(result.steps.some(step => step.status === 'failed'), false);
  // The widget is the crate's template, and the spec links products that the crate's Swift package declares.
  assert.equal(read(context, 'gen/apple/LiveActivityWidget/LiveActivityWidget.swift'),
    readFileSync(join(activitykit.dir, 'templates/ios/Widget.swift'), 'utf8'));
  const spec = read(context, 'gen/apple/live-activity.yml');
  assert.ok(spec.includes(join(activitykit.dir, 'swift')), spec);
  const linked = [...new Set([...spec.matchAll(/product: (\w+)/g)].map(match => match[1]))].sort();
  assert.deepEqual(linked, ['ActivityKitIntent', 'ActivityKitViews', 'ActivityKitWidget']);
  for (const product of linked) assert.ok(declared.includes(product), product);
});

// TP-SETUP-2, TP-SETUP-7
test('sets up a fresh Tauri 2 app: capabilities, Android minimum, widget files, XcodeGen spec', t => {
  const context = makeApp(t);
  const projectBefore = read(context, 'gen/apple/project.yml');

  const result = run(context);

  assert.deepEqual(JSON.parse(read(context, 'capabilities/default.json')).permissions, ['core:default', ...PERMISSIONS]);
  const config = JSON.parse(read(context, 'tauri.conf.json'));
  assert.deepEqual(config.bundle.android, { debugApplicationIdSuffix: '.debug', minSdkVersion: 26 });
  assert.equal(read(context, 'tauri.conf.json'), `${JSON.stringify(config, null, 2)}\n`);
  assert.match(read(context, 'gen/android/app/build.gradle.kts'), /^ {8}minSdk = 26$/m);
  assert.equal(setTrueKey(read(context, 'Info.ios.plist'), 'NSSupportsLiveActivities').status, 'present');
  assert.equal(read(context, 'gen/apple/LiveActivityWidget/LiveActivityWidget.swift'), AK_WIDGET);
  assert.equal(read(context, 'gen/apple/LiveActivityWidget/LiveActivityCustomViews.swift'), customViewsStub);
  assert.deepEqual(readdirSync(join(context.srcTauri, 'gen/apple/LiveActivityWidget')).sort(), ['LiveActivityCustomViews.swift', 'LiveActivityWidget.swift']);

  const spec = read(context, 'gen/apple/live-activity.yml');
  assert.ok(spec.includes(`  ActivityKit:\n    path: ${JSON.stringify(join(context.activitykit, 'swift'))}\n`));
  assert.ok(spec.includes('\n  "app_iOS":\n    sources: [LiveActivityWidget/LiveActivityCustomViews.swift]\n    dependencies:\n      - target: LiveActivityWidget\n'
    + '      - package: ActivityKit\n        product: ActivityKitIntent\n      - package: ActivityKit\n        product: ActivityKitViews\n'));
  for (const absent of ['UIAppFonts', 'AppGroup', 'entitlements', 'TauriLiveActivity', 'LiveActivityShared', 'LiveActivityUI']) {
    assert.equal(spec.includes(absent), false, absent);
  }
  assert.match(spec, /\n  LiveActivityWidget:\n    type: app-extension\n/);
  for (const line of ['ActivityKitLayout: 2', 'NSExtensionPointIdentifier: com.apple.widgetkit-extension',
    'PRODUCT_BUNDLE_IDENTIFIER: "com.example.lasetupcheck.widget"', 'CFBundleShortVersionString: "0.1.0"',
    'groups: [app]', 'product: ActivityKitWidget', 'deploymentTarget: "16.2"']) {
    assert.ok(spec.includes(line), line);
  }
  // Tauri writes project.yml without a final newline.
  assert.equal(read(context, 'gen/apple/project.yml'), `${projectBefore}\n\ninclude:\n  - live-activity.yml\n`);
  assert.deepEqual(xcodegenRuns(context), [`generate --spec ${join(context.srcTauri, 'gen/apple/project.yml')}`]);

  assert.equal(result.steps.filter(step => step.status === 'todo').length, 0);
  assert.deepEqual(result.notes.map(note => note.kind), ['register']);
});

// TP-SETUP-6
test('a second run changes nothing and does not run XcodeGen again', t => {
  const context = makeApp(t);
  run(context);
  const before = snapshot(context.base);

  const result = run(context);

  assert.deepEqual(snapshot(context.base), before);
  assert.deepEqual([...new Set(result.steps.map(step => step.status))], ['unchanged']);
  assert.equal(xcodegenRuns(context).length, 1);
  assert.match(formatReport(result), /Everything was set up already\./);
});

// TP-SETUP-6
test('a dry run writes nothing and reports what it would do', t => {
  const context = makeApp(t);
  const before = snapshot(context.base);

  const result = run(context, { dryRun: true });

  assert.deepEqual(snapshot(context.base), before);
  const report = formatReport(result);
  assert.match(report, /Dry run: nothing was written\./);
  assert.match(report, /would create +src-tauri\/gen\/apple\/live-activity\.yml/);
  assert.match(report, /would update +src-tauri\/capabilities\/default\.json \(9 permissions added\)/);
  assert.match(report, /would run +xcodegen generate --spec src-tauri\/gen\/apple\/project\.yml/);
});

// TP-SETUP-3
test('keeps a widget file that differs from the template, and says how to take the template', t => {
  const context = makeApp(t);
  run(context);
  const widget = join(context.srcTauri, 'gen/apple/LiveActivityWidget/LiveActivityWidget.swift');
  writeFileSync(widget, '// my widget\n');

  const result = run(context);

  assert.equal(readFileSync(widget, 'utf8'), '// my widget\n');
  const kept = result.steps.find(step => step.status === 'kept');
  assert.equal(kept.path, 'src-tauri/gen/apple/LiveActivityWidget/LiveActivityWidget.swift');
  assert.match(kept.detail, /differs from activitykit's template.*delete it and run setup again/);
  rmSync(widget);
  assert.equal(statuses(run(context))['src-tauri/gen/apple/LiveActivityWidget/LiveActivityWidget.swift'], 'created');
  // XcodeGen lists a folder's files when it generates, so a file put back needs another run.
  assert.equal(xcodegenRuns(context).length, 2);
});

// TP-SETUP-7
test('rewrites the spec it wrote after an activitykit update, and keeps a spec the user edited', t => {
  const context = makeApp(t);
  run(context);
  const activitykit = usePlugin(context, packageVersion, '0.1.1');

  const updated = run(context);

  const specPath = join(context.srcTauri, 'gen/apple/live-activity.yml');
  assert.equal(statuses(updated)['src-tauri/gen/apple/live-activity.yml'], 'updated');
  assert.ok(readFileSync(specPath, 'utf8').includes(JSON.stringify(join(activitykit, 'swift'))));
  assert.equal(xcodegenRuns(context).length, 2);

  writeFileSync(specPath, `${readFileSync(specPath, 'utf8')}# mine\n`);
  usePlugin(context, packageVersion, '0.1.2');
  const kept = run(context);
  assert.equal(statuses(kept)['src-tauri/gen/apple/live-activity.yml'], 'kept');
  assert.match(readFileSync(specPath, 'utf8'), /# mine\n$/);
});

test('leaves an Xcode project with its own widget extension alone', t => {
  const context = makeApp(t);
  const demoSpec = readFileSync(join(repo, 'examples/demo/src-tauri/gen/apple/project.yml'), 'utf8');
  writeFileSync(join(context.srcTauri, 'gen/apple/project.yml'), demoSpec);

  const result = run(context);

  assert.equal(read(context, 'gen/apple/project.yml'), demoSpec);
  assert.equal(existsSync(join(context.srcTauri, 'gen/apple/live-activity.yml')), false);
  assert.equal(existsSync(join(context.srcTauri, 'gen/apple/LiveActivityWidget')), false);
  const skipped = result.steps.find(step => step.path === 'src-tauri/gen/apple/project.yml');
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.detail, /LiveActivityWidget/);
  assert.equal(statuses(result)['src-tauri/Info.ios.plist'], 'created');
  assert.equal(xcodegenRuns(context).length, 0);
  assert.equal(result.steps.some(step => step.status === 'todo'), false);

  const art = artwork(context);
  const flags = run(context, { fonts: [art('Mono.otf')], appGroup: true });
  assert.match(flags.steps.find(step => step.status === 'todo').detail, /^--font, --app-group not applied: that widget is yours/);
  assert.equal(existsSync(join(context.srcTauri, 'gen/apple/LiveActivityWidget')), false);
});

test('says what it could not do when project.yml has no app target it knows', t => {
  const context = makeApp(t);
  const specPath = join(context.srcTauri, 'gen/apple/project.yml');
  writeFileSync(specPath, read(context, 'gen/apple/project.yml').replace('\n  app_iOS:\n', '\n  Renamed:\n'));

  const result = run(context);

  const todo = result.steps.find(step => step.status === 'todo');
  assert.equal(todo.path, 'src-tauri/gen/apple/project.yml');
  assert.match(todo.detail, /no target named app_iOS/);
  assert.equal(existsSync(join(context.srcTauri, 'gen/apple/live-activity.yml')), false);
  assert.equal(main(['setup'], { cwd: context.app, env: context.env, platform: 'darwin', out: () => {} }), 1);
});

test('without gen/apple it skips iOS and says when to run again', t => {
  const context = makeApp(t);
  rmSync(join(context.srcTauri, 'gen/apple'), { recursive: true });

  const onMac = run(context);
  const onLinux = run(context, { platform: 'linux' });

  assert.match(onMac.steps.find(step => step.path === 'iOS').detail, /tauri ios init/);
  assert.match(onLinux.steps.find(step => step.path === 'iOS').detail, /needs a Mac/);
  assert.equal(existsSync(join(context.srcTauri, 'Info.ios.plist')), false);
  assert.equal(statuses(onMac)['src-tauri/capabilities/default.json'], 'updated');
});

test('--ios-only leaves the capabilities and the Android settings alone', t => {
  const context = makeApp(t);
  const before = ['capabilities/default.json', 'tauri.conf.json', 'gen/android/app/build.gradle.kts'].map(path => read(context, path));

  const result = run(context, { iosOnly: true });

  assert.deepEqual(['capabilities/default.json', 'tauri.conf.json', 'gen/android/app/build.gradle.kts'].map(path => read(context, path)), before);
  assert.equal(statuses(result)['src-tauri/gen/apple/live-activity.yml'], 'created');
});

test('runs from src-tauri too, and finds the plugin already registered', t => {
  const context = makeApp(t);
  const lib = join(context.srcTauri, 'src/lib.rs');
  writeFileSync(lib, readFileSync(lib, 'utf8').replace('tauri::Builder::default()', 'tauri::Builder::default()\n    .plugin(tauri_plugin_live_activity::init())'));

  const result = setup({ cwd: context.srcTauri, env: context.env, platform: 'darwin' });

  assert.equal(statuses(result)['capabilities/default.json'], 'updated');
  assert.deepEqual(result.notes, []);
});

test('keeps settings that are already right, and an Android minimum above 26', t => {
  const context = makeApp(t);
  const configPath = join(context.srcTauri, 'tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, `${JSON.stringify({ ...config, bundle: { ...config.bundle, android: { minSdkVersion: 28 } } }, null, '\t')}\n`);
  const gradle = join(context.srcTauri, 'gen/android/app/build.gradle.kts');
  writeFileSync(gradle, readFileSync(gradle, 'utf8').replace('minSdk = 24', 'minSdk = 28'));
  writeFileSync(join(context.srcTauri, 'Info.ios.plist'), '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n  <key>NSSupportsLiveActivities</key>\n  <true/>\n</dict>\n</plist>\n');

  const result = run(context);

  const changed = statuses(result);
  assert.equal(changed['src-tauri/tauri.conf.json'], 'unchanged');
  assert.equal(changed['src-tauri/gen/android/app/build.gradle.kts'], 'unchanged');
  assert.equal(changed['src-tauri/Info.ios.plist'], 'unchanged');
});

test('Info.ios.plist: adds the key next to others, keeps false, leaves a binary plist to the user', t => {
  const context = makeApp(t);
  const path = join(context.srcTauri, 'Info.ios.plist');
  const plist = '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n    <key>ITSAppUsesNonExemptEncryption</key>\n    <false/>\n</dict>\n</plist>\n';
  const cases = [
    [plist, 'updated', plist.replace('</dict>', '    <key>NSSupportsLiveActivities</key>\n    <true/>\n</dict>')],
    [plist.replace('ITSAppUsesNonExemptEncryption', 'NSSupportsLiveActivities'), 'kept'],
    ['bplist00\u0000', 'todo'],
  ];
  for (const [text, status, written = text] of cases) {
    writeFileSync(path, text);
    assert.equal(statuses(run(context))['src-tauri/Info.ios.plist'], status);
    assert.equal(readFileSync(path, 'utf8'), written);
  }
});

test('the extension takes the app version from package.json or Cargo.toml when tauri.conf.json has none', t => {
  const context = makeApp(t);
  const configPath = join(context.srcTauri, 'tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(join(context.app, 'package.json'), '{ "version": "2.3.4-beta.1" }\n');
  const spec = () => read(context, 'gen/apple/live-activity.yml');

  writeFileSync(configPath, JSON.stringify({ ...config, version: '../package.json', bundle: { ...config.bundle, iOS: { bundleVersion: '7' } } }));
  run(context, { iosOnly: true });
  assert.match(spec(), /CFBundleShortVersionString: "2\.3\.4"\n {8}CFBundleVersion: "7"\n/);

  const { version, ...unversioned } = config;
  writeFileSync(configPath, JSON.stringify(unversioned));
  assert.equal(statuses(run(context, { iosOnly: true }))['src-tauri/gen/apple/live-activity.yml'], 'updated');
  assert.match(spec(), /CFBundleShortVersionString: "0\.1\.0"\n {8}CFBundleVersion: "0\.1\.0"\n/);

  writeFileSync(join(context.srcTauri, 'Cargo.toml'), '[package]\nname = "app"\n');
  run(context, { iosOnly: true });
  assert.doesNotMatch(spec(), /CFBundle/);
});

test('an include list it cannot edit is left to the user, and XcodeGen waits for it', t => {
  const context = makeApp(t);
  const specPath = join(context.srcTauri, 'gen/apple/project.yml');
  writeFileSync(specPath, `${read(context, 'gen/apple/project.yml')}\ninclude: base.yml\n`);

  const result = run(context);

  assert.match(result.steps.find(step => step.status === 'todo').detail, /add live-activity\.yml to its include list/);
  assert.equal(statuses(result)['Xcode project'], 'skipped');
  assert.equal(xcodegenRuns(context).length, 0);
});

test('a file it cannot write becomes a step to do', t => {
  const context = makeApp(t);
  writeFileSync(join(context.srcTauri, 'gen/apple/LiveActivityWidget'), 'a file where the folder goes\n');

  const result = run(context);

  const todo = result.steps.find(step => step.path === 'src-tauri/gen/apple/LiveActivityWidget/LiveActivityWidget.swift');
  assert.equal(todo.status, 'todo');
  assert.match(todo.detail, /could not write it/);
});

test('a tab-indented tauri.conf.json keeps its tabs', t => {
  const context = makeApp(t);
  const configPath = join(context.srcTauri, 'tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, JSON.stringify(config, null, '\t'));

  run(context);

  const written = readFileSync(configPath, 'utf8');
  assert.match(written, /^\t"productName"/m);
  assert.equal(written.endsWith('\n'), false);
});

test('without XcodeGen it leaves the command to run', t => {
  const context = makeApp(t, { xcodegen: false });

  const result = run(context);

  const todo = result.steps.find(step => step.status === 'todo');
  assert.equal(todo.path, 'Xcode project');
  assert.match(todo.detail, /XcodeGen is not on PATH.*xcodegen generate --spec src-tauri\/gen\/apple\/project\.yml/);
  assert.match(formatReport(result), /To do:\n {2}Xcode project: XcodeGen is not on PATH/);
});

test('reports a failed XcodeGen run as a step to do', t => {
  const context = makeApp(t);

  const result = run(context, { env: { ...context.env, FAKE_XCODEGEN_FAIL: '1' } });

  const todo = result.steps.find(step => step.status === 'todo');
  assert.match(todo.detail, /xcodegen failed: Spec validation error/);
});

// TP-SETUP-1
test('finds activitykit through the plugin, and fails with a message without it', t => {
  const context = makeApp(t);
  const activitykit = usePlugin(context, packageVersion, '0.2.0');
  run(context);
  assert.ok(read(context, 'gen/apple/live-activity.yml').includes(JSON.stringify(join(activitykit, 'swift'))));

  usePlugin(context, '0.3.0', '0.1.0', { kit: false });
  assert.throws(() => run(context), { name: 'SetupError', message: /tauri-plugin-live-activity 0\.3\.0 does not depend on activitykit/ });
  usePlugin(context, packageVersion);
  rmSync(join(context.activitykit, 'templates'), { recursive: true });
  rmSync(join(context.srcTauri, 'gen/apple/LiveActivityWidget/LiveActivityWidget.swift'));
  assert.throws(() => run(context), { name: 'SetupError', message: /has no templates\/ios\/Widget\.swift/ });
});

test('picks the only capability file, and lists the permissions when it cannot choose', t => {
  const context = makeApp(t);
  const capabilities = join(context.srcTauri, 'capabilities');
  cpSync(join(capabilities, 'default.json'), join(capabilities, 'main.json'));
  rmSync(join(capabilities, 'default.json'));

  assert.equal(statuses(run(context, { iosOnly: false }))['src-tauri/capabilities/main.json'], 'updated');

  writeFileSync(join(capabilities, 'other.json'), '{ "identifier": "other", "permissions": [] }\n');
  writeFileSync(join(capabilities, 'broken.json'), '{');
  const result = run(context);
  const todo = result.steps.find(step => step.path === 'src-tauri/capabilities');
  assert.equal(todo.status, 'todo');
  assert.ok(todo.detail.includes(PERMISSIONS.join(', ')));
});

test('says what is wrong with a capability file it cannot read', t => {
  const context = makeApp(t);
  writeFileSync(join(context.srcTauri, 'capabilities/default.json'), '{ "permissions": ');

  const todo = run(context).steps.find(step => step.status === 'todo');

  assert.equal(todo.path, 'src-tauri/capabilities/default.json');
  assert.match(todo.detail, /not valid JSON/);
});

test('notes a different minor version of the npm package and the crate', t => {
  const context = makeApp(t, { pluginVersion: '9.9.0' });

  const result = run(context);

  const note = result.notes.find(item => item.kind === 'version');
  const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.ok(note.text.includes(`npm package ${version} and the crate 9.9.0`), note.text);
  assert.match(formatReport(result), /use the same minor version/);
});

test('fails with a clear message outside a Tauri app, without the crate or without cargo', t => {
  const context = makeApp(t);
  assert.throws(() => setup({ cwd: context.base, env: context.env }), { name: 'SetupError', message: /src-tauri\/tauri\.conf\.json/ });

  writeFileSync(context.env.FAKE_METADATA, JSON.stringify({ packages: [], resolve: { nodes: [] } }));
  assert.throws(() => run(context), { message: /cargo add tauri-plugin-live-activity --manifest-path src-tauri\/Cargo\.toml/ });

  assert.throws(() => run(context, { env: { ...context.env, FAKE_CARGO_FAIL: '1' } }), { message: /cargo metadata failed.*failed to load manifest/s });
  assert.throws(() => run(context, { env: { ...context.env, CARGO: join(context.bin, 'missing') } }), { message: /cargo was not found/ });

  writeFileSync(context.env.FAKE_METADATA, 'not json');
  assert.throws(() => run(context), SetupError);

  rmSync(join(context.srcTauri, 'Cargo.toml'));
  assert.throws(() => run(context), { message: /No src-tauri\/Cargo\.toml/ });
});

test('the CLI prints a summary, takes --dry-run and --ios-only, and rejects unknown arguments', t => {
  const context = makeApp(t);
  const cli = join(repo, 'cli', 'bin.mjs');
  const exec = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: context.app, env: context.env, encoding: 'utf8' });

  const dry = exec('setup', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run/);

  const first = exec('setup');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /created +src-tauri\/gen\/apple\/live-activity\.yml/);
  assert.match(first.stdout, /Next: add \.plugin\(tauri_plugin_live_activity::init\(\)\)/);

  assert.match(exec('setup', '--ios-only').stdout, /Everything was set up already\./);
  for (const args of [[], ['--help'], ['help']]) assert.match(exec(...args).stdout, /Usage: npx tauri-plugin-live-activity setup/);
  const wrong = exec('setup', '--force');
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /Unknown option --force/);
  assert.equal(exec('install').status, 2);

  const outside = spawnSync(process.execPath, [cli, 'setup'], { cwd: context.base, env: context.env, encoding: 'utf8' });
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /No src-tauri\/tauri\.conf\.json/);
});

test('the permissions it adds are permissions of the plugin', () => {
  const identifiers = new Set(readdirSync(join(repo, 'permissions/autogenerated/commands'))
    .flatMap(file => [...readFileSync(join(repo, 'permissions/autogenerated/commands', file), 'utf8')
      .matchAll(/^identifier = "(.+)"$/gm)].map(match => `live-activity:${match[1]}`)));
  identifiers.add('live-activity:default');
  for (const permission of PERMISSIONS) assert.ok(identifiers.has(permission), permission);
  const commands = ['request-permissions', 'start', 'update', 'end', 'start-layout', 'update-layout', 'end-layout', 'write-image'];
  assert.deepEqual(PERMISSIONS, ['live-activity:default', ...commands.map(command => `live-activity:allow-${command}`)]);
});

test('the npm package ships the command', () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.bin, { 'tauri-plugin-live-activity': 'cli/bin.mjs' });
  assert.ok(manifest.files.includes('cli'));
  assert.match(readFileSync(join(repo, 'cli/bin.mjs'), 'utf8'), /^#!\/usr\/bin\/env node\n/);
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), []);
});

test('plist: adds a key to the root dict only, keeps false, and reads a missing or odd file', () => {
  const nested = '<plist version="1.0">\n<dict>\n\t<key>Inner</key>\n\t<dict>\n\t\t<key>NSSupportsLiveActivities</key>\n\t\t<true/>\n\t</dict>\n</dict>\n</plist>\n';
  const added = setTrueKey(nested, 'NSSupportsLiveActivities');
  assert.equal(added.status, 'added');
  assert.equal(added.text, nested.replace('\t</dict>\n</dict>', '\t</dict>\n\t<key>NSSupportsLiveActivities</key>\n\t<true/>\n</dict>'));
  assert.equal(setTrueKey(added.text, 'NSSupportsLiveActivities').status, 'present');

  assert.equal(setTrueKey('<plist><dict><key>NSSupportsLiveActivities</key><false/></dict></plist>', 'NSSupportsLiveActivities').status, 'false');
  assert.equal(setTrueKey('<plist><dict><key>A</key><string>x</string></dict></plist>', 'A').status, 'other');
  const empty = setTrueKey('<?xml version="1.0"?>\n<plist version="1.0">\n<dict/>\n</plist>\n', 'K');
  assert.equal(empty.status, 'added');
  assert.match(empty.text, /<dict>\n\t<key>K<\/key>\n\t<true\/>\n<\/dict>/);
  assert.equal(setTrueKey('bplist00...', 'K').status, 'unreadable');
  assert.equal(setTrueKey('<plist><array/></plist>', 'K').status, 'unreadable');
  assert.equal(setTrueKey('<plist><dict><!-- <key>K</key><true/> --></dict></plist>', 'K').status, 'added');
});

test('XcodeGen spec: reads names and groups, and adds to an include list of either form', () => {
  const yaml = 'name: "my-app"\nsettingGroups:\n  app:\n    base: {}\ntargets:\n  # the app\n  my-app_iOS:\n    type: application\n';
  assert.deepEqual(readProject(yaml), {
    name: 'my-app', appTarget: 'my-app_iOS', entitlements: undefined, settingGroups: ['app'], bundleId: undefined, widget: undefined,
  });
  const entitled = `${yaml}    entitlements:\n      # the app's\n      path: "my-app_iOS/app.entitlements"\n    info:\n      path: x\n`;
  assert.equal(readProject(entitled).entitlements, 'my-app_iOS/app.entitlements');
  assert.equal(readProject(`${yaml}    entitlements:\n      properties: {}\n    info:\n      path: x\n`).entitlements, undefined);
  assert.equal(readProject('targets:\n  X:\n    type: app-extension\n    info:\n      properties:\n        NSExtension:\n          NSExtensionPointIdentifier: com.apple.widgetkit-extension\n').widget, 'X');

  assert.deepEqual(addInclude('name: a\ninclude: [base.yml]\n', 'live-activity.yml'),
    { status: 'added', text: 'name: a\ninclude: [base.yml, live-activity.yml]\n' });
  assert.deepEqual(addInclude('name: a\ninclude: []\n', 'live-activity.yml'),
    { status: 'added', text: 'name: a\ninclude: [live-activity.yml]\n' });
  assert.deepEqual(addInclude('include:\n  - base.yml\nname: a\n', 'live-activity.yml'),
    { status: 'added', text: 'include:\n  - base.yml\n  - live-activity.yml\nname: a\n' });
  assert.equal(addInclude('include:\n  - path: live-activity.yml\n', 'live-activity.yml').status, 'present');
  assert.equal(addInclude('include: base.yml\n', 'live-activity.yml').status, 'unsupported');
  assert.deepEqual(addInclude('name: a', 'live-activity.yml'), { status: 'added', text: 'name: a\n\ninclude:\n  - live-activity.yml\n' });
});

// A TrueType font with only a name table: `records` are [platform, nameId, text].
function font(records) {
  const encoded = records.map(([platform, id, text]) => [platform, id, platform === 3 ? Buffer.from(text, 'utf16le').swap16() : Buffer.from(text, 'latin1')]);
  const strings = Buffer.concat(encoded.map(([, , bytes]) => bytes));
  const table = Buffer.alloc(6 + encoded.length * 12);
  table.writeUInt16BE(encoded.length, 2);
  table.writeUInt16BE(table.length, 4);
  let offset = 0;
  encoded.forEach(([platform, id, bytes], index) => {
    const at = 6 + index * 12;
    [platform, platform === 3 ? 1 : 0, platform === 3 ? 0x409 : 0, id, bytes.length, offset].forEach((value, field) => table.writeUInt16BE(value, at + field * 2));
    offset += bytes.length;
  });
  const head = Buffer.alloc(28);
  head.write('\0\u0001\0\0', 0, 'latin1');
  head.writeUInt16BE(1, 4);
  head.write('name', 12, 'latin1');
  head.writeUInt32BE(28, 20);
  head.writeUInt32BE(table.length + strings.length, 24);
  return Buffer.concat([head, table, strings]);
}

/** Files outside the app, as an app keeps its fonts and pictures. */
function artwork(context) {
  const folder = join(context.base, 'art');
  mkdirSync(folder);
  const files = {
    'Pacifico-Regular.ttf': font([[1, 1, 'Pacifico Mac'], [3, 1, 'Pacifico'], [3, 6, 'Pacifico-Regular']]),
    'Mono.otf': Buffer.from('OTTO not a font'),
    'mochi@2x.png': Buffer.from('two'), 'mochi@3x.png': Buffer.from('three'), 'badge.png': Buffer.from('one'), 'paw.svg': Buffer.from('<svg/>'),
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(folder, name), bytes);
  return name => join(folder, name);
}

const widgetPath = (context, path) => join(context.srcTauri, 'gen/apple/LiveActivityWidget', path);

test('--font bundles fonts in the widget, lists them in UIAppFonts and names their fontFamily', t => {
  const context = makeApp(t);
  const art = artwork(context);

  const first = run(context, { fonts: [art('Pacifico-Regular.ttf')] });

  assert.deepEqual(readFileSync(widgetPath(context, 'Fonts/Pacifico-Regular.ttf')), readFileSync(art('Pacifico-Regular.ttf')));
  const copied = first.steps.find(step => step.path.endsWith('Fonts/Pacifico-Regular.ttf'));
  assert.equal(copied.status, 'created');
  assert.equal(copied.detail, 'fontFamily: "Pacifico-Regular" or "Pacifico"');
  assert.match(read(context, 'gen/apple/live-activity.yml'), /\n {8}UIAppFonts:\n {10}- "Pacifico-Regular\.ttf"\n/);

  assert.deepEqual([...new Set(run(context, { fonts: [art('Pacifico-Regular.ttf')] }).steps.map(step => step.status))], ['unchanged']);
  const runs = xcodegenRuns(context).length;
  // A later font joins the first; a font without a readable name table is copied all the same.
  const second = run(context, { fonts: [art('Mono.otf')] });
  assert.equal(second.steps.find(step => step.path.endsWith('Fonts/Mono.otf')).detail, '');
  assert.match(read(context, 'gen/apple/live-activity.yml'), /UIAppFonts:\n {10}- "Mono\.otf"\n {10}- "Pacifico-Regular\.ttf"\n/);
  assert.equal(xcodegenRuns(context).length, runs + 1);
  writeFileSync(art('Mono.otf'), 'OTTO changed');
  assert.equal(statuses(run(context, { fonts: [art('Mono.otf')] }))['src-tauri/gen/apple/LiveActivityWidget/Fonts/Mono.otf'], 'updated');
  // Without the option the fonts in the folder stay listed.
  assert.equal(statuses(run(context))['src-tauri/gen/apple/live-activity.yml'], 'unchanged');
});

test('--asset puts images in the widget asset catalog, one image set per name and scale', t => {
  const context = makeApp(t);
  const art = artwork(context);

  run(context, { assets: [art('mochi@2x.png'), art('mochi@3x.png'), art('badge.png'), art('paw.svg')] });

  const catalog = path => JSON.parse(readFileSync(widgetPath(context, `Assets.xcassets/${path}`), 'utf8'));
  assert.deepEqual(catalog('Contents.json'), { info: { author: 'xcode', version: 1 } });
  assert.deepEqual(catalog('mochi.imageset/Contents.json').images, [
    { filename: 'mochi@2x.png', idiom: 'universal', scale: '2x' }, { filename: 'mochi@3x.png', idiom: 'universal', scale: '3x' },
  ]);
  assert.deepEqual(catalog('badge.imageset/Contents.json').images, [{ filename: 'badge.png', idiom: 'universal' }]);
  assert.deepEqual(catalog('paw.imageset/Contents.json').images, [
    { filename: 'paw.svg', idiom: 'universal', properties: { 'preserves-vector-representation': true } },
  ]);
  assert.match(readFileSync(widgetPath(context, 'Assets.xcassets/badge.imageset/Contents.json'), 'utf8'), /^ {6}"filename" : "badge\.png",$/m);
  assert.equal(readFileSync(widgetPath(context, 'Assets.xcassets/badge.imageset/badge.png'), 'utf8'), 'one');

  // An image set edited in Xcode keeps its entries; a new scale is added next to them.
  const contents = widgetPath(context, 'Assets.xcassets/badge.imageset/Contents.json');
  writeFileSync(contents, JSON.stringify({ images: [{ filename: 'badge.png', idiom: 'universal', appearances: [] }], info: { version: 1 } }));
  writeFileSync(art('badge@3x.png'), 'three');
  const again = run(context, { assets: [art('badge.png'), art('badge@3x.png')] });
  assert.equal(statuses(again)['src-tauri/gen/apple/LiveActivityWidget/Assets.xcassets/badge.imageset/Contents.json'], 'updated');
  assert.deepEqual(JSON.parse(readFileSync(contents, 'utf8')).images, [
    { filename: 'badge.png', idiom: 'universal', appearances: [] }, { filename: 'badge@3x.png', idiom: 'universal', scale: '3x' },
  ]);
  writeFileSync(contents, '{ "images": 1 }');
  const odd = run(context, { assets: [art('badge.png')] });
  assert.match(odd.steps.find(step => step.status === 'todo').detail, /not an image set's Contents\.json/);
  assert.equal(statuses(odd)['Xcode project'], 'unchanged');
});

// TP-SETUP-7
test('--app-group gives the app and the widget an App Group in the spec, and later runs keep it', t => {
  const context = makeApp(t);
  const spec = () => read(context, 'gen/apple/live-activity.yml');
  const group = name => `      properties:\n        com.apple.security.application-groups: ["${name}"]\n`;

  const first = run(context, { appGroup: true });

  assert.equal(statuses(first)['src-tauri/gen/apple/live-activity.yml'], 'created');
  // XcodeGen writes both entitlements files from the spec; it merges the app target's part into project.yml's.
  assert.ok(spec().includes(`        product: ActivityKitViews\n    entitlements:\n      path: "app_iOS/app_iOS.entitlements"\n${group('group.com.example.lasetupcheck')}`));
  assert.ok(spec().includes(`\n        ActivityKitAppGroup: "group.com.example.lasetupcheck"\n    entitlements:\n      path: LiveActivityWidget.entitlements\n${group('group.com.example.lasetupcheck')}`));
  assert.equal(appGroupOf(spec()), 'group.com.example.lasetupcheck');

  assert.deepEqual([...new Set(run(context).steps.map(step => step.status))], ['unchanged']);
  assert.equal(statuses(run(context, { appGroup: 'group.com.example.shared' }))['src-tauri/gen/apple/live-activity.yml'], 'updated');
  assert.equal(appGroupOf(spec()), 'group.com.example.shared');
  assert.equal(spec().split(group('group.com.example.shared')).length, 3);
  assert.throws(() => run(context, { appGroup: 'com.example' }), { name: 'SetupError', message: /must be "group\." followed by/ });

  // An app target whose entitlements live elsewhere keeps that path.
  const projectPath = join(context.srcTauri, 'gen/apple/project.yml');
  writeFileSync(projectPath, read(context, 'gen/apple/project.yml').replace('path: app_iOS/app_iOS.entitlements', 'path: Signing/app.entitlements'));
  run(context);
  assert.match(spec(), /entitlements:\n {6}path: "Signing\/app\.entitlements"\n/);
});

// TP-SETUP-4
test('creates LiveActivityCustomViews.swift once and never writes it again', t => {
  const context = makeApp(t);
  run(context);
  const file = widgetPath(context, 'LiveActivityCustomViews.swift');
  writeFileSync(file, '// my views\n');

  const result = run(context);

  assert.equal(readFileSync(file, 'utf8'), '// my views\n');
  assert.equal(statuses(result)['src-tauri/gen/apple/LiveActivityWidget/LiveActivityCustomViews.swift'], 'unchanged');
});

// TP-SETUP-3, TP-SETUP-4, TP-SETUP-5, TP-SETUP-6
test('migrates an app that 0.3 set up to activitykit, and a second run changes nothing', t => {
  const context = makeApp(t, { fixture: 'app-0.3' });
  const views = widgetPath(context, 'LiveActivityCustomViews.swift');
  const before = readFileSync(views, 'utf8');

  const result = run(context);

  const status = statuses(result);
  for (const name of ['LiveActivityActionIntent.swift', 'LiveActivityCustomRegistry.swift']) {
    assert.equal(status[`src-tauri/gen/apple/LiveActivityWidget/${name}`], 'removed', name);
    assert.equal(existsSync(widgetPath(context, name)), false, name);
  }
  assert.equal(status['src-tauri/gen/apple/LiveActivityWidget/LiveActivityWidget.swift'], 'updated');
  assert.equal(readFileSync(widgetPath(context, 'LiveActivityWidget.swift'), 'utf8'), AK_WIDGET);
  assert.equal(status['src-tauri/gen/apple/LiveActivityWidget/LiveActivityCustomViews.swift'], 'updated');
  const after = readFileSync(views, 'utf8');
  assert.match(after, /^import ActivityKitViews\nimport SwiftUI$/m);
  assert.match(after, /@objc\(ActivityKitCustomViews\)\nfinal class LiveActivityCustomViews: ActivityKitCustomViewRegistry \{/);
  assert.match(after, /override class var views: \[String: ActivityKitCustomView\]/);
  assert.match(after, /"bowl": ActivityKitCustomView \{ \(props: ActivityKitCustomProps\) in\n {16}Circle\(\)\.trim\(from: 0, to: props\.number\("level"\) \?\? 0\)/);
  assert.equal(after.split('\n').length, before.split('\n').length + 1);
  assert.doesNotMatch(after, /TauriLiveActivity|LiveActivityCustomViewRegistry|LiveActivityCustomView\b|LiveActivityCustomProps/);

  const spec = read(context, 'gen/apple/live-activity.yml');
  assert.equal(status['src-tauri/gen/apple/live-activity.yml'], 'updated');
  assert.ok(spec.includes('        ActivityKitLayout: 2\n        ActivityKitAppGroup: "group.com.example.lasetupcheck"\n'));
  assert.doesNotMatch(spec, /TauriLiveActivity|tauri-plugin-live-activity-0\.3\.0\/ios|LiveActivityShared|LiveActivityActionIntent/);
  assert.equal(appGroupOf(spec), 'group.com.example.lasetupcheck');
  assert.equal(status['src-tauri/gen/apple/project.yml'], 'unchanged');
  assert.equal(xcodegenRuns(context).length, 1);
  assert.equal(result.steps.filter(step => step.status === 'todo').length, 0);
  assert.match(formatReport(result), /removed +src-tauri\/gen\/apple\/LiveActivityWidget\/LiveActivityActionIntent\.swift/);

  const settled = snapshot(context.base);
  const again = run(context);
  assert.deepEqual([...new Set(again.steps.map(step => step.status))], ['unchanged']);
  assert.deepEqual(snapshot(context.base), settled);
  assert.equal(xcodegenRuns(context).length, 1);
});

// TP-SETUP-3, TP-SETUP-6
test('keeps old files that were changed by hand, as steps to do, and a dry run of a migration writes nothing', t => {
  const context = makeApp(t, { fixture: 'app-0.3' });
  const before = snapshot(context.base);
  const dry = run(context, { dryRun: true });
  assert.deepEqual(snapshot(context.base), before);
  assert.match(formatReport(dry), /would remove +src-tauri\/gen\/apple\/LiveActivityWidget\/LiveActivityCustomRegistry\.swift/);

  const intent = widgetPath(context, 'LiveActivityActionIntent.swift');
  writeFileSync(intent, `${readFileSync(intent, 'utf8')}// mine\n`);
  const widget = widgetPath(context, 'LiveActivityWidget.swift');
  writeFileSync(widget, `${readFileSync(widget, 'utf8')}// mine\n`);

  const result = run(context);

  const todo = Object.fromEntries(result.steps.filter(step => step.status === 'todo').map(step => [step.path, step.detail]));
  assert.match(todo['src-tauri/gen/apple/LiveActivityWidget/LiveActivityActionIntent.swift'], /changed by hand; activitykit's Swift package replaces it/);
  assert.match(todo['src-tauri/gen/apple/LiveActivityWidget/LiveActivityWidget.swift'], /imports the Swift modules of tauri-plugin-live-activity 0\.3/);
  assert.match(readFileSync(intent, 'utf8'), /\/\/ mine\n$/);
  assert.match(readFileSync(widget, 'utf8'), /\/\/ mine\n$/);
  assert.equal(existsSync(widgetPath(context, 'LiveActivityCustomRegistry.swift')), false);
});

// TP-SETUP-3
test('keeps the old copies that a spec changed by hand still names, as steps to do', t => {
  const context = makeApp(t, { fixture: 'app-0.3' });
  const spec = join(context.srcTauri, 'gen/apple/live-activity.yml');
  // A spec changed by hand keeps its sources, which name both old copies; setup keeps the spec.
  writeFileSync(spec, `${readFileSync(spec, 'utf8')}# mine\n`);
  const result = run(context);
  assert.equal(statuses(result)['src-tauri/gen/apple/live-activity.yml'], 'kept');
  const todo = Object.fromEntries(result.steps.filter(step => step.status === 'todo').map(step => [step.path, step.detail]));
  for (const name of ['LiveActivityActionIntent.swift', 'LiveActivityCustomRegistry.swift']) {
    assert.equal(existsSync(widgetPath(context, name)), true, name);
    assert.match(todo[`src-tauri/gen/apple/LiveActivityWidget/${name}`], /live-activity\.yml, which you changed, still names it/);
  }
});

test('checks the fonts and images it is given before it writes anything', t => {
  const context = makeApp(t);
  const art = artwork(context);
  writeFileSync(art('notes.txt'), 'x');
  writeFileSync(art('café.png'), 'x');
  writeFileSync(art('.hidden@2x.png'), 'x');
  writeFileSync(art('paw@2x.svg'), 'x');
  const before = snapshot(context.app);
  for (const [options, message] of [
    [{ fonts: [art('missing.ttf')] }, /missing\.ttf: no such file/],
    [{ fonts: [join(context.base, 'art')] }, /no such file/],
    [{ fonts: [art('badge.png')] }, /a font must be \.ttf, \.otf, \.ttc/],
    [{ assets: [art('notes.txt')] }, /an image must be \.png, \.jpg, \.jpeg, \.pdf, \.svg/],
    [{ assets: [art('café.png')] }, /rename it to ASCII/],
    [{ assets: [art('.hidden@2x.png')] }, /rename it to ASCII/],
    [{ assets: [art('paw@2x.svg')] }, /has one scale; drop the @2x/],
  ]) {
    assert.throws(() => run(context, options), { name: 'SetupError', message }, message.source);
  }
  writeFileSync(art('a b.png'), 'x');
  assert.throws(() => run(context, { assets: [art('a b.png')] }), { message: /the asset name "a b" must be/ });
  mkdirSync(join(context.base, 'other'));
  writeFileSync(join(context.base, 'other', 'badge.png'), 'other');
  assert.throws(() => run(context, { assets: [art('badge.png'), join(context.base, 'other', 'badge.png')] }), { message: /badge\.png is named twice/ });
  assert.throws(() => run(context, { fonts: [art('Mono.otf'), art('Mono.otf')] }), { message: /Mono\.otf is named twice/ });
  assert.deepEqual(snapshot(context.app), before);
});

test('the CLI takes --font, --asset and --app-group, with a value after the option or after =', t => {
  const context = makeApp(t);
  const art = artwork(context);
  const cli = join(repo, 'cli', 'bin.mjs');
  const exec = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: context.app, env: context.env, encoding: 'utf8' });

  const done = exec('setup', '--font', art('Pacifico-Regular.ttf'), `--asset=${art('badge.png')}`, '--app-group=group.com.example.art');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /created +src-tauri\/gen\/apple\/LiveActivityWidget\/Fonts\/Pacifico-Regular\.ttf \(fontFamily: "Pacifico-Regular" or "Pacifico"\)/);
  assert.match(done.stdout, /created +src-tauri\/gen\/apple\/LiveActivityWidget\/Assets\.xcassets\/badge\.imageset\/badge\.png \(the asset "badge"\)/);
  assert.equal(appGroupOf(read(context, 'gen/apple/live-activity.yml')), 'group.com.example.art');
  for (const args of [['--font'], ['--asset='], ['--fonts', 'a.ttf']]) {
    const wrong = exec('setup', ...args);
    assert.equal(wrong.status, 2, args.join(' '));
    assert.match(wrong.stderr, /needs a file|Unknown option/);
  }
  const missing = exec('setup', '--font', art('none.ttf'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /none\.ttf: no such file/);
});

test('fontNames reads the family and PostScript names, Windows names first, and nothing else', () => {
  assert.deepEqual(fontNames(font([[1, 1, 'Mac'], [3, 1, 'Win'], [1, 6, 'Mac-PS'], [3, 16, 'Typographic']])), { family: 'Typographic', postScript: 'Mac-PS' });
  assert.deepEqual(fontNames(font([[3, 4, 'Full name only']])), undefined);
  assert.deepEqual(fontNames(font([[0, 1, 'Unicode platform']])), undefined);
  const ttc = Buffer.from(font([[3, 1, 'a']]));
  ttc.write('ttcf', 0, 'latin1');
  assert.equal(fontNames(ttc), undefined);
  const truncated = font([[3, 1, 'Family']]);
  assert.equal(fontNames(truncated.subarray(0, truncated.length - 3)), undefined);
  assert.equal(fontNames(Buffer.from('OTTO')), undefined);
  const noName = font([[3, 1, 'a']]);
  noName.write('cmap', 12, 'latin1');
  assert.equal(fontNames(noName), undefined);
});
