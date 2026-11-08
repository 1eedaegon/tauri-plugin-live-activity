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
import { PERMISSIONS, SetupError, setup } from '../cli/setup.mjs';
import { addInclude, readProject } from '../cli/xcodegen.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
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

/** A temporary app from a fixture, a plugin crate and a tauri crate in a fake registry, and fake tools. */
function makeApp(t, { fixture = 'fresh-app', pluginVersion = '0.2.0', xcodegen = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'la-setup-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const app = join(base, 'app');
  cpSync(join(fixtures, fixture), app, { recursive: true });
  const bin = join(base, 'bin');
  mkdirSync(bin);
  executable(join(bin, 'cargo'), FAKE_CARGO);
  if (xcodegen) executable(join(bin, 'xcodegen'), FAKE_XCODEGEN);
  const tauri = join(base, 'registry', 'tauri-2.12.5');
  for (const [file, text] of [
    ['Cargo.toml', '[package]\nname = "tauri"\n'],
    ['mobile/ios-api/Package.swift', '// swift-tools-version:5.3\n'],
    ['mobile/ios-api/Package.resolved', '{}\n'],
    ['mobile/ios-api/Sources/Tauri/Tauri.swift', 'public enum Tauri {}\n'],
    ['mobile/ios-api/Tests/TauriTests/TauriTests.swift', '\n'],
    ['mobile/ios-api/.build/debug.yaml', '\n'],
  ]) {
    mkdirSync(dirname(join(tauri, file)), { recursive: true });
    writeFileSync(join(tauri, file), text);
  }
  const env = {
    PATH: `${bin}:${nodeDir}`,
    CARGO: join(bin, 'cargo'),
    FAKE_METADATA: join(base, 'metadata.json'),
    FAKE_XCODEGEN_LOG: join(base, 'xcodegen.log'),
  };
  const context = { base, app, bin, tauri, env, srcTauri: join(app, 'src-tauri') };
  usePlugin(context, pluginVersion);
  return context;
}

/** Points cargo metadata at a copy of this crate's iOS files under the given version. */
function usePlugin(context, version) {
  const plugin = join(context.base, 'registry', `tauri-plugin-live-activity-${version}`);
  cpSync(join(repo, 'templates', 'ios'), join(plugin, 'templates', 'ios'), { recursive: true });
  mkdirSync(join(plugin, 'ios'), { recursive: true });
  cpSync(join(repo, 'ios', 'Package.swift'), join(plugin, 'ios', 'Package.swift'));
  writeFileSync(join(plugin, 'Cargo.toml'), `[package]\nname = "tauri-plugin-live-activity"\nversion = "${version}"\n`);
  const metadata = {
    packages: [
      { name: 'app', version: '0.1.0', id: 'app', manifest_path: join(context.srcTauri, 'Cargo.toml') },
      { name: 'tauri-plugin-live-activity', version, id: 'plugin', manifest_path: join(plugin, 'Cargo.toml') },
      { name: 'tauri', version: '2.12.5', id: 'tauri', manifest_path: join(context.tauri, 'Cargo.toml') },
    ],
    resolve: { nodes: [{ id: 'plugin', deps: [{ name: 'tauri', pkg: 'tauri' }] }] },
  };
  writeFileSync(context.env.FAKE_METADATA, JSON.stringify(metadata));
  context.plugin = plugin;
  return plugin;
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
  for (const name of ['LiveActivityWidget.swift', 'LiveActivityActionIntent.swift', 'Info.plist']) {
    assert.equal(read(context, `gen/apple/LiveActivityWidget/${name}`), readFileSync(join(repo, 'templates/ios', name), 'utf8'));
  }

  const spec = read(context, 'gen/apple/live-activity.yml');
  assert.ok(spec.includes(`path: ${JSON.stringify(join(context.plugin, 'ios'))}`));
  assert.match(spec, /\n  "app_iOS":\n    sources: \[LiveActivityWidget\/LiveActivityActionIntent.swift\]\n/);
  assert.match(spec, /\n  LiveActivityWidget:\n    type: app-extension\n/);
  for (const line of ['TauriLiveActivityLayout: 2', 'NSExtensionPointIdentifier: com.apple.widgetkit-extension',
    'PRODUCT_BUNDLE_IDENTIFIER: "com.example.lasetupcheck.widget"', 'CFBundleShortVersionString: "0.1.0"',
    'groups: [app]', 'product: LiveActivityShared', 'product: LiveActivityUI', 'deploymentTarget: "16.1"']) {
    assert.ok(spec.includes(line), line);
  }
  // Tauri writes project.yml without a final newline.
  assert.equal(read(context, 'gen/apple/project.yml'), `${projectBefore}\n\ninclude:\n  - live-activity.yml\n`);

  const swiftApi = join(context.plugin, '.tauri', 'tauri-api');
  assert.ok(existsSync(join(swiftApi, 'Sources/Tauri/Tauri.swift')));
  for (const left of ['Tests', 'Package.resolved', '.build']) assert.equal(existsSync(join(swiftApi, left)), false, left);
  assert.deepEqual(xcodegenRuns(context), [`generate --spec ${join(context.srcTauri, 'gen/apple/project.yml')}`]);

  assert.equal(result.steps.filter(step => step.status === 'todo').length, 0);
  assert.deepEqual(result.notes.map(note => note.kind), ['register']);
});

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

