// tests/ios/run.sh in a checkout of its own, with stand-ins on PATH for Xcode's tools, npm, curl and Tauri: what a
// run in dev mode says and leaves when it is stopped from outside while `tauri ios dev` builds, as CI's runner stops
// a cancelled job, when nobody reads what it says any more, and when it ends by itself.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { member, present } from './support.ts';

const script = fileURLToPath(new URL('./ios/run.sh', import.meta.url));
const DEVICE = '0A1B2C3D-0000-4000-8000-000000000001';
const PROJECT = 'examples/demo/src-tauri/gen/apple/project.pbxproj';
// The test that fails in a run whose stand-in for xcodebuild is told so.
const FAILED = 'test2LockScreenButtonReachesRustAndJavaScript';

// `gate <point>` in a stand-in: at a point that the test named, the stand-in waits until the test lets it go, and no
// longer than its folder is there.
const gate = 'gate() {\n'
  + '  case " ${STAND_IN_WAITS:-} " in *" $1 "*) ;; *) return 0 ;; esac\n'
  + '  until [ -e "$STAND_IN_GATES/$1" ] || [ ! -e "$STAND_IN_CALLS" ]; do /bin/sleep 0.05; done\n'
  + '}\n';

/** The tools that run.sh calls before and while `tauri ios dev` builds, each a script of its own on PATH. */
const standIns = {
  // Xcode's simctl: a simulator that is created and boots, and has the demo installed and running only when the
  // test says so and Tauri has said its lines. It records its calls, its creation, boot and shutdown can wait for the
  // test, and it says on the error stream that it deleted the simulator, which tells where in that stream the
  // cleanup was.
  xcrun: gate + 'echo "$*" >> "$STAND_IN_CALLS"\n'
    + 'case "${1:-} ${2:-}" in\n'
    + `  'simctl create') gate create; echo ${DEVICE} ;;\n`
    + "  'simctl boot') gate boot ;;\n"
    + "  'simctl get_app_container') [ -n \"${DEMO_RUNS:-}\" ] && grep -q Compiling \"$OUTPUT/tauri-ios-dev.log\" ;;\n"
    + "  'simctl spawn') case \" $* \" in\n"
    + "    *' log show '*) [ -z \"${LOG_FAILS:-}\" ] || { echo 'log: the archive could not be read' >&2; exit 1; }\n"
    + "      echo \"the simulator's log: $*\" ;;\n"
    + "    *) echo '501 0 UIKitApplication:io.github.eedaegon.liveactivitydemo[0f3a][rb-legacy]' ;;\n"
    + '  esac ;;\n'
    + "  'simctl shutdown') gate shutdown ;;\n"
    + "  'simctl delete') echo 'simulator deleted' >&2 ;;\n"
    + 'esac\n',
  // The page that Tauri's dev server serves.
  curl: 'exit 0\n',
  // XcodeGen rewrites the project next to the spec it is given, which the checkout tracks under gen/apple.
  xcodegen: 'echo rewritten > "$(dirname "$3")/project.pbxproj"\n',
  // The build of the UI tests, which says nothing and can wait for the test, and their run, which says that they
  // passed; unless the test has xcodebuild fail. With TEST_FAILS a test of the run fails: for good, or `once`, as
  // one that passes when CI runs it again. Such a run of the tests takes over a second, and records when it ended.
  xcodebuild: gate + '[ -z "${XCODEBUILD_FAILS:-}" ] || exit 65\n'
    + 'case " $* " in\n'
    + '  *" build-for-testing "*) gate ui-tests ;;\n'
    + '  *" test-without-building "*)\n'
    + `    [ -z "\${TEST_FAILS:-}" ] || echo "Test Case '-[DemoUITests.DemoTests ${FAILED}]' failed (1.000 seconds)."\n`
    + '    [ -z "${TEST_FAILS:-}" ] || { /bin/sleep 1.1; echo "tests ended $(date +%s)" >> "$STAND_IN_CALLS"; }\n'
    + '    case "${TEST_FAILS:-}" in "" | once) echo "** TEST EXECUTE SUCCEEDED **" ;; *) echo "** TEST EXECUTE FAILED **"; exit 65 ;; esac ;;\n'
    + 'esac\n',
  npm: 'exit 0\n',
  // The loop's five seconds, shortened: a minute of waiting passes in about a second. The call is recorded, and so
  // is its end, and the sleep can wait for the test, as one that does not end.
  sleep: gate + 'echo "sleep $*" >> "$STAND_IN_CALLS"\ngate sleep\n/bin/sleep 0.05\necho slept >> "$STAND_IN_CALLS"\n',
  // What a line of progress reads of the Mac. The call is recorded: it tells that the run came to such a line.
  sysctl: 'echo sysctl >> "$STAND_IN_CALLS"\n' + "echo '{ 7.51 6.20 4.03 }'\n",
  memory_pressure: "printf '%s\\n' 'The system has 17179869184 (4194304 pages with a page size of 4096).' ''"
    + " 'System-wide memory free percentage: 9%'\n",
};
// `tauri ios dev`: says what it does on both streams, with one more line when the test has one, then builds for as
// long as the test lets it: until it is stopped, until the test lets it end, or not at all. One that builds until it
// is stopped has a process of its own meanwhile, as Tauri has cargo. `tauri ios build` can wait for the test, then
// ends and has built no app; or, when the test says so, it fails as a build whose Rust did not compile does, and
// leaves in Xcode's folder the app that the build had begun, with no program in it; or it builds the app, program
// and all.
const tauri = gate + 'echo "$$" > "$TAURI_PID"\n'
  + 'echo "tauri $*"\n'
  + 'begun="$HOME/Library/Developer/Xcode/DerivedData/live-activity-demo-standin/Build/Products/debug-iphonesimulator/live-activity-demo.app"\n'
  + '[ "${2:-}" != build ] || [ -z "${DEMO_BUILD_FAILS:-}" ] || { mkdir -p "$begun/PlugIns"; echo "error: could not compile the demo"; echo "** BUILD FAILED **"; exit 1; }\n'
  + '[ "${2:-}" != build ] || [ -z "${DEMO_BUILDS:-}" ] || { mkdir -p "$begun"; echo program > "$begun/live-activity-demo"; echo "** BUILD SUCCEEDED **"; exit 0; }\n'
  + '[ "${2:-}" != build ] || { gate demo; exit 0; }\n'
  + 'ends=; case " ${STAND_IN_WAITS:-} " in *" tauri-ends "*) ends=1 ;; esac\n'
  + '[ -n "${TAURI_ENDS:-}$ends" ] || { /bin/sleep 600 & echo "$!" > "$TAURI_PID.child"; }\n'
  + 'echo "   Compiling live-activity-demo v0.2.0" >&2\n'
  + '[ -z "${TAURI_ADDS:-}" ] || printf \'%s\\n\' "$TAURI_ADDS" >&2\n'
  + '[ -z "${TAURI_ENDS:-}" ] || exit 3\n'
  + '[ -z "$ends" ] || { gate tauri-ends; exit 3; }\n'
  + 'exec /bin/sleep 600\n';

