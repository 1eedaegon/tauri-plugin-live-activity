// The crate's manifest keeps liveactivity to one line; CI's `changes` job starts each job for its paths; the simulator
// jobs key their caches and records on the files they read and pin their tools; run.sh tests through the scheme.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// TP-RUST-5
test('liveactivity is one line of Cargo.toml, brings both engines, and the crate builds no Swift of its own', () => {
  const manifest = read('Cargo.toml');
  // The engines come through liveactivity alone, so the plugin and the interface always build on the same versions.
  const lines = manifest.split('\n').filter(line => /^\s*(liveactivity|activitykit|liveupdate)\s*=/.test(line));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^liveactivity = /);
  assert.doesNotMatch(manifest, /\[dependencies\.(liveactivity|activitykit|liveupdate)\]/);
  assert.doesNotMatch(read('build.rs'), /ios_path/);
  assert.doesNotMatch(manifest, /"\/ios\/|"\/templates\//);
  for (const gone of ['ios', 'templates']) assert.equal(existsSync(new URL(`../${gone}`, import.meta.url)), false, gone);
  assert.match(read('Cargo.lock'), /name = "activitykit"\nversion = "0\.5\.\d+"\nsource = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"/);
});

const root = new URL('..', import.meta.url);

/** The `area` patterns of the changes job, by area, and the pattern of what concerns every job. */
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

/** The paths whose tracked files tests/ci/cache.sh hashes for the simulator suites. */
function inputs() {
  const list = /^inputs="([^"]+)"$/ms.exec(read('tests/ci/cache.sh'))[1];
  return list.split(/\s+/).filter(Boolean);
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