test('a dry run writes nothing and reports what it would do', t => {
  const context = makeApp(t);
  const before = snapshot(context.base);

  const result = run(context, { dryRun: true });

  assert.deepEqual(snapshot(context.base), before);
  const report = formatReport(result);
  assert.match(report, /Dry run: nothing was written\./);
  assert.match(report, /would create +src-tauri\/gen\/apple\/live-activity\.yml/);
  assert.match(report, /would update +src-tauri\/capabilities\/default\.json \(8 permissions added\)/);
  assert.match(report, /would run +xcodegen generate --spec src-tauri\/gen\/apple\/project\.yml/);
});

test('keeps a widget file that differs from the template, and says how to take the template', t => {
  const context = makeApp(t);
  run(context);
  const widget = join(context.srcTauri, 'gen/apple/LiveActivityWidget/LiveActivityWidget.swift');
  writeFileSync(widget, '// my widget\n');
  rmSync(join(context.srcTauri, 'gen/apple/LiveActivityWidget/Info.plist'));

  const result = run(context);

  assert.equal(readFileSync(widget, 'utf8'), '// my widget\n');
  const kept = result.steps.find(step => step.status === 'kept');
  assert.equal(kept.path, 'src-tauri/gen/apple/LiveActivityWidget/LiveActivityWidget.swift');
  assert.match(kept.detail, /differs from the plugin's template.*delete it and run setup again/);
  assert.equal(statuses(result)['src-tauri/gen/apple/LiveActivityWidget/Info.plist'], 'created');
  // XcodeGen lists a folder's files when it generates, so a file put back needs another run.
  assert.equal(xcodegenRuns(context).length, 2);
});

test('rewrites the spec it wrote after a plugin update, and keeps a spec the user edited', t => {
  const context = makeApp(t);
  run(context);
  const plugin = usePlugin(context, '0.2.1');

  const updated = run(context);

  const specPath = join(context.srcTauri, 'gen/apple/live-activity.yml');
  assert.equal(statuses(updated)['src-tauri/gen/apple/live-activity.yml'], 'updated');
  assert.ok(readFileSync(specPath, 'utf8').includes(JSON.stringify(join(plugin, 'ios'))));
  assert.equal(xcodegenRuns(context).length, 2);

  writeFileSync(specPath, `${readFileSync(specPath, 'utf8')}# mine\n`);
  usePlugin(context, '0.2.2');
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

test('without Tauri\'s Swift API in the dependencies it says how to get it', t => {
  const context = makeApp(t);
  rmSync(join(context.tauri, 'mobile'), { recursive: true });

  const result = run(context);

  const todo = result.steps.find(step => step.status === 'todo');
  assert.match(todo.path, /tauri-plugin-live-activity-0\.2\.0\/\.tauri\/tauri-api$/);
  assert.match(todo.detail, /cargo build --target aarch64-apple-ios-sim/);
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
  const context = makeApp(t, { pluginVersion: '0.3.0' });

  const result = run(context);

  const note = result.notes.find(item => item.kind === 'version');
  const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.ok(note.text.includes(`npm package ${version} and the crate 0.3.0`), note.text);
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
  const commands = ['request-permissions', 'start', 'update', 'end', 'start-layout', 'update-layout', 'end-layout'];
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
    name: 'my-app', appTarget: 'my-app_iOS', settingGroups: ['app'], bundleId: undefined, widget: undefined,
  });
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