function executable(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
}

/** A folder with a checkout that has run.sh and one tracked file under gen/apple, and with the stand-ins. */
function folder(): string {
  const temp = mkdtempSync(join(tmpdir(), 'live-activity-ios-run-'));
  const root = join(temp, 'checkout');
  for (const path of ['tests/ios/DemoUITests', dirname(PROJECT)]) mkdirSync(join(root, path), { recursive: true });
  for (const path of ['bin', 'home', 'tmp', 'gates']) mkdirSync(join(temp, path));
  copyFileSync(script, join(root, 'tests/ios/run.sh'));
  writeFileSync(join(root, PROJECT), 'tracked\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', PROJECT], { cwd: root });
  for (const [name, body] of Object.entries(standIns)) executable(join(temp, 'bin', name), body);
  executable(join(root, 'node_modules/.bin/tauri'), tauri);
  writeFileSync(join(temp, 'calls'), '');
  return temp;
}

/** Whether the process still runs. One that has ended and waits for its parent to take note of it does not. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return !spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().startsWith('Z');
};

/** Ends a process that the test did not start itself, or with a negative number a group, when it is still there. */
const kill = (target: number): void => {
  try {
    process.kill(target, 'SIGKILL');
  } catch (error) {
    if (member(error, 'code') !== 'ESRCH') throw error;
  }
};

/**
 * Removes the folder of a run that the test has ended. A stand-in that was under way when the run was killed still
 * records its call, and one that does so while the folder goes leaves a file in it: then the folder goes once more.
 */
function remove(temp: string): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rmSync(temp, { recursive: true, force: true });
      return;
    } catch (error) {
      if (member(error, 'code') !== 'ENOTEMPTY' || attempt === 10) throw error;
    }
  }
}

// How long a test waits for what the run does by itself: enough for a Mac that builds something else meanwhile.
const LIMIT = 120_000;
const limit = (what: string): Promise<never> => pause(LIMIT, null, { ref: false }).then(() => assert.fail(`${what}: not in two minutes`));

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < LIMIT; waited += 20) {
    if (condition()) return;
    await pause(20);
  }
  assert.fail(`${what}: not in two minutes`);
}

