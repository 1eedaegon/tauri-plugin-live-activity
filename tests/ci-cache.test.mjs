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
  write(root, '.github/workflows/ci.yml', 'name: CI\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  return root;
}

const runner = {
  XCODE: '26.3-17C529', RUNTIME: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2', TOOLCHAIN: '1.99.1', XCODEGEN: '2.44.1',
  NODE: '24', RUNNER_OS: 'macOS', RUNNER_ARCH: 'X64', ImageOS: 'macos15', ImageVersion: '20261101.1',
};

/** Runs cache.sh with `args` and returns what it wrote to GITHUB_OUTPUT. A variable of `env` set to undefined is unset. */
function run(root, temp, args, env = {}) {
  const output = join(temp, 'github-output');
  writeFileSync(output, '');
  const all = { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', ...runner, ...env, RUNNER_TEMP: temp,
    GITHUB_OUTPUT: output, GITHUB_SHA: '0123abc', GITHUB_REPOSITORY: 'owner/repository' };
  execFileSync('sh', [join(root, 'tests/ci/cache.sh'), ...args], {
    env: Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined)),
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
    // Each suite in its own mode, as each CI job runs it.
    const keys = env => ({ ...run(root, temp, ['keys', 'simulator'], env), dev: run(root, temp, ['keys', 'dev'], { MODE: 'dev', ...env }).dev });
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
test('a record names the workflow and what selects the suite, so a narrower run never stands for a full one', () => {
  within((root, temp) => {
    const simulator = env => run(root, temp, ['keys', 'simulator'], env);
    const dev = env => run(root, temp, ['keys', 'dev'], { MODE: 'dev', ...env });
    const full = simulator();
    const fullDev = dev();
    // The workflow file: new records, the same products.
    write(root, '.github/workflows/ci.yml', 'name: CI\non: push\n');
    git(root, 'add', '-A');
    const workflow = simulator();
    assert.notEqual(workflow.simulator, full.simulator);
    assert.notEqual(dev().dev, fullDev.dev);
    assert.equal(workflow.products, full.products);
    // Some tests, or no retries: other records than the full run's, the same products.
    for (const env of [{ ONLY: 'DemoTests/test1BoundStyleShowsOnTheLockScreen' }, { CI: undefined }]) {
      const narrower = simulator(env);
      assert.notEqual(narrower.simulator, workflow.simulator, JSON.stringify(env));
      assert.equal(narrower.products, workflow.products, JSON.stringify(env));
    }
    assert.notEqual(dev({ ONLY: 'DemoTests/test7RustStartsALayoutWhoseButtonReachesRust' }).dev, dev().dev);
    // A suite runs in its own mode only.
    assert.equal(simulator({ MODE: 'build' }).simulator, workflow.simulator);
    assert.throws(() => simulator({ MODE: 'dev' }));
    assert.throws(() => dev({ MODE: 'build' }));
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
    assert.match(clean, /^version 1\nsuite simulator\nfiles [0-9a-f]{40}\nworkflow [0-9a-f]{40}\nselection mode build only - iterations 3\nxcode 26\.3-17C529\nrunner macOS-X64 macos15 20261101\.1\nrust 1\.99\.1\nxcodegen 2\.44\.1\nnode 24\nruntime com\.apple\.CoreSimulator\.SimRuntime\.iOS-26-2\nrun https:\/\/github\.com\/owner\/repository\/actions\/runs\/0 attempt 1\ncommit 0123abc \n$/);
    writeFileSync(passed, 'DemoTests/test6TapLaunchesTheAppForASlowRustHandler');
    run(root, temp, ['record', 'simulator', passed]);
    assert.match(readFileSync(join(temp, 'passed-simulator/passed.txt'), 'utf8'), /\nretried DemoTests\/test6TapLaunchesTheAppForASlowRustHandler\n$/);
  });
});

/** A `gh` that answers the artifact API from canned replies in `dir`, running the `--jq` filter as gh does. */
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const dir = process.env.FAKE_GH;
const [command, url, ...rest] = process.argv.slice(2);
if (command !== 'api') process.exit(2);
const at = rest.indexOf('--jq');
const filter = at === -1 ? undefined : rest[at + 1];
let body;
let match;
if (/^repos\\/owner\\/repository\\/actions\\/artifacts\\?name=/.test(url)) body = fs.readFileSync(dir + '/artifacts.json', 'utf8');
else if ((match = /^repos\\/owner\\/repository\\/actions\\/runs\\/(\\d+)$/.exec(url))) body = JSON.stringify(JSON.parse(fs.readFileSync(dir + '/runs.json', 'utf8'))[match[1]]);
else if ((match = /^repos\\/owner\\/repository\\/actions\\/artifacts\\/(\\d+)\\/zip$/.exec(url))) { process.stdout.write(fs.readFileSync(dir + '/' + match[1] + '.zip')); process.exit(0); }
else process.exit(1);
process.stdout.write(filter ? execFileSync('jq', ['-r', filter], { input: body }) : body);
`;

/** Canned replies: the artifacts, the workflow of each run, and a record in each artifact's zip. */
function api(dir, artifacts, runs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'artifacts.json'), JSON.stringify({ artifacts }));
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(Object.fromEntries(Object.entries(runs).map(([run, path]) => [run, { path }]))));
  for (const artifact of artifacts) {
    execFileSync('python3', ['-I', '-c', 'import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], "w") as z: z.writestr("passed.txt", sys.argv[2])',
      join(dir, `${artifact.id}.zip`), `version 1\nrun ${artifact.workflow_run.id}\n`]);
  }
}

const artifact = (id, run, { fork = false, expired = false, day = id } = {}) => ({
  id, expired, created_at: `2026-11-0${day}T00:00:00Z`,
  workflow_run: { id: run, repository_id: 7, head_repository_id: fork ? 9 : 7 },
});

// TP-CI-3
test("a pass counts only from this repository's ci.yml, never from a fork or another workflow", () => {
  within((root, temp) => {
    const bin = join(temp, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
    const passed = (artifacts, runs) => {
      const dir = mkdtempSync(join(temp, 'api-'));
      api(dir, artifacts, runs);
      return run(root, temp, ['passed', 'passed-simulator-x'], { PATH: `${bin}:${process.env.PATH}`, FAKE_GH: dir });
    };
    const ci = '.github/workflows/ci.yml';
    // The newest record comes from a fork's run of ci.yml, the next one expired; the oldest is this repository's.
    assert.deepEqual(passed(
      [artifact(3, 103, { fork: true }), artifact(2, 102, { expired: true }), artifact(1, 101)],
      { 101: ci, 102: ci, 103: ci },
    ), { found: 'true', run: 'https://github.com/owner/repository/actions/runs/101' });
    assert.deepEqual(passed([artifact(3, 103, { fork: true })], { 103: ci }), { found: 'false' });
    assert.deepEqual(passed([artifact(4, 104)], { 104: '.github/workflows/release.yml' }), { found: 'false' });
  });
});
