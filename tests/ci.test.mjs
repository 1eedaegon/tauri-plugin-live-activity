// The crate's manifest keeps activitykit to one line, and CI's `changes` job starts each job for its paths.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// TP-RUST-5
test('activitykit is one line of Cargo.toml and the crate builds no Swift of its own', () => {
  const manifest = read('Cargo.toml');
  const lines = manifest.split('\n').filter(line => /^\s*activitykit\s*=/.test(line));
  assert.deepEqual(lines, ['activitykit = "0.1"']);
  assert.doesNotMatch(manifest, /\[dependencies\.activitykit\]|activitykit\.(git|rev|version)\s*=/);
  assert.doesNotMatch(read('build.rs'), /ios_path/);
  assert.doesNotMatch(manifest, /"\/ios\/|"\/templates\//);
  for (const gone of ['ios', 'templates']) assert.equal(existsSync(new URL(`../${gone}`, import.meta.url)), false, gone);
  assert.match(read('Cargo.lock'), /name = "activitykit"\nversion = "0\.1\.\d+"\nsource = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"/);
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
    'examples/demo/widget/MochiWidgets.swift', 'examples/demo/src/main.ts', 'guest-js/index.ts', 'package-lock.json']) {
    assert.ok(started(path).includes('ios'), path);
  }
  assert.deepEqual(started('docs/usage.md'), []);
  assert.deepEqual(started('android/src/main/java/io/github/eedaegon/liveactivity/Lifecycle.kt'), ['android']);
  assert.ok(started('Cargo.lock').includes('android'));
  assert.deepEqual(started('tests/fixtures/layout-requests.json'), ['rust', 'js', 'ios', 'android']);
  assert.match(workflow, /if: needs\.changes\.outputs\.rust == 'true' \|\| needs\.changes\.outputs\.js == 'true' \|\| needs\.changes\.outputs\.ios == 'true'\n\s+runs-on: macos-/);
  assert.match(workflow, /\n  e2e:\n    name: Demo on the iOS Simulator\n    needs: changes\n    if: needs\.changes\.outputs\.ios == 'true'\n    runs-on: macos-/);
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

/** The steps of one job, as text. */
function job(name) {
  const workflow = read('.github/workflows/ci.yml');
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, name);
  const rest = workflow.slice(start + 1);
  const end = rest.slice(1).search(/\n  [a-z0-9_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

// TP-CI-3
test('CI caches the Rust builds, installs cargo-llvm-cov, and caches the simulator build and its passes', () => {
  const rustCache = 'Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2.9.3';
  for (const name of ['contracts', 'desktop', 'e2e']) assert.ok(job(name).includes(rustCache), name);
  assert.match(job('contracts'), /taiki-e\/install-action@cfdb7ed4ccc7c7dce37759eae89dc5674b469b39 # v2\.90\.3\n\s+if: env\.RUST == 'true'\n\s+with:\n\s+tool: cargo-llvm-cov@0\.9\.1/);
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /cargo install cargo-llvm-cov/);
  const e2e = job('e2e');
  const cache = 'actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0';
  const save = 'actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0';
  // A pass is remembered under the inputs, the runner image and the Xcode version, and looked up without a download.
  const passed = 'e2e-passed-${{ env.ImageOS }}-${{ env.ImageVersion }}-${{ steps.xcode.outputs.version }}-${{ steps.inputs.outputs.hash }}';
  assert.equal(e2e.split(`key: ${passed}`).length, 3);
  assert.ok(e2e.includes(`${cache}\n        with:\n          path: .e2e-passed\n          key: ${passed}\n          lookup-only: true`));
  assert.ok(e2e.includes(`${save}\n        with:\n          path: .e2e-passed`));
  // The built demo and UI tests under the inputs and the Xcode version; an exact hit reuses them.
  const built = 'ios-build-${{ env.ImageOS }}-${{ steps.xcode.outputs.version }}-${{ steps.inputs.outputs.hash }}';
  assert.equal(e2e.split(`key: ${built}`).length, 3);
  assert.ok(e2e.includes("REUSE: ${{ steps.built.outputs.cache-hit == 'true' && '1' || '' }}"));
  for (const input of ["'Cargo.lock'", "'src/**'", "'examples/demo/**'", "'tests/ios/**'", "'!examples/demo/src-tauri/target/**'"]) {
    assert.ok(e2e.includes(input), input);
  }
  // Every step after the lookup is skipped on a pass, so the job stays green.
  assert.ok(e2e.includes("name: End to end on the simulator\n        if: steps.passed.outputs.cache-hit != 'true'"));
  const script = read('tests/ios/run.sh');
  assert.match(script, /xcodebuild test-without-building -xctestrun/);
  assert.match(script, /destination="platform=iOS Simulator,id=\$device,arch=\$arch"/);
  assert.match(script, /\[ "\$\{REUSE:-\}" = 1 \]/);
  assert.match(read('.gitignore'), /^\.ios-build\/$/m);
});

