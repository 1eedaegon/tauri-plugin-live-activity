// The crate's manifest keeps liveactivity to one line; CI's `changes` job starts each job for its paths; the simulator
// jobs key their caches and records on the files they read and pin their tools; run.sh tests through the scheme.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { list, member, present, record, text } from './support.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// TP-RUST-5
test('liveactivity is one line of Cargo.toml, brings both engines, and the crate builds no Swift of its own', () => {
  const manifest = read('Cargo.toml');
  // The engines come through liveactivity alone, so the plugin and the interface always build on the same versions.
  const lines = manifest.split('\n').filter(line => /^\s*(liveactivity|activitykit|liveupdate)\s*=/.test(line));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(present(lines[0]), /^liveactivity = /);
  assert.doesNotMatch(manifest, /\[dependencies\.(liveactivity|activitykit|liveupdate)\]/);
  assert.doesNotMatch(read('build.rs'), /ios_path/);
  assert.doesNotMatch(manifest, /"\/ios\/|"\/templates\//);
  for (const gone of ['ios', 'templates']) assert.equal(existsSync(new URL(`../${gone}`, import.meta.url)), false, gone);
  assert.match(read('Cargo.lock'), /name = "activitykit"\nversion = "0\.6\.\d+"\nsource = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"/);
});

// TP-BUILD-2
test('unwrap and expect are denied outside tests, in the crate and the demo, and the documents show neither', () => {
  const denied = '#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]';
  assert.ok(read('src/lib.rs').includes(denied), 'the plugin');
  assert.ok(read('examples/demo/src-tauri/src/lib.rs').includes(denied), 'the demo');
  // Clippy is what refuses one: it takes a warning for an error, on each target the plugin has code for and on the
  // demo, whose crate has a lock of its own.
  const workflow = read('.github/workflows/ci.yml');
  for (const run of [
    'cargo clippy --locked --all-targets -- -D warnings',
    'cargo clippy --locked --target aarch64-apple-ios --lib -- -D warnings',
    'cargo clippy --locked --target aarch64-linux-android --lib -- -D warnings',
    'cargo clippy --locked --manifest-path examples/demo/src-tauri/Cargo.toml --all-targets -- -D warnings',
  ]) assert.ok(workflow.includes(run), run);
  // The Rust that a document tells an app to write.
  for (const file of ['README.md', 'README.ko.md', 'docs/usage.md', 'docs/android-integration.md', 'docs/ios-integration.md']) {
    const blocks = Array.from(read(file).matchAll(/```rust\n([\s\S]*?)```/g), ([, code]) => present(code));
    for (const code of blocks) assert.doesNotMatch(code, /\.(unwrap|expect)\(/, file);
  }
});

const root = new URL('..', import.meta.url);

/** What the changes job goes by: the pattern of each area by its name, and the pattern of what concerns every job. */
interface Areas {
  readonly found: Readonly<Record<string, RegExp>>;
  readonly every: RegExp;
}

/** The `area` patterns of the changes job, by area, and the pattern of what concerns every job. */
function areas(): Areas {
  const workflow = read('.github/workflows/ci.yml');
  const found: Record<string, RegExp> = {};
  for (const [, name, pattern] of workflow.matchAll(/^\s+area (\w+) '([^']+)'$/gm)) found[present(name)] = new RegExp(present(pattern).replaceAll('\\\\', '\\'));
  const every = present(/grep -qE '([^']+)' <<< "\$files"; then all/.exec(workflow)?.[1]);
  return { found, every: new RegExp(every) };
}

/** The areas a change of `path` starts. */
function started(path: string): readonly string[] {
  const { found, every } = areas();
  if (every.test(path)) return Object.keys(found);
  return Object.entries(found).filter(([, pattern]) => pattern.test(path)).map(([name]) => name);
}

/** The paths whose tracked files tests/ci/cache.sh hashes for the simulator suites. */
function inputs(): readonly string[] {
  const list = present(/^inputs="([^"]+)"$/ms.exec(read('tests/ci/cache.sh'))?.[1]);
  return list.split(/\s+/).filter(Boolean);
}

const git = (...args: readonly string[]): readonly string[] => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

// TP-CI-1, TP-CI-5
test('the changes job starts each job for its paths, and the ios area is what the simulator suites read', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.deepEqual(Object.keys(areas().found), ['rust', 'js', 'ios', 'android']);
  const starts = {
    rust: ['src/lib.rs', 'src/service.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml',
      'tests/contract.rs', 'examples/demo/src-tauri/src/lib.rs', 'guest-js/types.ts',
      'android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt'],
    js: ['guest-js/index.ts', 'cli/setup.mts', 'cli/tsconfig.json', 'tools/activitykit.ts', 'tests/api.test.ts', 'tests/tsconfig.json',
      'tests/release/release-guard.test.ts', 'tests/jsx/elements.tsx', 'tests/declarations/members.ts',
      'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo/src/main.ts',
      'src/android.rs', 'src/files.rs', 'src/lib.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml',
      'tests/android_contents.rs', 'android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt',
      'android/consumer-rules.pro', 'android/build.gradle.kts', 'tests/android/settings.gradle.kts',
      'contracts/request.schema.json'],
    ios: ['src/ios.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml', 'guest-js/types.ts', 'cli/ios.mts',
      'cli/tsconfig.json', 'tools/activitykit.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo/link-activitykit.ts',
      'tests/ios/run.sh', 'tests/ci/cache.sh'],
    android: ['android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt', 'tests/android/settings.gradle.kts',
      'Cargo.toml', 'Cargo.lock', 'src/android.rs', 'src/bridge.rs', 'src/lib.rs', 'build.rs'],
  };
  const not = {
    rust: ['cli/setup.mts', 'guest-js/index.ts', 'tests/api.test.ts', 'tests/ios/run.sh', 'docs/spec.md',
      'android/build.gradle.kts', 'android/src/androidTest/AndroidManifest.xml'],
    js: ['tests/ios/run.sh', 'tests/ci/cache.sh', 'docs/spec.md', 'README.md'],
    ios: ['tests/api.test.ts', 'tests/contract.rs', 'tests/ci.test.ts', 'android/build.gradle.kts', 'docs/spec.md', 'README.md'],
    android: ['guest-js/index.ts', 'tests/ios/run.sh', 'tests/api.test.ts'],
  };
  for (const [area, paths] of Object.entries(starts)) for (const path of paths) assert.ok(started(path).includes(area), `${path} → ${area}`);
  for (const [area, paths] of Object.entries(not)) for (const path of paths) assert.ok(!started(path).includes(area), `${path} ↛ ${area}`);
  assert.deepEqual(started('docs/usage.md'), []);
  // The fixtures concern every part. Among them are the requests that the TypeScript side builds, which node tests
  // keep and Rust judges (tests/typescript_requests.rs): one that is written again starts the Rust jobs.
  for (const path of ['tests/fixtures/typescript/jsx.json', 'tests/fixtures/android/contents.json', '.github/workflows/ci.yml']) {
    assert.deepEqual(started(path), ['rust', 'js', 'ios', 'android'], path);
  }
  // The ios area names exactly the tracked files that the simulator suites read, as cache.sh hashes them.
  assert.deepEqual(inputs(), ['src', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions', 'guest-js', 'cli', 'tools',
    'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo', 'tests/ios', 'tests/ci']);
  const read_by_the_suites = new Set(git('ls-files', '--', ...inputs()));
  const { found } = areas();
  for (const path of git('ls-files')) assert.equal(present(found.ios).test(path), read_by_the_suites.has(path), path);
  // The node tests read the Rust and the Kotlin as text: the commands of both sides, the names of the plugin's
  // files, the copy of liveupdate's adapter against the crate that Cargo.lock names, the permissions that setup
  // grants. So every file that starts the Rust or the Android job starts them too.
  for (const path of git('ls-files')) {
    if (present(found.rust).test(path) || present(found.android).test(path)) assert.ok(present(found.js).test(path), `${path} → js`);
  }
  // And the Rust tests read the TypeScript types and the Kotlin, where the error codes of the three languages are
  // one list: what they read starts the Rust jobs.
  const readByRust = [...read('src/types_tests.rs').matchAll(/\b(?:source|raised)\(\s*"([^"]+)"/g)].map(([, path]) => present(path));
  assert.deepEqual(readByRust, ['guest-js/types.ts', 'android/src/main']);
  const kotlin = git('ls-files', '--', ...readByRust);
  assert.ok(kotlin.length > 5, String(kotlin.length));
  for (const path of kotlin) assert.ok(present(found.rust).test(path), `${path} → rust`);
  assert.match(workflow, /if: needs\.changes\.outputs\.rust == 'true' \|\| needs\.changes\.outputs\.js == 'true' \|\| needs\.changes\.outputs\.ios == 'true'\n\s+runs-on: macos-/);
  // The simulator jobs run only in a run started by hand with `simulator` on: a push or a pull request never starts them.
  const byHand = "if: github.event_name == 'workflow_dispatch' && inputs.simulator && needs.changes.outputs.ios == 'true'";
  assert.ok(workflow.includes(`\n  e2e:\n    name: Demo on the iOS Simulator\n    needs: changes\n    ${byHand}\n    runs-on: macos-`), 'e2e');
  assert.ok(workflow.includes(`\n  e2e-dev:\n    name: Demo in tauri ios dev on the iOS Simulator\n    needs: changes\n    ${byHand}\n    runs-on: macos-`), 'e2e-dev');
  assert.match(workflow, /\n      simulator:\n        description: [^\n]+\n        type: boolean\n        default: false\n/);
  // The demo's Rust embeds its page (frontendDist), so the macOS job builds the page before the demo's Rust tests,
  // also when only the Rust changed.
  const contracts = job('contracts');
  assert.ok(contracts.includes("if: env.AREA_JS == 'true' || env.AREA_RUST == 'true'\n        run: npm ci\n"), 'npm ci');
  assert.ok(contracts.includes("if: env.AREA_RUST == 'true'\n        run: npm run build:demo && cargo test --locked --manifest-path examples/demo/src-tauri/Cargo.toml\n"), 'demo');
  // The specification check runs for every change, docs alone included.
  assert.match(workflow, /\n  spec:\n    name: Specification\n    runs-on: ubuntu-latest\n/);
  assert.match(workflow, /run: sh tools\/spec-coverage\.sh/);
  // So do the tests of CI's own scripts: a change to tests/ios/run.sh or tests/ci/cache.sh alone starts the ios
  // area, for which the macOS job runs none of the other node tests. And so does the test of the documents'
  // links and pictures (TP-CI-8): a change of the documents alone starts no other job.
  assert.ok(job('spec').endsWith('      - run: node --test tests/spec-coverage.test.ts tests/ci.test.ts tests/ci-cache.test.ts tests/ios-run.test.ts tests/docs.test.ts'));
  assert.deepEqual(started('tests/ios/run.sh'), ['ios']);
  assert.deepEqual(started('tests/ci/cache.sh'), ['ios']);
  // The Specification job has dash for its sh. The simulator jobs run run.sh with a Mac's, bash 3.2, and the two
  // differ in what a run does once nobody reads its log: for the ios area the macOS job runs the tests of run.sh
  // too, with the workflow's Node whatever changed. For the js area they are among those of `npm test`.
  assert.ok(contracts.includes("      - if: env.AREA_IOS == 'true' && env.AREA_JS != 'true'\n        run: node --test tests/ios-run.test.ts\n"), 'run.sh under bash 3.2');
  assert.ok(contracts.includes("      - if: env.AREA_JS == 'true'\n        run: npm test && npm run typecheck && npm run build:demo\n"), 'npm test');
  assert.match(read('package.json'), /"test:contracts": "[^"\n]*(?:\\"[^"\n]*)* tests\/ios-run\.test\.ts /);
  // Node comes whatever changed, and the cache of npm only on the condition of `npm ci`, which fills it: after a job
  // that did not find the cache, setup-node saves npm's folder as it is then.
  assert.match(contracts, /uses: actions\/setup-node@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}node-version: \$\{\{ env\.NODE \}\}\n {10}cache: \$\{\{ \(env\.AREA_JS == 'true' \|\| env\.AREA_RUST == 'true'\) && 'npm' \|\| '' \}\}\n/);
});