/** How a process ended: with an exit status, or by a signal. */
interface Ended {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** What `withRun` takes: `env` holds variables for the run, over those that it sets; the rest is as it describes. */
interface RunOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly building?: boolean;
  readonly prepare?: (temp: string) => void;
  readonly waits?: readonly string[];
  readonly terminal?: boolean;
}

/** A run of run.sh that `withRun` started: its process, what it wrote, its folders, and what a test asks of it. */
interface Run {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly written: { out: string; err: string };
  readonly root: string;
  readonly output: string;
  readonly ended: () => Promise<Ended>;
  /** What the `exit` event of the process carried: `once` of node:events gives it no types. */
  readonly exited: () => Promise<{ readonly code: unknown; readonly signal: unknown }>;
  readonly logged: () => string;
  readonly calls: () => readonly string[];
  readonly tree: () => readonly number[];
  readonly work: () => readonly string[];
  readonly release: (point: string) => void;
}

/**
 * Runs `task` with a run of run.sh in dev mode, which has reached Tauri's build unless `building` is false. `prepare`
 * gets the folder before the run starts. `waits` names the points where a stand-in waits until the task calls
 * `release` with that name. With `terminal` the run and all it starts are a process group of their own, which takes
 * a signal as from a terminal's key. HOME and TMPDIR are the folder's own: the cleanup of run.sh removes its work
 * folder and the demo's DerivedData. The shell is the system's, which CI's step runs the script with: bash 3.2 on a
 * Mac, where a newer bash earlier on PATH would hide what that one does, and dash on Linux.
 */