// TP-CI-1
test('the changes job starts each job for its paths, and the ios area is what the simulator suites read', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.deepEqual(Object.keys(areas().found), ['rust', 'js', 'ios', 'android']);
  const starts = {
    rust: ['src/lib.rs', 'src/service.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml',
      'tests/contract.rs', 'examples/demo/src-tauri/src/lib.rs', 'guest-js/types.ts',
      'android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt'],
    js: ['guest-js/index.ts', 'cli/setup.mjs', 'tools/activitykit.mjs', 'tests/api.test.mjs',
      'tests/release/release-guard.test.mjs', 'tests/jsx/elements.tsx', 'tests/declarations/members.ts',
      'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo/src/main.ts',
      'src/android.rs', 'src/files.rs', 'src/lib.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml',
      'tests/android_contents.rs', 'android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt',
      'android/consumer-rules.pro', 'android/build.gradle.kts', 'tests/android/settings.gradle.kts',
      'contracts/request.schema.json'],
    ios: ['src/ios.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml', 'guest-js/types.ts', 'cli/ios.mjs',
      'tools/activitykit.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo/link-activitykit.mjs',
      'tests/ios/run.sh', 'tests/ci/cache.sh'],
    android: ['android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt', 'tests/android/settings.gradle.kts',
      'Cargo.toml', 'Cargo.lock', 'src/android.rs', 'src/bridge.rs', 'src/lib.rs', 'build.rs'],
  };
  const not = {
    rust: ['cli/setup.mjs', 'guest-js/index.ts', 'tests/api.test.mjs', 'tests/ios/run.sh', 'docs/spec.md',
      'android/build.gradle.kts', 'android/src/androidTest/AndroidManifest.xml'],
    js: ['tests/ios/run.sh', 'tests/ci/cache.sh', 'docs/spec.md', 'README.md'],
    ios: ['tests/api.test.mjs', 'tests/contract.rs', 'tests/ci.test.mjs', 'android/build.gradle.kts', 'docs/spec.md', 'README.md'],
    android: ['guest-js/index.ts', 'tests/ios/run.sh', 'tests/api.test.mjs'],
  };
  for (const [area, paths] of Object.entries(starts)) for (const path of paths) assert.ok(started(path).includes(area), `${path} → ${area}`);
  for (const [area, paths] of Object.entries(not)) for (const path of paths) assert.ok(!started(path).includes(area), `${path} ↛ ${area}`);
  assert.deepEqual(started('docs/usage.md'), []);
  for (const path of ['tests/fixtures/requests.json', 'tests/fixtures/android/contents.json', '.github/workflows/ci.yml']) {
    assert.deepEqual(started(path), ['rust', 'js', 'ios', 'android'], path);
  }
  // The ios area names exactly the tracked files that the simulator suites read, as cache.sh hashes them.
  assert.deepEqual(inputs(), ['src', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions', 'guest-js', 'cli', 'tools',
    'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo', 'tests/ios', 'tests/ci']);
  const read_by_the_suites = new Set(git('ls-files', '--', ...inputs()));
  const { found } = areas();
  for (const path of git('ls-files')) assert.equal(found.ios.test(path), read_by_the_suites.has(path), path);
  // The node tests read the Rust and the Kotlin as text: the commands of both sides, the names of the plugin's
  // files, the copy of liveupdate's adapter against the crate that Cargo.lock names, the permissions that setup
  // grants. So every file that starts the Rust or the Android job starts them too.
  for (const path of git('ls-files')) {
    if (found.rust.test(path) || found.android.test(path)) assert.ok(found.js.test(path), `${path} → js`);
  }
  // And the Rust tests read the TypeScript types and the Kotlin, where the error codes of the three languages are
  // one list: what they read starts the Rust jobs.
  const readByRust = [...read('src/types_tests.rs').matchAll(/\b(?:source|raised)\(\s*"([^"]+)"/g)].map(([, path]) => path);
  assert.deepEqual(readByRust, ['guest-js/types.ts', 'android/src/main']);
  const kotlin = git('ls-files', '--', ...readByRust);
  assert.ok(kotlin.length > 5, String(kotlin.length));
  for (const path of kotlin) assert.ok(found.rust.test(path), `${path} → rust`);
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
test('CI caches the Rust builds and the built demo, pins its tools, and skips a suite that passed for the same inputs', () => {
  const workflow = read('.github/workflows/ci.yml');
  const env = /^env:\n((?:  .*\n)+)/m.exec(workflow)[1];
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
  for (const [name, suite, output] of [['e2e', 'simulator', 'ios-simulator'], ['e2e-dev', 'dev', 'ios-dev']]) {
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
    for (const [, condition] of steps.matchAll(/\n        if: ([^\n]*)\n        run: sh tests\/ci\/cache\.sh record/g)) assert.doesNotMatch(condition, /always|failure|cancelled/, name);
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
  const env = /^env:\n((?:  .*\n)+)/m.exec(workflow)[1];
  const pinned = Object.fromEntries([...env.matchAll(/^  (\w+): '?([^'\n]+)'?$/gm)].map(([, name, value]) => [name, value]));
  assert.deepEqual(Object.keys(pinned), ['TOOLCHAIN', 'XCODEGEN', 'XCODEGEN_SHA256', 'NODE']);
  const [, pins] = /name: The tools that CI pins\n        run: \|\n          ([^\n]+) >> "\$GITHUB_ENV"\n/.exec(fill);
  const exported = execFileSync('sh', ['-c', pins], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(exported, Object.entries(pinned).map(([name, value]) => `${name}=${value}`));
  assert.ok(pins.endsWith(` | grep -E '^(${Object.keys(pinned).join('|')})='`), pins);
  // The key of a Rust cache takes in every variable that begins with one of these, so no job names one so: the
  // suites and the workflow that fills their cache compute one key, and so do the runs of the macOS job, whatever
  // changed. And a variable that a step asks for is one that its job or the workflow defines.
  const keyed = /^(CARGO|CC|CFLAGS|CXX|CMAKE|RUST)/;
  const defined = text => [...text.matchAll(/^ {4}env:\n((?: {6}\w+: .*\n)+)/gm)]
    .flatMap(([, block]) => [...block.matchAll(/^ {6}(\w+): /gm)].map(([, name]) => name));
  for (const name of [...defined(workflow), ...defined(fill)]) assert.doesNotMatch(name, keyed, name);
  assert.deepEqual(defined(job('contracts')), ['AREA_RUST', 'AREA_JS', 'AREA_IOS']);
  for (const name of ['contracts', 'e2e', 'e2e-dev', 'android', 'desktop']) {
    const known = new Set([...Object.keys(pinned), ...defined(job(name))]);
    for (const [, asked] of job(name).matchAll(/\benv\.(\w+)/g)) assert.ok(known.has(asked), `${name}: env.${asked}`);
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
  assert.ok(dev.includes('run: sh tests/ios/run.sh\n'));
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
  // process tree of tauri ios dev stopped, and a signal ends the run after the cleanup.
  assert.match(script, /git -C "\$root" ls-files -z -- "\$apple"/);
  assert.doesNotMatch(script, /rm -rf "\$output"/);
  assert.match(script, /kill_tree "\$dev"/);
  assert.match(script, /trap 'cleanup; exit 130' INT/);
  assert.match(script, /trap 'cleanup; exit 143' TERM HUP/);
});