// TP-CI-5
test('the step of a simulator suite is the script itself, which the signal of a cancelled job reaches', async () => {
  // CI's runner signals the process of the step and no other, and a step is a file that bash runs (`bash -e {0}`).
  // With `sh tests/ios/run.sh` in that file bash stands between and hands no signal on: after each of two cancelled
  // jobs, processes of the step still ran a minute and more later. `exec` makes the script the step's process.
  const steps = ['e2e', 'e2e-dev'].map(name => present(/\n {8}run: (.*tests\/ios\/run\.sh)\n/.exec(job(name))?.[1]));
  assert.deepEqual(steps, ['exec sh tests/ios/run.sh', 'exec sh tests/ios/run.sh']);
  // The step as the runner runs it, in a folder where a script in the place of run.sh says which signal it got.
  const temp = mkdtempSync(join(tmpdir(), 'live-activity-step-'));
  mkdirSync(join(temp, 'tests/ios'), { recursive: true });
  writeFileSync(join(temp, 'tests/ios/run.sh'), "trap 'echo INT > got; exit 130' INT\necho \"$$\" > started\nwhile [ -e started ]; do /bin/sleep 0.05; done\n");
  writeFileSync(join(temp, 'step.sh'), `${steps[0]}\n`);
  const child = spawn('/bin/bash', ['-e', join(temp, 'step.sh')], { cwd: temp, stdio: 'ignore' });
  const exited: Promise<readonly unknown[]> = once(child, 'exit');
  /** What the script wrote into the file of this name, once it has. */
  const written = async (name: string): Promise<string> => {
    for (let waited = 0; !existsSync(join(temp, name)) || readFileSync(join(temp, name), 'utf8') === ''; waited += 20) {
      assert.ok(waited < 60_000, `${name}: not in a minute`);
      await pause(20);
    }
    return readFileSync(join(temp, name), 'utf8').trim();
  };
  try {
    assert.equal(Number(await written('started')), child.pid, 'the script is the process of the step');
    child.kill('SIGINT');
    assert.equal(await written('got'), 'INT');
    assert.deepEqual((await exited).slice(0, 2), [130, null]);
  } finally {
    child.kill('SIGKILL');
    await exited;
    // The script in the place of run.sh ends when its folder goes.
    rmSync(temp, { recursive: true, force: true });
  }
});