async function withRun(
  { env = {}, building = true, prepare = () => {}, waits = [], terminal = false }: RunOptions, task: (run: Run) => Promise<void>,
): Promise<void> {
  const temp = folder();
  const root = join(temp, 'checkout');
  prepare(temp);
  const child = spawn('/bin/sh', [join(root, 'tests/ios/run.sh')], {
    env: { PATH: `${join(temp, 'bin')}:${process.env.PATH}`, HOME: join(temp, 'home'), TMPDIR: join(temp, 'tmp'),
      MODE: 'dev', OUTPUT: join(temp, 'output'), RUNTIME: 'stand-in.runtime', STAND_IN_CALLS: join(temp, 'calls'),
      TAURI_PID: join(temp, 'tauri.pid'), STAND_IN_WAITS: waits.join(' '), STAND_IN_GATES: join(temp, 'gates'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: terminal,
  });
  const written = { out: '', err: '' };
  child.stdout.on('data', (chunk: Buffer | string) => { written.out += chunk; });
  child.stderr.on('data', (chunk: Buffer | string) => { written.err += chunk; });
  const exited: Promise<readonly unknown[]> = once(child, 'exit');
  const closed = new Promise<Ended>(resolve => { child.on('close', (code, signal) => resolve({ code, signal })); });
  const log = join(temp, 'output/tauri-ios-dev.log');
  const run: Run = {
    child, written, root, output: join(temp, 'output'),
    // How the run ended, once all it wrote is read. One that does not end fails its test, which then ends it.
    ended: () => Promise.race([closed, limit('the end of the run')]),
    // How the run's own process ended, whatever it started that still holds its streams.
    exited: () => Promise.race([exited.then(([code, signal]) => ({ code, signal })), limit('the exit of the run')]),
    logged: () => (existsSync(log) ? readFileSync(log, 'utf8') : ''),
    calls: () => readFileSync(join(temp, 'calls'), 'utf8').split('\n'),
    // The processes of `tauri ios dev`: itself and, when it builds until it is stopped, the one it started.
    tree: () => ['tauri.pid', 'tauri.pid.child'].filter(name => existsSync(join(temp, name))).map(name => Number(readFileSync(join(temp, name), 'utf8'))),
    work: () => readdirSync(join(temp, 'tmp')),
    release: point => writeFileSync(join(temp, 'gates', point), ''),
  };
  try {
    if (building) await until(() => run.logged().includes('Compiling live-activity-demo'), 'the log of tauri ios dev in OUTPUT');
    await task(run);
  } finally {
    if (terminal) kill(-present(child.pid));
    child.kill('SIGKILL');
    await exited;
    for (const pid of run.tree()) kill(pid);
    remove(temp);
  }
}

/**
 * The run's cleanup, whole: the processes of Tauri that `tree` names stopped, the simulator deleted, the tracked file
 * as it was, the work folder gone.
 */
async function cleanedUp(run: Run, tree: readonly number[], what: string): Promise<void> {
  await until(() => !tree.some(alive), `${what}: the end of tauri ios dev and of what it started`);
  assert.ok(run.calls().includes(`simctl delete ${DEVICE}`), what);
  assert.equal(readFileSync(join(run.root, PROJECT), 'utf8'), 'tracked\n', what);
  assert.deepEqual(run.work(), [], what);
}

// TP-CI-5
test('the log of tauri ios dev is in OUTPUT while it builds, with a line of progress a minute, and a killed run leaves it', async () => {
  await withRun({}, async run => {
    // Both streams of Tauri, in the folder that CI's job uploads whatever ended the step.
    assert.match(run.logged(), /^tauri ios dev live-activity-e2e-\d+ --host 127\.0\.0\.1\n {3}Compiling live-activity-demo v0\.2\.0\n$/);
    // The step's log says each minute how long the run has waited, what the Mac has left, and where the build is.
    const progress = /^tauri ios dev, (\d+) s: load 7\.51 6\.20 4\.03, memory free 9%: Compiling live-activity-demo v0\.2\.0$/gm;
    await until(() => [...run.written.out.matchAll(progress)].length >= 2, 'two lines of progress');
    assert.deepEqual([...run.written.out.matchAll(progress)].slice(0, 2).map(([, waited]) => waited), ['60', '120']);
    // The count is five seconds for each look at the simulator, and the run sleeps them out: two minutes are 24
    // looks, and at each look every sleep before it is over.
    let asleep = 0;
    let looks = 0;
    for (const call of run.calls()) {
      if (call === 'sleep 5') asleep += 1;
      if (call === 'slept') asleep -= 1;
      if (!call.startsWith('simctl get_app_container ')) continue;
      looks += 1;
      assert.equal(asleep, 0, 'a look at the simulator while the run sleeps');
    }
    assert.ok(looks >= 24, `${looks} looks at the simulator in two minutes`);
    // Killed, as nothing can prepare for: the log is where it was.
    run.child.kill('SIGKILL');
    assert.deepEqual(await run.ended(), { code: null, signal: 'SIGKILL' });
    assert.match(run.logged(), /Compiling live-activity-demo/);
  });
});

// TP-CI-5
test('the run says which part it begins before each part that takes minutes', async () => {
  const simulator = (mode: string): string => `simulator ${DEVICE} \\(stand-in\\.runtime\\), (arm64|x86_64), ${mode}\n`;
  const says = (run: Run, pattern: RegExp, what: string): Promise<void> => until(() => pattern.test(run.written.out), what);
  // The step's log has the time of each line: a run that is stopped shows where it was, and since when. Each part
  // waits here until the test has read the line that names it, which a line that came after its part would not let
  // it do.
  await withRun({ waits: ['ui-tests', 'boot', 'sleep'], building: false }, async run => {
    await says(run, new RegExp(`^${simulator('dev')}building the UI tests\n$`), 'the line of the UI tests, and no other yet');
    run.release('ui-tests');
    await says(run, /\nbuilding the UI tests\nbooting the simulator\n$/, 'the line of the boot, and no other yet');
    run.release('boot');
    // Tauri builds beside the run, whose wait is held here in its first five seconds: it has said that it waits.
    // Let go, it says how long it has waited.
    await says(run, /\nbooting the simulator\nwaiting for tauri ios dev to build, install, launch and serve the demo\n$/, 'the line of the wait, and no other yet');
    run.release('sleep');
    await says(run, /\nwaiting for tauri ios dev to build, install, launch and serve the demo\ntauri ios dev, 60 s: /, 'a line of progress');
  });
  // Built by `tauri ios build`, the demo comes first. The stand-in builds none: the run says so and ends.
  await withRun({ env: { MODE: 'build' }, waits: ['demo'], building: false }, async run => {
    const begun = new RegExp(`^${simulator('build')}building the demo with tauri ios build\n$`);
    await says(run, begun, "the line of the demo's build, and no other yet");
    run.release('demo');
    assert.deepEqual(await run.ended(), { code: 1, signal: null });
    assert.match(run.written.out, begun);
    assert.ok(run.written.err.includes('the demo did not build for the simulator\n'), run.written.err);
    assert.ok(run.calls().includes(`simctl delete ${DEVICE}`));
    assert.deepEqual(run.work(), []);
  });
});

// TP-CI-5
test('a line of progress leaves the backslashes of the log as they are', async () => {
  // Tauri's log holds what compilers say, backslashes included. A shell's echo reads them: `\c` ends the line there
  // and takes the rest, `\n` begins a second line, which here would be a command to the workflow.
  const last = String.raw`warning: \c is no escape in C:\new\target\n::error::no command of the workflow`;
  await withRun({ env: { TAURI_ADDS: last } }, async run => {
    await until(() => run.written.out.includes('tauri ios dev, 120 s: '), 'two lines of progress');
    assert.ok(run.written.out.includes(`\ntauri ios dev, 60 s: load 7.51 6.20 4.03, memory free 9%: ${last}\ntauri ios dev, 120 s: `), run.written.out);
  });
});

// TP-CI-5
test('a run that a signal stops names the signal, cleans up as a run that ends does, and leaves the log', async () => {
  for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 143]] as const) {
    await withRun({}, async run => {
      const tree = run.tree();
      assert.equal(tree.length, 2, signal);
      assert.equal(readFileSync(join(run.root, PROJECT), 'utf8'), 'rewritten\n');
      run.child.kill(signal);
      assert.deepEqual(await run.ended(), { code: status, signal: null }, signal);
      // The name comes first: CI's runner does not wait for the cleanup.
      const named = run.written.err.indexOf(`tests/ios/run.sh: stopped by ${signal}\n`);
      assert.ok(named !== -1 && named < run.written.err.indexOf('simulator deleted\n'), `${signal}: ${run.written.err}`);
      await cleanedUp(run, tree, signal);
      assert.match(run.logged(), /Compiling live-activity-demo/, signal);
    });
  }
});

