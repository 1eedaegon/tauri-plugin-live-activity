// tests/ci/cache.sh on a git repository of its own: what changes the names of the records and the key of the built
// demo and UI tests, and when a pass is recorded.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./ci/cache.sh', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A repository with cache.sh, a tracked input, a doc and a file of the demo. */
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'live-activity-cache-'));
  mkdirSync(join(root, 'tests/ci'), { recursive: true });
  copyFileSync(script, join(root, 'tests/ci/cache.sh'));
  write(root, 'src/lib.rs', 'fn one() {}\n');
  write(root, 'docs/usage.md', 'usage\n');
  write(root, 'examples/demo/src/main.ts', 'main\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  return root;
}

const runner = {
  XCODE: '26.3-17C529', RUNTIME: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2', TOOLCHAIN: '1.99.1', XCODEGEN: '2.44.1',
  NODE: '24', RUNNER_OS: 'macOS', RUNNER_ARCH: 'X64', ImageOS: 'macos15', ImageVersion: '20261101.1',
};

/** Runs cache.sh with `args` and returns what it wrote to GITHUB_OUTPUT. */
function run(root, temp, args, env = {}) {
  const output = join(temp, 'github-output');
  writeFileSync(output, '');
  execFileSync('sh', [join(root, 'tests/ci/cache.sh'), ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...runner, ...env, RUNNER_TEMP: temp, GITHUB_OUTPUT: output,
      GITHUB_SHA: '0123abc', GITHUB_REPOSITORY: 'owner/repository' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
}

function within(task) {
  const root = repository();
  const temp = mkdtempSync(join(tmpdir(), 'live-activity-cache-run-'));
  try {
    task(root, temp);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
}

// TP-CI-3
test('a record is named after the tracked inputs, Xcode, the image, the tools and the runtime; the products after what builds them', () => {
  within((root, temp) => {
    const keys = env => run(root, temp, ['keys', 'simulator', 'dev'], env);
    const first = keys();
    assert.deepEqual(keys(), first);
    assert.match(first.simulator, /^passed-simulator-[0-9a-f]{40}$/);
    assert.match(first.dev, /^passed-dev-[0-9a-f]{40}$/);
    assert.notEqual(first.simulator.slice(-40), first.dev.slice(-40));
    assert.match(first.products, /^ios-build-v1-macOS-X64-xcode26\.3-17C529-[0-9a-f]{40}$/);
    assert.equal(first.runtime, runner.RUNTIME);
    // Nothing that the suites do not read: a doc, an untracked file.
    write(root, 'docs/usage.md', 'changed\n');
    git(root, 'add', '-A');
    write(root, 'examples/demo/untracked.txt', 'not tracked\n');
    assert.deepEqual(keys(), first);
    // Xcode or a tool: new records and new products.
    for (const env of [{ XCODE: '26.4-17D100' }, { TOOLCHAIN: '1.99.2' }, { XCODEGEN: '2.45.0' }, { NODE: '26' }]) {
      const other = keys(env);
      assert.notEqual(other.simulator, first.simulator, JSON.stringify(env));
      assert.notEqual(other.dev, first.dev, JSON.stringify(env));
      assert.notEqual(other.products, first.products, JSON.stringify(env));
    }
    // The runner image or the simulator runtime: new records, the same products.
    for (const env of [{ ImageVersion: '20261108.1' }, { RUNTIME: 'com.apple.CoreSimulator.SimRuntime.iOS-26-3' }]) {
      const other = keys(env);
      assert.notEqual(other.simulator, first.simulator, JSON.stringify(env));
      assert.equal(other.products, first.products, JSON.stringify(env));
    }
    // A tracked input: everything new.
    write(root, 'src/lib.rs', 'fn two() {}\n');
    git(root, 'add', '-A');
    const changed = keys();
    for (const name of ['simulator', 'dev', 'products']) assert.notEqual(changed[name], first[name], name);
  });
});

// TP-CI-3
test('only a full pass leaves a record, with the inputs, the run and the tests that passed on a retry', () => {
  within((root, temp) => {
    run(root, temp, ['keys', 'simulator']);
    assert.deepEqual(run(root, temp, ['record', 'simulator', join(temp, 'no-such-file')]), { recorded: 'false' });
    assert.equal(existsSync(join(temp, 'passed-simulator')), false);
    const passed = join(temp, 'passed');
    writeFileSync(passed, '');
    assert.deepEqual(run(root, temp, ['record', 'simulator', passed]), { recorded: 'true' });
    const clean = readFileSync(join(temp, 'passed-simulator/passed.txt'), 'utf8');
    assert.match(clean, /^version 1\nsuite simulator\nfiles [0-9a-f]{40}\nxcode 26\.3-17C529\nrunner macOS-X64 macos15 20261101\.1\nrust 1\.99\.1\nxcodegen 2\.44\.1\nnode 24\nruntime com\.apple\.CoreSimulator\.SimRuntime\.iOS-26-2\nrun https:\/\/github\.com\/owner\/repository\/actions\/runs\/0 attempt 1\ncommit 0123abc \n$/);
    writeFileSync(passed, 'DemoTests/test6TapLaunchesTheAppForASlowRustHandler');
    run(root, temp, ['record', 'simulator', passed]);
    assert.match(readFileSync(join(temp, 'passed-simulator/passed.txt'), 'utf8'), /\nretried DemoTests\/test6TapLaunchesTheAppForASlowRustHandler\n$/);
  });
});