// TP-BUILD-1
test("the macOS job checks the iOS code for the device and builds it, with activitykit's Swift, for the simulator", () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /run: ACTIVITYKIT_SKIP_SWIFT=1 cargo clippy --locked --target aarch64-apple-ios --lib -- -D warnings/);
  assert.match(workflow, /run: cargo build --locked --target x86_64-apple-ios --lib/);
  assert.match(workflow, /--target x86_64-apple-ios,aarch64-apple-ios/);
});

/** The steps of one job, as text. */
function job(name: string): string {
  const workflow = read('.github/workflows/ci.yml');
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, name);
  const rest = workflow.slice(start + 1);
  const end = rest.slice(1).search(/\n  [a-z0-9_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

// TP-CI-3
test('CI caches the Rust builds and the built demo, pins its tools, and skips a suite that passed for the same inputs', () => {
  const workflow = read('.github/workflows/ci.yml');
  const env = present(/^env:\n((?:  .*\n)+)/m.exec(workflow)?.[1]);
  assert.match(env, /^  TOOLCHAIN: 1\.\d+\.\d+$/m);
  assert.match(env, /^  XCODEGEN: 2\.44\.1$/m);
  assert.match(env, /^  XCODEGEN_SHA256: a2e905fb68446e9bb4008cdfe2e13e3f176d0cbcca828b71770f8e53fca91b73$/m);
  assert.match(env, /^  NODE: '24'$/m);
  // Every job installs the pinned Rust, and XcodeGen comes from its release, checked against its digest.
  assert.doesNotMatch(workflow, /rustup (toolchain install|default) 1\./);
  assert.doesNotMatch(workflow, /brew install xcodegen|hashFiles|env\.ImageOS|env\.ImageVersion/);
  for (const name of ['contracts', 'desktop', 'e2e', 'e2e-dev']) assert.match(job(name), /rustup toolchain install "\$TOOLCHAIN"/, name);
  const install = 'curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 -o "$RUNNER_TEMP/xcodegen.zip" "https://github.com/yonaskolb/XcodeGen/releases/download/$XCODEGEN/xcodegen.zip"\n'
    + '          echo "$XCODEGEN_SHA256  $RUNNER_TEMP/xcodegen.zip" | shasum -a 256 -c -';
  const rustCache = 'Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2.9.3';
  for (const name of ['contracts', 'desktop', 'e2e', 'e2e-dev']) assert.ok(job(name).includes(rustCache), name);
  assert.match(job('contracts'), /taiki-e\/install-action@cfdb7ed4ccc7c7dce37759eae89dc5674b469b39 # v2\.90\.3\n\s+if: env\.AREA_RUST == 'true'\n\s+with:\n\s+tool: cargo-llvm-cov@0\.9\.1/);
  assert.doesNotMatch(workflow, /cargo install cargo-llvm-cov/);
  // src/android.rs is compiled only for Android: the android job checks it, since nothing else builds it.
  assert.match(job('android'), /rustup toolchain install "\$TOOLCHAIN" --profile minimal --component clippy --target aarch64-linux-android[\s\S]*?- run: cargo clippy --locked --target aarch64-linux-android --lib -- -D warnings\n/);
  assert.match(job('android'), /gradle\/actions\/setup-gradle@8da46b539cd8fe6ab27ca75128919a18d757604c # v6\.4\.1\n[\s\S]*?- name: Fetch Gradle\n\s+working-directory: tests\/android\n\s+run: for attempt in 1 2 3; do \.\/gradlew --version --no-daemon[^\n]*\n[\s\S]*?- name: Unit tests, lint and the instrumentation APK\n\s+working-directory: tests\/android\n\s+run: \|\n\s+set -o pipefail\n/);
  // Only a network failure runs the Gradle build again: a failing test or lint ends the job.
  assert.match(job('android'), /\|\| exit 1\n\s+echo "::warning title=Gradle download::/);
  assert.match(read('tests/android/gradle/wrapper/gradle-wrapper.properties'), /^networkTimeout=60000$/m);
  const upload = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7';
  for (const [name, suite, output] of [['e2e', 'simulator', 'ios-simulator'], ['e2e-dev', 'dev', 'ios-dev']] as const) {
    const steps = job(name);
    assert.ok(steps.includes(install), name);
    assert.ok(steps.includes('permissions:\n      contents: read\n      actions: read\n'), name);
    assert.ok(steps.includes(`id: keys\n        run: sh tests/ci/cache.sh keys ${suite}\n`), name);
    // The lookup of a pass, which a run by hand can skip with `retest`.
    assert.ok(steps.includes(`id: passed\n        if: \${{ !inputs.retest }}\n        env:\n          GH_TOKEN: \${{ github.token }}\n          NAME: \${{ steps.keys.outputs.${suite} }}\n        run: sh tests/ci/cache.sh passed "$NAME"\n`), name);
    assert.ok(steps.includes("name: End to end on the simulator\n        if: steps.passed.outputs.found != 'true'\n"), name);
    assert.ok(steps.includes(`RUNTIME: \${{ steps.keys.outputs.runtime }}`), name);
    assert.ok(steps.includes(`OUTPUT: \${{ runner.temp }}/${output}`), name);
    // A pass is recorded only on success, and only a full pass (OUTPUT/passed) leaves a record to upload.
    assert.ok(steps.includes(`id: record\n        if: steps.passed.outputs.found != 'true'\n        run: sh tests/ci/cache.sh record ${suite} "$RUNNER_TEMP/${output}/passed"\n`), name);
    assert.ok(steps.includes(`${upload}\n        if: steps.record.outputs.recorded == 'true'\n        with:\n          name: \${{ steps.keys.outputs.${suite} }}\n          path: \${{ runner.temp }}/passed-${suite}/\n          retention-days: 90\n          if-no-files-found: error`), name);
    for (const [, condition] of steps.matchAll(/\n        if: ([^\n]*)\n        run: sh tests\/ci\/cache\.sh record/g)) assert.doesNotMatch(present(condition), /always|failure|cancelled/, name);
  }
  // The built demo and UI tests, under their inputs, saved once a build is complete; run.sh tests them without
  // building when their key matches.
  const e2e = job('e2e');
  assert.ok(e2e.includes("actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0\n        with:\n          path: .ios-build\n          key: ${{ steps.keys.outputs.products }}\n"));
  assert.ok(e2e.includes('BUILD_KEY: ${{ steps.keys.outputs.products }}'));
  assert.ok(e2e.includes("if: ${{ !cancelled() && steps.built.outputs.complete == 'true' }}\n        uses: actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0\n        with:\n          path: .ios-build\n          key: ${{ steps.keys.outputs.products }}\n"));
  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      retest:\n/);
  const script = read('tests/ios/run.sh');
  assert.match(script, /destination="platform=iOS Simulator,id=\$device,arch=\$arch"/);
  assert.match(read('.gitignore'), /^\.ios-build\/$/m);
});

// TP-CI-3
test('the simulator suites start from one Rust cache, which a workflow of its own fills on main', () => {
  const workflow = read('.github/workflows/ci.yml');
  const fill = read('.github/workflows/rust-cache.yml');
  // One cache for both suites, which read it and never write it: a run for a branch reads that branch's caches and
  // main's, never another branch's, and nothing else on main builds the demo's Rust for the simulator.
  const shared = '          workspaces: examples/demo/src-tauri -> target\n          shared-key: ios-demo\n';
  for (const name of ['e2e', 'e2e-dev']) assert.ok(job(name).includes(`${shared}          save-if: false\n`), name);
  assert.ok(fill.includes(shared));
  assert.doesNotMatch(workflow, /\n {10}key: ios-|cache-on-failure/);
  // The workflow that fills it saves only a build that succeeded: half a build under the key would count as the
  // whole from then on, and nothing would build the rest.
  assert.doesNotMatch(fill, /cache-on-failure|save-if/);
  // The other Rust caches are saved by main alone. A run for a pull request reads main's: when each ref saved its
  // own, the repository went past GitHub's limit and the caches read longest ago were dropped, main's among them.
  const mainOnly = "          save-if: ${{ github.ref == 'refs/heads/main' }}\n";
  for (const name of ['contracts', 'desktop']) assert.ok(job(name).includes(mainOnly), name);

  // It runs when a push to main changes what the key is made of, twice a week (the key names the Rust of the
  // runner's image too, and GitHub drops a cache that nothing read for a week), and by hand. It is no part of CI's
  // own runs, which a release waits for.
  assert.ok(fill.includes("\non:\n  push:\n    branches: [main]\n    paths:\n      - examples/demo/src-tauri/Cargo.toml\n"
    + '      - examples/demo/src-tauri/Cargo.lock\n      - .github/workflows/ci.yml\n      - .github/workflows/rust-cache.yml\n'
    + "  schedule:\n    - cron: '23 4 * * 1,4'\n  workflow_dispatch:\n"));
  assert.ok(fill.includes('\npermissions:\n  contents: read\n'));
  assert.doesNotMatch(workflow, /rust-cache\.yml|rust_cache/);
  // Its tools are CI's: the pinned versions come out of CI's env block by the command of the workflow itself, and
  // each action is one that CI uses, at the same commit.
  const env = present(/^env:\n((?:  .*\n)+)/m.exec(workflow)?.[1]);
  const pinned = Object.fromEntries([...env.matchAll(/^  (\w+): '?([^'\n]+)'?$/gm)].map(([, name, value]) => [present(name), value]));
  assert.deepEqual(Object.keys(pinned), ['TOOLCHAIN', 'XCODEGEN', 'XCODEGEN_SHA256', 'NODE']);
  const pins = present(/name: The tools that CI pins\n        run: \|\n          ([^\n]+) >> "\$GITHUB_ENV"\n/.exec(fill)?.[1]);
  const exported = execFileSync('sh', ['-c', pins], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(exported, Object.entries(pinned).map(([name, value]) => `${name}=${value}`));
  assert.ok(pins.endsWith(` | grep -E '^(${Object.keys(pinned).join('|')})='`), pins);
  // The key of a Rust cache takes in every variable that begins with one of these, so no job names one so: the
  // suites and the workflow that fills their cache compute one key, and so do the runs of the macOS job, whatever
  // changed. And a variable that a step asks for is one that its job or the workflow defines.
  const keyed = /^(CARGO|CC|CFLAGS|CXX|CMAKE|RUST)/;
  const defined = (text: string): readonly string[] => [...text.matchAll(/^ {4}env:\n((?: {6}\w+: .*\n)+)/gm)]
    .flatMap(([, block]) => [...present(block).matchAll(/^ {6}(\w+): /gm)].map(([, name]) => present(name)));
  for (const name of [...defined(workflow), ...defined(fill)]) assert.doesNotMatch(name, keyed, name);
  assert.deepEqual(defined(job('contracts')), ['AREA_RUST', 'AREA_JS', 'AREA_IOS']);
  for (const name of ['contracts', 'e2e', 'e2e-dev', 'android', 'desktop']) {
    const known = new Set([...Object.keys(pinned), ...defined(job(name))]);
    for (const [, asked] of job(name).matchAll(/\benv\.(\w+)/g)) assert.ok(known.has(present(asked)), `${name}: env.${asked}`);
  }
  const actions = [...fill.matchAll(/uses: (\S+@[0-9a-f]{40} # v[\d.]+)\n/g)].map(([, action]) => action);
  assert.equal(actions.length, 3);
  for (const action of actions) assert.ok(workflow.includes(`uses: ${action}\n`), action);
  const install = 'curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 -o "$RUNNER_TEMP/xcodegen.zip" "https://github.com/yonaskolb/XcodeGen/releases/download/$XCODEGEN/xcodegen.zip"\n'
    + '          echo "$XCODEGEN_SHA256  $RUNNER_TEMP/xcodegen.zip" | shasum -a 256 -c -';
  assert.ok(fill.includes(install));
  // The key names the toolchains that are installed, so the pinned Rust is there before the cache is read; and when
  // the cache has the key already, nothing is built.
  const cache = 'Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2.9.3';
  assert.ok(fill.indexOf('rustup toolchain install "$TOOLCHAIN" --profile minimal --target x86_64-apple-ios') < fill.indexOf(cache));
  assert.ok(fill.includes(`${cache}\n        id: rust\n`));
  const later = fill.slice(fill.indexOf(cache)).split('\n      - ').slice(1);
  assert.equal(later.length, 4);
  for (const step of later) assert.ok(step.includes("if: steps.rust.outputs.cache-hit != 'true'\n"), step);
  // It builds the demo as tests/ios/run.sh does for the suite on the built demo, with cargo inside Xcode's build.
  // Tauri's command fails at the archive, after the build, so the Rust library is what tells a build that succeeded.
  assert.ok(fill.includes('          npm run build:demo\n'
    + '          mkdir -p examples/demo/src-tauri/gen/apple/Externals examples/demo/src-tauri/gen/apple/assets\n'
    + '          xcodegen generate --spec examples/demo/src-tauri/gen/apple/project.yml --quiet\n'
    + '          (cd examples/demo && ../../node_modules/.bin/tauri ios build --debug --target x86_64 --ci) || true\n'
    + '          ls -l examples/demo/src-tauri/target/x86_64-apple-ios/debug/libapp_lib.a\n'));
  const script = read('tests/ios/run.sh');
  assert.match(script, /npm run build:demo >\/dev\/null\)\n[^\n]*\n[^\n]*\n\s+mkdir -p "\$apple\/Externals" "\$apple\/assets"\n\s+xcodegen generate --spec "\$apple\/project\.yml" --quiet\n/);
  assert.match(script, /tauri" ios build --debug --target "\$target" --ci\)/);
  assert.match(read('examples/demo/src-tauri/Cargo.toml'), /^\[lib\]\nname = "app_lib"$/m);
});

// TP-E2E-6
test('CI runs the demo of tauri ios dev on the simulator in a job of its own', () => {
  const dev = job('e2e-dev');
  // The job sets the mode, so that the keys name the mode the suite runs in.
  assert.ok(dev.includes("    env:\n      MODE: dev\n    steps:\n"));
  assert.ok(dev.includes("name: End to end on the simulator\n        if: steps.passed.outputs.found != 'true'\n"));
  assert.doesNotMatch(job('e2e'), /\n\s+MODE: /);
  assert.ok(dev.includes('run: exec sh tests/ios/run.sh\n'));
  assert.doesNotMatch(dev, /BUILD_KEY/);
});

// TP-CI-4
test('run.sh tests through the scheme of the project it generates, retries in CI, and leaves the checkout as it was', () => {
  const script = read('tests/ios/run.sh');
  // The tests run through the project's scheme, never through an .xctestrun file, on the products of the build.
  assert.doesNotMatch(script, /-xctestrun/);
  const run = /xcodebuild -project "\$tests" -scheme DemoUITests -destination "\$destination" -derivedDataPath "\$build\/tests" \\\n\s+-resultBundlePath "\$work\/result\.xcresult" test-without-building/;
  assert.match(script, run);
  assert.match(script, /xcodebuild -project "\$tests" -scheme DemoUITests -destination "\$destination" -derivedDataPath "\$build\/tests" \\\n\s+CODE_SIGNING_ALLOWED=NO build-for-testing/);
  // XcodeGen makes the UI tests' project on every run, before the decision to build.
  const generate = script.indexOf('xcodegen generate --spec "$root/tests/ios/DemoUITests/project.yml"');
  assert.ok(generate !== -1 && generate < script.indexOf('if built; then'));
  // A complete build carries BUILD_KEY, and a run with the same key builds nothing.
  assert.match(script, /printf '%s\\n' "\$BUILD_KEY" >"\$stamp"/);
  assert.doesNotMatch(script, /REUSE/);
  // In CI a failed test runs again, up to three times in all; OUTPUT/passed only after a full pass.
  assert.match(script, /if \[ -n "\$\{CI:-\}" \]; then set -- "\$@" -retry-tests-on-failure -test-iterations 3; fi/);
  // A run whose tests could not start, the test runner or the simulator not being there for xcodebuild, starts them
  // once more: no test ran.
  assert.match(script, /grep -q -e 'failed to initialize for UI testing' \\\n\s+-e 'Unable to find a device matching the provided destination specifier' "\$work\/xcodebuild-\$attempt\.log"/);
  assert.match(script, /if \[ "\$status" -eq 0 \] && \[ -z "\$\{ONLY:-\}" \]; then printf '%s' "\$retried" >"\$output\/passed"; fi/);
  // The checkout as it was: tracked files of gen/apple restored, only the run's own files replaced in OUTPUT, the
  // process tree of tauri ios dev stopped. The cleanup runs at every end of the script; tests/ios-run.test.ts ends
  // it with signals (TP-CI-5).
  assert.match(script, /git -C "\$root" ls-files -z -- "\$apple"/);
  assert.doesNotMatch(script, /rm -rf "\$output"/);
  assert.match(script, /kill_tree "\$dev"/);
  assert.match(script, /^trap cleanup EXIT$/m);
});

// TP-CI-4
test('run.sh starts the tests once more when they could not start, and only then', () => {
  // The loop of the script itself, run by sh with an xcodebuild that answers what this test tells it to. As
  // xcodebuild does, it says what it reports of itself on the error stream, and refuses a result bundle that is
  // there already.
  const script = read('tests/ios/run.sh');
  const found = /^attempt=1\nwhile :; do\n[\s\S]*?\ndone\n/m.exec(script);
  assert.ok(found, 'run.sh has the loop that runs the tests');
  const [loop] = found;
  // The loop says that it starts the tests again as the script says every line of its own.
  const report = present(/^report\(\) \{\n[\s\S]*?\n\}$/m.exec(script)?.[0]);
  const harness = `set -eu
work=$1; tests=tests; destination=destination; build=build
${report}
xcodebuild() {
  call=$(($(cat "$work/calls") + 1))
  echo "$call" >"$work/calls"
  [ ! -e "$work/result.xcresult" ] || return 70
  mkdir "$work/result.xcresult"
  cat "$work/answer-$call" >&2
  return "$(cat "$work/status-$call")"
}
set --
${loop}echo "status=$status attempt=$attempt calls=$(cat "$work/calls")"
`;
  /** What xcodebuild answers to one call: what it says, and its exit status. */
  type Answer = readonly [text: string, status: number];
  /** What the loop came to: its exit status, its last attempt, the calls of xcodebuild, and whether it warned. */
  interface Outcome {
    readonly status: number;
    readonly attempt: number;
    readonly calls: number;
    readonly warned: boolean;
  }
  /** What the loop does when xcodebuild gives these answers one after another, each a text and an exit status. */
  const run = (...answers: readonly Answer[]): Outcome => {
    const work = mkdtempSync(join(tmpdir(), 'live-activity-run-'));
    try {
      writeFileSync(join(work, 'calls'), '0\n');
      answers.forEach(([text, status], index) => {
        writeFileSync(join(work, `answer-${index + 1}`), `${text}\n`);
        writeFileSync(join(work, `status-${index + 1}`), `${status}\n`);
      });
      // A loop that starts the tests again without end is stopped here, and fails.
      const output = execFileSync('sh', ['-c', harness, 'sh', work], { encoding: 'utf8', timeout: 10_000 });
      const match = /status=(\d+) attempt=(\d+) calls=(\d+)\n$/.exec(output);
      assert.ok(match, output);
      const [, status, attempt, calls] = match;
      const warned = output.includes('::warning title=UI test runner::the tests could not start; they run once more');
      return { status: Number(status), attempt: Number(attempt), calls: Number(calls), warned };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  };
  const passed: Answer = ['** TEST EXECUTE SUCCEEDED **', 0];
  const failed: Answer = ["Test Case '-[DemoUITests.DemoTests test1BoundStyleShowsOnTheLockScreen]' failed (12.3 seconds).", 65];
  const noDevice: Answer = ['xcodebuild: error: Unable to find a device matching the provided destination specifier:', 70];
  const noRunner: Answer = ['DemoUITests-Runner (1) encountered an error (The test runner failed to initialize for UI testing. '
    + '(Underlying Error: Timed out waiting for AX loaded notification))', 65];
  for (const first of [noDevice, noRunner]) {
    // The tests could not start, so none ran: they start once more, and the second answer is the run's.
    assert.deepEqual(run(first, passed), { status: 0, attempt: 2, calls: 2, warned: true }, first[0]);
    assert.deepEqual(run(first, failed), { status: 65, attempt: 2, calls: 2, warned: true }, first[0]);
    // Once, and not a third time.
    assert.deepEqual(run(first, first, passed), { status: first[1], attempt: 2, calls: 2, warned: true }, first[0]);
    // The same line in a run that passed starts nothing again.
    assert.deepEqual(run([first[0], 0], passed), { status: 0, attempt: 1, calls: 1, warned: false }, first[0]);
  }
  // A test that failed has run: xcodebuild's own retries of a test are the only ones.
  assert.deepEqual(run(failed, passed), { status: 65, attempt: 1, calls: 1, warned: false });
  assert.deepEqual(run(passed), { status: 0, attempt: 1, calls: 1, warned: false });
});

const uiTests = (): string => read('tests/ios/DemoUITests/UITests/DemoTests.swift');
/** A method of DemoTests as it is written, from its declaration to its closing brace. */
const method = (tests: string, declaration: string): string => {
  const escaped = declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const [found] = new RegExp(`^ {4}${escaped} \\{\\n[\\s\\S]*?\\n {4}\\}$`, 'm').exec(tests) ?? [];
  assert.ok(found, `DemoTests has ${declaration}`);
  return found;
};

// TP-CI-6
test("a UI test that failed leaves a screenshot of the screen, under a name that run.sh takes for the run's own", () => {
  const tests = uiTests();
  const tearDown = method(tests, 'override func tearDown()');
  // After a failure and not after a pass: nothing is captured before the check, which goes by the failures counted
  // so far. In tearDown the test's run has not ended, and `hasSucceeded` is false of every test.
  const [before, after] = tearDown.split('guard let run = testRun, run.totalFailureCount > 0 else { return }\n');
  assert.ok(after !== undefined, tearDown);
  assert.doesNotMatch(present(before), /capture\(|screenshot/);
  assert.doesNotMatch(tearDown, /run\.hasSucceeded/);
  // With the test and the time in the name: a test that runs again can fail again.
  assert.match(after, /^\s+capture\("e2e-failed-\\\(test\)-\\\(Self\.clock\.string\(from: Date\(\)\)\)"\)$/m);
  assert.match(tests, /clock\.dateFormat = "HHmmss"/);
  // A screenshot is kept whatever became of its test, and run.sh exports each under the name its test gave it and
  // takes those of an earlier run away by their first letters.
  assert.match(tests, /shot\.name = name\n\s+shot\.lifetime = \.keepAlways/);
  assert.match(read('tests/ios/run.sh'), /^rm -f "\$output"\/e2e-\*\.png /m);
});

// TP-E2E-11
test('every start of an example in the UI tests opens it stopped first, and nothing left is ended through its card', () => {
  const tests = uiTests();
  // What stands before each tap that starts an example of the Layouts tab or a template: the helper that ends on the
  // page what an earlier attempt left. Between the two only the time that the scheduled start is measured from.
  const before = (label: string): readonly string[] => [...tests.matchAll(new RegExp(`^ +(.+)\\n(?: +let asked = Date\\(\\)\\n)? +tap\\("${label}"\\)$`, 'gm'))].map(([, line]) => present(line));
  const layouts = before('Start this example');
  assert.ok(layouts.length >= 9, layouts.join('\n'));
  for (const line of layouts) assert.match(line, /^openStopped\("[^"]+"\)$/);
  assert.deepEqual(before('Start snack delivery'), ['openStoppedTemplate("Snack delivery", endedBy: "Finish delivery")']);
  assert.deepEqual(before('Start a little nap'), ['openStoppedTemplate("Nap timer", endedBy: "Wake up, sleepyhead")']);
  // The helper waits for what the page says of the example when it opens, gives the tap again to a page that said
  // nothing, fails when it still says nothing, and ends there what runs. Both lines are read at one look.
  const opening = method(tests, 'private func openStopped(_ example: String)');
  assert.match(opening, /webText\("\\\(example\) is already on your phone"\)/);
  assert.match(opening, /webText\("\\\(example\): start it to see it on your phone"\)/);
  assert.match(opening, /var runs = says\(left, or: stopped, within: retry\)\n\s+for _ in 0\.\.<2 where runs == nil \{\n\s+tap\(example\)\n\s+runs = says\(left, or: stopped, within: retry\)\n\s+\}/);
  assert.match(opening, /guard let runs else \{ return XCTFail\("the page does not say whether \\\(example\) runs"\) \}\n\s+if runs \{\s*endExample\(\)\s*\}/);
  assert.doesNotMatch(opening, /springboard/);
  assert.match(method(tests, 'private func says(_ running: XCUIElement, or stopped: XCUIElement, within timeout: TimeInterval) -> Bool?'),
    /answer = running\.exists \? true : stopped\.exists \? false : nil\n\s+return answer != nil/);
  // The page says these two lines when an example opens.
  const page = read('examples/demo/src/main.ts');
  assert.match(page, /`\$\{[\w.]+\}: start it to see it on your phone\.` : `\$\{[\w.]+\} is already on your phone\.`/);
  // A template's tab says the same of its activity in its own two lines, which its helper reads; what the page
  // says when the activity has ended is the line the helper waits for.
  const template = method(tests, 'private func openStoppedTemplate(_ tab: String, endedBy end: String)');
  for (const line of ['webText("Welcome back")', 'webText("A fresh little moment")', 'webText("finished")']) assert.ok(template.includes(line), line);
  assert.match(template, /for _ in 0\.\.<3 where runs == nil \{\n\s+tap\(tab\)\n\s+runs = says\(left, or: stopped, within: retry\)\n\s+\}/);
  assert.doesNotMatch(template, /springboard/);
  assert.match(page, /'A fresh little moment, whenever you’re ready\.' : 'Welcome back\. Pick up where you left off\.'/);
  assert.match(page, /'Delivery finished\. [^']*' : 'Nap finished\. [^']*'/);
  // No test ends a leftover through the button of its card, which a card without content does not have. The test
  // where Rust starts the example goes to the page for it before that start, and only after a test of the run has
  // failed: tearDown marks the failure.
  assert.doesNotMatch(tests, /springboard\.buttons\["All done"\]\.firstMatch\n\s+if /);
  assert.match(method(tests, 'private func endLeftoverButtons()'),
    /^\s+guard Self\.failed else \{ return \}\n\s+launch\(\)\n\s+openStopped\("Buttons"\)\n\s+app\.terminate\(\)$/m);
  assert.match(method(tests, 'func test7RustStartsALayoutWhoseButtonReachesRust()'),
    /\{\n\s+endLeftoverButtons\(\)\n[\s\S]*?app\.launchArguments = \["--start-buttons"\]\n\s+app\.launch\(\)/);
  assert.match(method(tests, 'override func tearDown()'), /run\.totalFailureCount > 0 else \{ return \}\n\s+Self\.failed = true\n/);
  // The simulator test of the cleanup ends the app before it launches it again: the page then lists what runs.
  assert.match(method(tests, 'func test12ARetryFindsItsExampleStopped()'),
    /app\.terminate\(\)\n\s+XCTAssertTrue\(app\.wait\(for: \.notRunning, timeout: system\)\)\n\s+launch\(\)\n\s+openStopped\("Buttons"\)\n\s+XCTAssertTrue\(webText\("Buttons has ended"\)/);
});

// TP-E2E-12
test('the UI test of content with a stale time starts its example for the card alone, then anew in the same launch', () => {
  const tests = uiTests();
  const staleness = method(tests, 'func test10ContentPastItsStaleTimeTurnsTheLockScreen()');
  /** The statements of a part of the method, without its comments. */
  const code = (part: string): string => part.replace(/^\s*\/\/.*\n/gm, '');
  // Two starts, each of an example opened stopped (TP-E2E-11), after one launch of the app.
  const parts = staleness.split('        tap("Start this example")\n');
  assert.equal(parts.length, 3, 'two starts');
  const [before, alone, judged] = parts.map(code);
  assert.match(present(before), /\{\n\s+launch\(\)\n\s+openStopped\("Staleness"\)\n$/);
  // The first start is for the card alone. The test waits for the card's title, which the layout draws fresh or
  // stale, answers the system's question, which comes under an app's first card, ends the example on the page and
  // opens it for the second start.
  assert.match(present(alone), new RegExp('^\\s+XCTAssertTrue\\(webText\\("is on its way to your phone"\\)\\.waitForExistence\\(timeout: page\\)\\)\\n'
    + '\\s+let title = springboard\\.staticTexts\\.matching\\(NSPredicate\\(format: "label == %@", "Mochi’s snack tracker"\\)\\)\\n'
    + '\\s+XCTAssertTrue\\(pullLockScreen\\(until: title\\.firstMatch\\)\\)\\n'
    + '\\s+allow\\(\\)\\n\\s+leaveLockScreen\\(\\)\\n\\s+endExample\\(\\)\\n\\s+openStopped\\("Staleness"\\)\\n$'));
  // It keeps no time, so it waits for neither line; and the app is not launched or ended before the second start,
  // by the test or by a helper that it calls there: the system ends the widget extension's process with the app.
  const ends = /launch\(|terminate\(/;
  assert.doesNotMatch(present(alone), /fresh|stale/);
  assert.doesNotMatch(present(alone), ends);
  for (const helper of ['private func web(_ label: String) -> XCUIElement', 'private func webText(_ prefix: String) -> XCUIElement',
    'private func tap(_ label: String)', 'private func allow()', 'private func openLayouts(_ example: String)',
    'private func says(_ running: XCUIElement, or stopped: XCUIElement, within timeout: TimeInterval) -> Bool?',
    'private func openStopped(_ example: String)', 'private func pullLockScreen()',
    'private func pullLockScreen(until element: XCUIElement) -> Bool', 'private func leaveLockScreen()',
    'private func holds(within timeout: TimeInterval, _ condition: () -> Bool) -> Bool', 'private func endExample()']) {
    assert.doesNotMatch(method(tests, helper), ends, helper);
  }
  // What the first start may wait: three pulls of the Lock Screen, each with 30 seconds for the title. The card
  // that came late on a hosted runner had its content 64 seconds after the start, within the second of them.
  const pulls = present(/for attempt in 0\.\.<(\d+) \{/.exec(method(tests, 'private func pullLockScreen(until element: XCUIElement) -> Bool'))?.[1]);
  const each = present(/^ {4}private let system: TimeInterval = (\d+)$/m.exec(tests)?.[1]);
  assert.ok(Number(pulls) >= 3 && Number(each) >= 30, `${pulls} pulls of ${each} s`);
  assert.match(method(tests, 'private func pullLockScreen(until element: XCUIElement) -> Bool'),
    /pullLockScreen\(\)\n\s+if element\.waitForExistence\(timeout: system\) \{ return true \}/);
  // The example has ended, by the page's word, before it is opened for the second start.
  assert.match(method(tests, 'private func endExample()'),
    /\{\n\s+tap\("End this example"\)\n\s+XCTAssertTrue\(webText\("has ended"\)\.waitForExistence\(timeout: page\)\)\n/);
  // The second start is the one the test is about: its fresh line at once, with the title once on the Lock Screen,
  // and no stale line. Nothing stands between the look that finds the line and the checks.
  assert.match(present(judged), new RegExp('^\\s+XCTAssertTrue\\(webText\\("is on its way to your phone"\\)\\.waitForExistence\\(timeout: page\\)\\)\\n'
    + '\\s+let fresh = springboard\\.staticTexts\\["Left the kitchen"\\]\\n'
    + '\\s+let stale = springboard\\.staticTexts\\["Waiting for news of the snack"\\]\\n'
    + '\\s+XCTAssertTrue\\(pullLockScreen\\(until: fresh\\)\\)\\n'
    + '\\s+XCTAssertEqual\\(title\\.count, 1, "[^"\\n]+"\\)\\n'
    + '\\s+XCTAssertFalse\\(stale\\.exists, "[^"\\n]+"\\)\\n'));
  // The title is a node of the example's layout with the value that the test looks for, and under no `ifStale`:
  // the layout has two, on the two lines, and none on the title or on what holds it.
  const layouts = read('examples/demo/src/layouts.ts');
  const [example] = /^const stalenessExample: LayoutExample = \{\n[\s\S]*?\n\};$/m.exec(layouts) ?? [];
  assert.ok(example, 'the Staleness example');
  assert.ok(example.includes("bound('title', { style: 'title' })"), 'the title, fresh or stale');
  assert.ok(example.includes("bound('news', { style: 'status', ifStale: false })"), 'the news, while fresh');
  assert.ok(example.includes("text('Waiting for news of the snack', { style: 'status', ifStale: true })"), 'the stale line');
  assert.equal(example.match(/ifStale:/g)?.length, 2, 'no other node of the layout goes with the stale time');
  assert.ok(example.includes("values: { title: 'Mochi’s snack tracker', news: news[0] }, staleAt: now + freshFor"), 'the values');
  assert.match(layouts, /^const news = \['Left the kitchen', /m);
});

/**
 * True when `path` is one of the files that `pattern` names in the `include` list of a compiler's settings: a `*`
 * stands for a part of one name, and a double star with its slash for any folders. The test below refuses a pattern
 * of another form, and an `exclude` list, which this does not follow.
 */
function included(pattern: string, path: string): boolean {
  const literal = (part: string): string => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const source = pattern.split('**/').map(folders => folders.split('*').map(literal).join('[^/]*')).join('(?:.*/)?');
  return new RegExp(`^${source}$`).test(path);
}

// TP-CI-7
test('no JavaScript is tracked, and the type check covers every TypeScript file but the fixtures that a test compiles', () => {
  assert.deepEqual(git('ls-files', '*.js', '*.mjs', '*.cjs', '*.jsx'), []);

  const scripts = record(member(JSON.parse(read('package.json')), 'scripts'), 'the scripts of package.json');
  const typecheck = text(scripts.typecheck, 'the typecheck script');
  // The package is built first: the tests take their types from what it ships.
  assert.match(typecheck, /^npm run build && /);
  const commands = `${text(scripts.build, 'the build script')} && ${typecheck}`.split(' && ');
  // The settings under tests/jsx are fixtures: tests/jsx.test.ts compiles them, one of them to see it refused.
  const projects = git('ls-files', '*tsconfig*.json').filter(path => !path.startsWith('tests/jsx/'));
  assert.ok(projects.length >= 6, projects.join(' '));
  const patterns = projects.flatMap(project => {
    // A project is named by its settings file, or by the folder of a tsconfig.json.
    const names = [project, ...(project.endsWith('/tsconfig.json') ? [dirname(project)] : [])];
    assert.ok(names.some(name => commands.includes(`tsc -p ${name}`)), `${project} is in neither the build nor the type check`);
    // A change of the settings alone is checked too: it starts the job that runs the type check.
    assert.ok(started(project).includes('js'), `${project} → js`);
    const settings = record(JSON.parse(read(project)), project);
    assert.deepEqual([settings.exclude, settings.files], [undefined, undefined], `${project} lists its files with include alone`);
    return list(settings.include, `the include list of ${project}`).map(pattern => {
      assert.match(text(pattern, 'a pattern'), /^(?:[\w-]+\/)*(?:\*\*\/)?[\w.*-]+\.m?ts$/, `${project}: a pattern of a form that this test follows`);
      return join(dirname(project), text(pattern, 'a pattern'));
    });
  });

  // What a test compiles: the pages of tests/jsx, each named by one of the two settings there, and the declarations
  // that compare a type with a fixture, one of which imports the other.
  const jsx = ['tests/jsx/tsconfig.json', 'tests/jsx/refused.tsconfig.json'].flatMap(settings => {
    assert.ok(read('tests/jsx.test.ts').includes(`['-p', join(fixtures, '${settings.replace('tests/jsx/', '')}')]`), `${settings} is compiled by tests/jsx.test.ts`);
    return list(member(JSON.parse(read(settings)), 'files'), `the files of ${settings}`).map(file => `tests/jsx/${text(file, 'a file')}`);
  });
  assert.match(read('tests/android-contents.test.ts'), /compile\(join\(root, 'tests\/declarations\/members\.check\.ts'\)\)/);
  assert.match(read('tests/declarations/members.check.ts'), /^import type \{[^}]+\} from '\.\/members\.js';$/m);
  const compiled = new Set([...jsx, 'tests/declarations/members.check.ts', 'tests/declarations/members.ts']);

  for (const path of git('ls-files', '*.ts', '*.mts', '*.tsx')) {
    assert.ok(compiled.has(path) || patterns.some(pattern => included(pattern, path)), `${path} is in no project that npm run typecheck checks`);
    assert.ok(started(path).includes('js'), `${path} → js`);
  }
});