// TP-CI-5
test('a signal that comes while the run sleeps between two looks at Tauri stops it at once', async () => {
  // CI's runner kills the step ten seconds after its first signal, and a shell handles a signal only when the
  // command that it waits for has ended: five of the ten seconds could pass in the loop's sleep. Here that sleep does
  // not end at all, and the run is stopped all the same.
  await withRun({ waits: ['sleep'] }, async run => {
    const tree = run.tree();
    await until(() => run.calls().includes('sleep 5'), 'the sleep between two looks');
    run.child.kill('SIGTERM');
    assert.deepEqual(await run.exited(), { code: 143, signal: null });
    // The sleep that still waits holds the run's streams: it goes, and what the run said can be read.
    run.release('sleep');
    await run.ended();
    assert.ok(run.written.err.includes('tests/ios/run.sh: stopped by SIGTERM\n'), run.written.err);
    await cleanedUp(run, tree, 'during the sleep');
  });
});

// TP-CI-5
test('a second signal does not cut the cleanup short', async () => {
  // CI's runner sends INT and, to a step that is still there some seconds later, TERM: here while the cleanup waits
  // for the simulator to shut down.
  await withRun({ waits: ['shutdown'] }, async run => {
    const tree = run.tree();
    run.child.kill('SIGINT');
    await until(() => run.calls().includes(`simctl shutdown ${DEVICE}`), 'the cleanup at the simulator');
    run.child.kill('SIGTERM');
    run.release('shutdown');
    assert.deepEqual(await run.ended(), { code: 130, signal: null });
    assert.ok(!run.written.err.includes('SIGTERM'), run.written.err);
    await cleanedUp(run, tree, 'after TERM');
  });
});

// TP-CI-5
test('a cleanup that waits for a command that hangs goes on when the terminal interrupts that command', async () => {
  // A terminal's Ctrl-C goes to the run and to all it started. The first stops the run, whose cleanup then waits for
  // a simulator that does not shut down; the second ends that wait, and the cleanup goes on.
  await withRun({ waits: ['shutdown'], terminal: true }, async run => {
    const tree = run.tree();
    process.kill(-present(run.child.pid), 'SIGINT');
    await until(() => run.calls().includes(`simctl shutdown ${DEVICE}`), 'the cleanup at the simulator');
    process.kill(-present(run.child.pid), 'SIGINT');
    assert.deepEqual(await run.ended(), { code: 130, signal: null });
    await cleanedUp(run, tree, 'after the second Ctrl-C');
  });
});

// TP-CI-5
test('a run that is stopped when nobody reads what it says still cleans up', async () => {
  for (const stream of ['stderr', 'stdout'] as const) {
    await withRun({}, async run => {
      const tree = run.tree();
      // The reader is gone, as behind a step that CI's runner has given up, and the run goes on: its lines of
      // progress have nowhere to go, and neither has the name of the signal.
      run.child[stream].destroy();
      await once(run.child[stream], 'close');
      const lines = (): number => run.calls().filter(call => call === 'sysctl').length;
      const before = lines();
      await until(() => lines() >= before + 2, `${stream}: two more lines of progress`);
      run.child.kill('SIGTERM');
      assert.deepEqual(await run.ended(), { code: 143, signal: null }, stream);
      await cleanedUp(run, tree, stream);
    });
  }
});

