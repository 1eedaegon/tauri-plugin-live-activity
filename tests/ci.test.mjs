// The crate's manifest keeps activitykit to one line; CI's `changes` job starts each job for its paths; the simulator
// jobs key their caches and records on the files they read and pin their tools; run.sh tests through the scheme.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    rust: ['src/lib.rs', 'src/apple/glue.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml',
      'tests/contract.rs', 'examples/demo/src-tauri/src/lib.rs'],
    js: ['guest-js/index.ts', 'cli/setup.mjs', 'tools/sync-contract.mjs', 'tests/api.test.mjs',
      'tests/release/release-guard.test.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo/src/main.ts'],
    ios: ['src/ios.rs', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions/default.toml', 'guest-js/types.ts', 'cli/ios.mjs',
      'tools/sync-contract.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo/link-activitykit.mjs',
      'tests/ios/run.sh', 'tests/ci/cache.sh'],
    android: ['android/src/main/java/io/github/eedaegon/liveactivity/Lifecycle.kt', 'tests/android/settings.gradle.kts',
      'Cargo.toml', 'Cargo.lock', 'src/android.rs', 'src/android_liveupdate.rs', 'src/lib.rs', 'build.rs'],
  };
  const not = {
    rust: ['cli/setup.mjs', 'guest-js/index.ts', 'tests/api.test.mjs', 'tests/ios/run.sh', 'docs/spec.md'],
    js: ['src/lib.rs', 'tests/contract.rs', 'tests/ios/run.sh', 'tests/ci/cache.sh', 'android/build.gradle.kts'],
    ios: ['tests/api.test.mjs', 'tests/contract.rs', 'tests/ci.test.mjs', 'android/build.gradle.kts', 'docs/spec.md', 'README.md'],
    android: ['guest-js/index.ts', 'tests/ios/run.sh', 'tests/api.test.mjs'],
  };
  for (const [area, paths] of Object.entries(starts)) for (const path of paths) assert.ok(started(path).includes(area), `${path} → ${area}`);
  for (const [area, paths] of Object.entries(not)) for (const path of paths) assert.ok(!started(path).includes(area), `${path} ↛ ${area}`);
  assert.deepEqual(started('docs/usage.md'), []);
  for (const path of ['tests/fixtures/layout-requests.json', 'contracts/request.schema.json', '.github/workflows/ci.yml']) {
    assert.deepEqual(started(path), ['rust', 'js', 'ios', 'android'], path);
  }
  // The ios area names exactly the tracked files that the simulator suites read, as cache.sh hashes them.
  assert.deepEqual(inputs(), ['src', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'permissions', 'guest-js', 'cli', 'tools',
    'package.json', 'package-lock.json', 'tsconfig.json', 'examples/demo', 'tests/ios', 'tests/ci']);
  const read_by_the_suites = new Set(git('ls-files', '--', ...inputs()));
  const { found } = areas();
  for (const path of git('ls-files')) assert.equal(found.ios.test(path), read_by_the_suites.has(path), path);
  assert.match(workflow, /if: needs\.changes\.outputs\.rust == 'true' \|\| needs\.changes\.outputs\.js == 'true' \|\| needs\.changes\.outputs\.ios == 'true'\n\s+runs-on: macos-/);
  assert.match(workflow, /\n  e2e:\n    name: Demo on the iOS Simulator\n    needs: changes\n    if: needs\.changes\.outputs\.ios == 'true'\n    runs-on: macos-/);
  assert.match(workflow, /\n  e2e-dev:\n    name: Demo in tauri ios dev on the iOS Simulator\n    needs: changes\n    if: needs\.changes\.outputs\.ios == 'true'\n    runs-on: macos-/);
  // The demo's Rust embeds its page (frontendDist), so the macOS job builds the page before the demo's Rust tests,
  // also when only the Rust changed.
  const contracts = job('contracts');
  assert.ok(contracts.includes("if: env.JS == 'true' || env.RUST == 'true'\n        run: npm ci\n"), 'npm ci');
  assert.ok(contracts.includes("if: env.RUST == 'true'\n        run: npm run build:demo && cargo test --locked --manifest-path examples/demo/src-tauri/Cargo.toml\n"), 'demo');
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
  assert.match(job('contracts'), /taiki-e\/install-action@cfdb7ed4ccc7c7dce37759eae89dc5674b469b39 # v2\.90\.3\n\s+if: env\.RUST == 'true'\n\s+with:\n\s+tool: cargo-llvm-cov@0\.9\.1/);
  assert.doesNotMatch(workflow, /cargo install cargo-llvm-cov/);
  // src/android.rs is compiled only for Android: the android job checks it, since nothing else builds it.
  assert.match(job('android'), /rustup toolchain install "\$TOOLCHAIN" --profile minimal --component clippy --target aarch64-linux-android[\s\S]*?- run: cargo clippy --locked --target aarch64-linux-android --lib -- -D warnings\n/);
  assert.match(job('android'), /gradle\/actions\/setup-gradle@8da46b539cd8fe6ab27ca75128919a18d757604c # v6\.4\.1\n[\s\S]*?- name: Fetch Gradle\n\s+working-directory: tests\/android\n\s+run: for attempt in 1 2 3; do \.\/gradlew --version --no-daemon[^\n]*\n\s+- run: \.\/gradlew /);
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
  assert.match(script, /if \[ "\$status" -eq 0 \] && \[ -z "\$\{ONLY:-\}" \]; then printf '%s' "\$retried" >"\$output\/passed"; fi/);
  // The checkout as it was: tracked files of gen/apple restored, only the run's own files replaced in OUTPUT, the
  // process tree of tauri ios dev stopped, and a signal ends the run after the cleanup.
  assert.match(script, /git -C "\$root" ls-files -z -- "\$apple"/);
  assert.doesNotMatch(script, /rm -rf "\$output"/);
  assert.match(script, /kill_tree "\$dev"/);
  assert.match(script, /trap 'cleanup; exit 130' INT/);
  assert.match(script, /trap 'cleanup; exit 143' TERM HUP/);
});
