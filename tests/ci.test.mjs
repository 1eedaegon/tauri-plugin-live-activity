// The crate's manifest keeps activitykit to one line, and CI's `changes` job starts each job for its paths.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// TP-RUST-5
test('activitykit is one line of Cargo.toml and the crate builds no Swift of its own', () => {
  const manifest = read('Cargo.toml');
  const lines = manifest.split('\n').filter(line => /^\s*activitykit\s*=/.test(line));
  assert.deepEqual(lines, ['activitykit = { git = "https://github.com/1eedaegon/activitykit-rs", rev = "ff22261" }']);
  assert.doesNotMatch(manifest, /\[dependencies\.activitykit\]|activitykit\.(git|rev|version)\s*=/);
  assert.doesNotMatch(read('build.rs'), /ios_path/);
  assert.doesNotMatch(manifest, /"\/ios\/|"\/templates\//);
  for (const gone of ['ios', 'templates']) assert.equal(existsSync(new URL(`../${gone}`, import.meta.url)), false, gone);
  assert.match(read('Cargo.lock'), /name = "activitykit"\nversion = "0\.1\.0"\nsource = "git\+https:\/\/github\.com\/1eedaegon\/activitykit-rs\?rev=ff22261#ff2226/);
});

/** The `area` patterns of the changes job, by area. */
function areas() {
  const workflow = read('.github/workflows/ci.yml');
  const found = {};
  for (const [, name, pattern] of workflow.matchAll(/^\s+area (\w+) '([^']+)'$/gm)) found[name] = new RegExp(pattern.replaceAll('\\\\', '\\'));
  const every = /grep -qE '([^']+)' <<< "\$files"; then all/.exec(workflow)[1];
  return { found, every: new RegExp(every) };
}

/** The areas a change of `path` starts. */
function started(path) {
  const { found, every } = areas();
  if (every.test(path)) return Object.keys(found);
  return Object.entries(found).filter(([, pattern]) => pattern.test(path)).map(([name]) => name);
}

// TP-CI-1
test('the changes job starts the macOS job for the Rust crate, its lock file, setup and the iOS tests', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.deepEqual(Object.keys(areas().found), ['rust', 'js', 'ios', 'android']);
  for (const path of ['Cargo.lock', 'Cargo.toml', 'src/apple/mod.rs', 'src/ios.rs', 'cli/ios.mjs', 'tests/ios/run.sh',
    'examples/demo/widget/MochiWidgets.swift']) {
    assert.ok(started(path).includes('ios'), path);
  }
  assert.deepEqual(started('docs/usage.md'), []);
  assert.deepEqual(started('android/src/main/java/io/github/eedaegon/liveactivity/Lifecycle.kt'), ['android']);
  assert.ok(started('Cargo.lock').includes('android'));
  assert.deepEqual(started('tests/fixtures/layout-requests.json'), ['rust', 'js', 'ios', 'android']);
  assert.match(workflow, /if: needs\.changes\.outputs\.rust == 'true' \|\| needs\.changes\.outputs\.js == 'true' \|\| needs\.changes\.outputs\.ios == 'true'\n\s+runs-on: macos-/);
  // The specification check runs for every change, docs alone included.
  assert.match(workflow, /\n  spec:\n    name: Specification\n    runs-on: ubuntu-latest\n/);
  assert.match(workflow, /run: sh tools\/spec-coverage\.sh/);
});

// TP-BUILD-1
test("the macOS job checks the iOS code for the device and builds it, with activitykit's Swift, for the simulator", () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /run: ACTIVITYKIT_SKIP_SWIFT=1 cargo clippy --locked --target aarch64-apple-ios --lib -- -D warnings/);
  assert.match(workflow, /run: cargo build --locked --target x86_64-apple-ios --lib/);
  assert.match(workflow, /--target x86_64-apple-ios,aarch64-apple-ios/);
});