// TP-CI-5
test('a run that nobody reads from its start goes its way, and cleans up when it is stopped', async () => {
  // As when what the run says is piped to a command that has ended: no line of its own ends the run, from the
  // simulator's name on, and with a key for its products.
  await withRun({ env: { BUILD_KEY: 'a-key' }, waits: ['create'], building: false }, async run => {
    run.child.stdout.destroy();
    await once(run.child.stdout, 'close');
    run.release('create');
    await until(() => run.logged().includes('Compiling live-activity-demo'), 'the log of tauri ios dev in OUTPUT');
    const tree = run.tree();
    await until(() => run.calls().filter(call => call === 'sysctl').length >= 2, 'two lines of progress');
    run.child.kill('SIGTERM');
    assert.deepEqual(await run.ended(), { code: 143, signal: null });
    assert.ok(run.written.err.includes('tests/ios/run.sh: stopped by SIGTERM\n'), run.written.err);
    await cleanedUp(run, tree, 'nobody reads');
  });
});

// TP-CI-5
test('a run whose tauri ios dev ends says so, and its log is in OUTPUT', async () => {
  await withRun({ env: { TAURI_ENDS: '1' }, building: false }, async run => {
    assert.deepEqual(await run.ended(), { code: 1, signal: null });
    assert.ok(run.written.err.includes('tauri ios dev ended\n'), run.written.err);
    assert.match(run.logged(), /^tauri ios dev live-activity-e2e-\d+ --host 127\.0\.0\.1\n {3}Compiling live-activity-demo v0\.2\.0\n$/);
    assert.ok(run.calls().includes(`simctl delete ${DEVICE}`));
    assert.deepEqual(run.work(), []);
  });
});

// TP-CI-5
test('a run that stops by itself when nobody reads why still cleans up', async () => {
  await withRun({ waits: ['tauri-ends'] }, async run => {
    const tree = run.tree();
    run.child.stderr.destroy();
    await once(run.child.stderr, 'close');
    // Tauri ends, and the run has nobody to tell.
    run.release('tauri-ends');
    assert.deepEqual(await run.ended(), { code: 1, signal: null });
    await cleanedUp(run, tree, 'after tauri ios dev ended');
  });
});

// TP-CI-5
test('the log in OUTPUT belongs to the run: one that ends before Tauri starts leaves none of an earlier run', async () => {
  const earlier = (temp: string): void => {
    mkdirSync(join(temp, 'output'));
    writeFileSync(join(temp, 'output/tauri-ios-dev.log'), 'an earlier run\n');
    writeFileSync(join(temp, 'output/e2e-earlier.png'), 'a screenshot');
  };
  await withRun({ env: { XCODEBUILD_FAILS: '1' }, building: false, prepare: earlier }, async run => {
    assert.deepEqual(await run.ended(), { code: 65, signal: null });
    assert.deepEqual(readdirSync(run.output), ['e2e-earlier.png']);
    assert.deepEqual(run.work(), []);
  });
});

// TP-CI-5
test('a run that ends by itself has the log of tauri ios dev among its own files in OUTPUT', async () => {
  const earlier = (temp: string): void => {
    mkdirSync(join(temp, 'output'));
    for (const name of ['tauri-ios-dev.log', 'e2e-earlier.png', 'passed', 'notes.txt']) writeFileSync(join(temp, 'output', name), 'an earlier run\n');
  };
  await withRun({ env: { DEMO_RUNS: '1' }, building: false, prepare: earlier }, async run => {
    assert.deepEqual(await run.ended(), { code: 0, signal: null }, run.written.err);
    // Its own files are replaced, the log by the one that Tauri wrote from its start; what is not the run's stays.
    assert.deepEqual(readdirSync(run.output).sort(), ['notes.txt', 'passed', 'tauri-ios-dev.log', 'xcodebuild.log']);
    assert.match(run.logged(), /^tauri ios dev live-activity-e2e-\d+ --host 127\.0\.0\.1\n {3}Compiling live-activity-demo v0\.2\.0\n$/);
    assert.equal(readFileSync(join(run.output, 'passed'), 'utf8'), '');
    assert.equal(readFileSync(join(run.output, 'xcodebuild.log'), 'utf8'), '** TEST EXECUTE SUCCEEDED **\n');
    await cleanedUp(run, run.tree(), 'after the tests');
  });
});

// TP-CI-6
test('a demo whose build failed ends the run there, with the end of what the build said, though it left an app begun', async () => {
  await withRun({ env: { MODE: 'build', DEMO_BUILD_FAILS: '1' }, building: false }, async run => {
    assert.deepEqual(await run.ended(), { code: 1, signal: null });
    // What Tauri said last, then the run's own line: a hosted runner keeps no other copy of the build's log.
    assert.match(run.written.out, /building the demo with tauri ios build\n\*\* BUILD FAILED \*\*\n$/);
    assert.match(run.written.err, /error: could not compile the demo\n\*\* BUILD FAILED \*\*\nthe demo did not build for the simulator\n/);
    // No UI tests built for it and no simulator booted: the app that the build had begun has no program to install.
    assert.doesNotMatch(run.written.out, /building the UI tests|booting the simulator/);
    assert.ok(!run.calls().some(call => call.startsWith('simctl boot ')), run.calls().join('\n'));
    assert.ok(run.calls().includes(`simctl delete ${DEVICE}`));
    assert.deepEqual(run.work(), []);
  });
});

// TP-CI-6
test('a demo that built, with its program in the app, is installed and its tests run', async () => {
  await withRun({ env: { MODE: 'build', DEMO_BUILDS: '1' }, building: false }, async run => {
    assert.deepEqual(await run.ended(), { code: 0, signal: null }, run.written.err);
    assert.match(run.written.out, /building the demo with tauri ios build\n\*\* BUILD SUCCEEDED \*\*\nbuilding the UI tests\nbooting the simulator\n/);
    // The app that the run installs is its own copy of the one that the build left.
    const installed = run.calls().find(call => call.startsWith(`simctl install ${DEVICE} `));
    assert.match(installed ?? '', /\/build\/demo\/live-activity-demo\.app$/);
    assert.deepEqual(readdirSync(run.output).sort(), ['passed', 'xcodebuild.log']);
    await cleanedUp(run, run.tree(), 'after the tests of a demo that built');
  });
});

// What the run asks of the simulator's log, as the stand-in for xcrun records each call: since when, and which lines.
const DEMO_LINES = 'process == "live-activity-demo"';
const ACTIVITY_LINES = 'process == "LiveActivityWidget" OR process == "chronod" OR process == "liveactivitiesd"'
  + ' OR subsystem BEGINSWITH "com.apple.activitykit"';
const asked = (run: Run): readonly (readonly string[] | undefined)[] => run.calls().filter(call => call.includes(' log show '))
  .map(call => new RegExp(`^simctl spawn ${DEVICE} log show --start @(\\d+) --style compact --predicate (.+)$`).exec(call)?.slice(1));

// TP-CI-6
test('a run with a failed test leaves what the demo and the system logged of its Live Activities since the tests began', async () => {
  const before = Math.floor(Date.now() / 1000);
  await withRun({ env: { DEMO_RUNS: '1', TEST_FAILS: '1' }, building: false }, async run => {
    assert.deepEqual(await run.ended(), { code: 65, signal: null }, run.written.err);
    // Two readings of the simulator's log, of the demo's process and of what draws and keeps its Live Activities, both
    // from the moment the tests began: a suite takes longer than any fixed number of minutes would cover.
    const readings = asked(run);
    assert.deepEqual(readings.map(reading => reading?.[1]), [DEMO_LINES, ACTIVITY_LINES], run.calls().join('\n'));
    const [[began], [again]] = [present(readings[0]), present(readings[1])] as const;
    assert.equal(again, began);
    const [, ended] = /^tests ended (\d+)$/m.exec(run.calls().join('\n')) ?? [];
    assert.ok(Number(began) < Number(ended), `the log is read from ${began}, and the tests ended at ${ended}`);
    assert.ok(before <= Number(began) && Number(began) <= Math.floor(Date.now() / 1000), `the tests began at ${began}`);
    // Read before the simulator goes, and each in a file of OUTPUT, where CI's job uploads them.
    const calls = run.calls();
    assert.ok(calls.findLastIndex(call => call.includes(' log show ')) < calls.indexOf(`simctl delete ${DEVICE}`));
    assert.deepEqual(readdirSync(run.output).sort(), ['activities.log', 'app.log', 'tauri-ios-dev.log', 'xcodebuild.log']);
    assert.equal(readFileSync(join(run.output, 'app.log'), 'utf8'), `the simulator's log: ${calls.find(call => call.endsWith(DEMO_LINES))}\n`);
    assert.equal(readFileSync(join(run.output, 'activities.log'), 'utf8'), `the simulator's log: ${calls.find(call => call.endsWith(ACTIVITY_LINES))}\n`);
    await cleanedUp(run, run.tree(), 'after a test that failed');
  });
  // The extension's process has the name that the demo's project gives its widget target.
  const project = readFileSync(fileURLToPath(new URL('../examples/demo/src-tauri/gen/apple/project.yml', import.meta.url)), 'utf8');
  assert.match(project, /^\s+PRODUCT_BUNDLE_IDENTIFIER: io\.github\.eedaegon\.liveactivitydemo\.widget$/m);
  assert.match(project, /^\s+PRODUCT_NAME: LiveActivityWidget$/m);
});

// TP-CI-6
test("the logs of a failure are kept when the test passed on a retry, and are the run's own files in OUTPUT", async () => {
  // A test that failed once and passed when it ran again: the run passes, and what was logged is kept all the same.
  await withRun({ env: { DEMO_RUNS: '1', TEST_FAILS: 'once' }, building: false }, async run => {
    assert.deepEqual(await run.ended(), { code: 0, signal: null }, run.written.err);
    assert.deepEqual(asked(run).map(reading => reading?.[1]), [DEMO_LINES, ACTIVITY_LINES]);
    assert.deepEqual(readdirSync(run.output).sort(), ['activities.log', 'app.log', 'passed', 'tauri-ios-dev.log', 'xcodebuild.log']);
    assert.equal(readFileSync(join(run.output, 'passed'), 'utf8'), `DemoTests/${FAILED}`);
    assert.ok(run.written.out.includes(`::warning title=Retried UI test::DemoTests/${FAILED} failed once and passed on a retry\n`), run.written.out);
  });
  // A run in which no test failed reads no log, and takes away those that an earlier run left.
  const earlier = (temp: string): void => {
    mkdirSync(join(temp, 'output'));
    for (const name of ['app.log', 'activities.log', 'notes.txt']) writeFileSync(join(temp, 'output', name), 'an earlier run\n');
  };
  await withRun({ env: { DEMO_RUNS: '1' }, building: false, prepare: earlier }, async run => {
    assert.deepEqual(await run.ended(), { code: 0, signal: null }, run.written.err);
    assert.deepEqual(asked(run), []);
    assert.deepEqual(readdirSync(run.output).sort(), ['notes.txt', 'passed', 'tauri-ios-dev.log', 'xcodebuild.log']);
  });
});

// TP-CI-6
test('a log that cannot be read changes nothing of how the run ends, and its file says what the tool said', async () => {
  await withRun({ env: { DEMO_RUNS: '1', TEST_FAILS: '1', LOG_FAILS: '1' }, building: false }, async run => {
    assert.deepEqual(await run.ended(), { code: 65, signal: null }, run.written.err);
    assert.deepEqual(asked(run).map(reading => reading?.[1]), [DEMO_LINES, ACTIVITY_LINES]);
    assert.deepEqual(readdirSync(run.output).sort(), ['activities.log', 'app.log', 'tauri-ios-dev.log', 'xcodebuild.log']);
    for (const name of ['app.log', 'activities.log']) assert.equal(readFileSync(join(run.output, name), 'utf8'), 'log: the archive could not be read\n', name);
    assert.match(readFileSync(join(run.output, 'xcodebuild.log'), 'utf8'), /\*\* TEST EXECUTE FAILED \*\*\n$/);
    await cleanedUp(run, run.tree(), 'after a log that could not be read');
  });
});

// TP-CI-5
test('ending a process tree takes no word of a line that the shell could not write for a process', async () => {
  // macOS's sh (bash 3.2) keeps a line that it could not write and hands it to its next command substitution, or to
  // a shell that it starts, which writes it on its way out. kill_tree as run.sh has it, with such a line kept whose
  // first word is the shell itself: the tree it ends is the one it was given, and the script goes on. The line is
  // kept while the closed pipe is ignored. Then the pipe is as in run.sh again, where a write to it ends the writer.
  const killTree = present(/^kill_tree\(\) \{\n[\s\S]*?\n\}$/m.exec(readFileSync(script, 'utf8'))?.[0]);
  const temp = mkdtempSync(join(tmpdir(), 'live-activity-kill-tree-'));
  const lines = ['set -eu', killTree, "trap '' PIPE", '/bin/sleep 600 &', 'target=$!', 'echo "$target" > "$1/target"', 'read -r go',
    'echo "$$ is no child of $target" || true', 'trap - PIPE', 'kill_tree "$target"', 'echo ended > "$1/ended"'];
  const child = spawn('/bin/sh', ['-c', `${lines.join('\n')}\n`, 'sh', temp], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited: Promise<readonly unknown[]> = once(child, 'exit');
  const target = (): number => Number(readFileSync(join(temp, 'target'), 'utf8'));
  try {
    await until(() => existsSync(join(temp, 'target')) && target() > 0, 'the process to end');
    child.stdout.destroy();
    await once(child.stdout, 'close');
    child.stdin.write('go\n');
    assert.deepEqual((await Promise.race([exited, limit('the end of kill_tree')])).slice(0, 2), [0, null]);
    assert.ok(existsSync(join(temp, 'ended')));
    await until(() => !alive(target()), 'the end of the process');
  } finally {
    child.kill('SIGKILL');
    await exited;
    if (existsSync(join(temp, 'target'))) kill(target());
    rmSync(temp, { recursive: true, force: true });
  }
});
