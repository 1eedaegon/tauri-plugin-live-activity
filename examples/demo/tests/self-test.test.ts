import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ActivityRecord, ActivityState, Capabilities, LayoutActivityRecord, LayoutValues, LiveActivityError, Permissions,
  ProgressSnapshot,
} from '../../../guest-js/index.js';
import { list, member, number, present, record as jsonObject, unchecked } from '../../../tests/support.ts';
import { keep } from '../../../tests/typescript-requests.ts';
import type { KeptRequest } from '../../../tests/typescript-requests.ts';
import { runLifecycleChecks } from '../src/self-test.ts';

/** The API as the lifecycle test takes it. */
type API = Parameters<typeof runLifecycleChecks>[0];

/** A function of the API that the lifecycle test calls, by its name. */
type Method = 'getCapabilities' | 'checkPermissions' | 'start' | 'update' | 'end' | 'list'
  | 'startLayout' | 'updateLayout' | 'endLayout' | 'listLayout' | 'pushTokens';

/**
 * What the fake answers a call of `Name` with: what the API answers; of the capabilities and of the permissions, only
 * the members that the lifecycle test reads.
 */
type AnswerOf<Name extends Method> = Name extends 'getCapabilities' ? Partial<Capabilities>
  : Name extends 'checkPermissions' ? Partial<Permissions>
  : Awaited<ReturnType<API[Name]>>;

/** What the fake throws: the plugin's error, with its code and, where a test gives one, its message. */
type Refusal = Pick<LiveActivityError, 'code'> & Partial<LiveActivityError>;

/**
 * A call that a script expects, and what the fake does then: it answers `result`, which is an answer of that
 * function, or throws `error`.
 */
type Step = { readonly [Name in Method]: { readonly method: Name; readonly result?: AnswerOf<Name>; readonly error?: Refusal } }[Method];

/** A call that the fake got: the name it was called by, and the request it was handed, which is none for a read. */
interface Call {
  readonly method: string | symbol;
  readonly input: unknown;
}

/** A fake of the API that follows a script, with the calls it got and whether the script is used up. */
interface Harness {
  readonly api: API;
  readonly calls: readonly Call[];
  readonly consumed: () => boolean;
}

const snapshot: ProgressSnapshot = { revision: 0, title: 'Integration test', status: 'Starting', progress: 0.1 };
const record: ActivityRecord = { id: 'generation-1', activityKey: 'integration:test', schemaVersion: 1, template: 'progress', snapshot, state: 'active', backend: 'activityKit', visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' };
const updated: ActivityRecord = { ...record, snapshot: { ...snapshot, revision: 1, status: 'Updated', progress: 0.5 } };
const ended: ActivityRecord = { ...updated, state: 'ended' };
const next: ActivityRecord = { ...record, id: 'generation-2' };
const layoutRecord = (revision: number, status: string, state: ActivityState = 'active'): LayoutActivityRecord => ({ id: 'layout-1', activityKey: 'integration-layout:test',
  schemaVersion: 2, snapshot: { revision, values: { status } }, state, backend: 'activityKit', visibility: 'unknown',
  degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' });

function scripted(steps: readonly Step[]): Harness {
  let position = 0;
  const calls: Call[] = [];
  // The compiler would refuse the fake as the API: it has no member of its own, and answers any name from the script.
  const api = unchecked<API>(new Proxy({}, {
    get(_target, method) {
      return async (input: unknown) => {
        const step = steps[position++];
        calls.push({ method, input });
        assert.equal(method, step?.method, `Unexpected call ${String(method)} at ${position}`);
        if (step?.error) throw step.error;
        return step?.result;
      };
    },
  }));
  return { api, calls, consumed: () => position === steps.length };
}

function passingSteps(): Step[] {
  return [
    { method: 'getCapabilities', result: { start: 'supported', push: 'supported', platform: 'ios' } },
    { method: 'checkPermissions', result: { liveActivities: 'granted', notifications: 'notApplicable' } },
    { method: 'start', result: record },
    { method: 'start', result: record },
    { method: 'update', result: updated },
    { method: 'update', result: updated },
    { method: 'update', error: { code: 'STALE_REVISION' } },
    { method: 'update', error: { code: 'CONFLICT' } },
    { method: 'list', result: [updated] },
    { method: 'end', result: ended },
    { method: 'end', result: ended },
    { method: 'update', error: { code: 'NOT_FOUND' } },
    { method: 'start', result: next },
    { method: 'update', error: { code: 'NOT_FOUND' } },
    { method: 'end', result: { ...next, state: 'ended' } },
    { method: 'startLayout', result: layoutRecord(0, 'Starting') },
    { method: 'updateLayout', result: layoutRecord(5, 'Jumped') },
    { method: 'updateLayout', error: { code: 'STALE_REVISION' } },
    { method: 'endLayout', result: layoutRecord(6, 'Done', 'ended') },
    { method: 'endLayout', result: layoutRecord(6, 'Done', 'ended') },
    { method: 'updateLayout', error: { code: 'NOT_FOUND' } },
    // The push check: iOS refuses a token without the capability and holds no token.
    { method: 'startLayout', error: { code: 'CONFIGURATION_REQUIRED' } },
    { method: 'pushTokens', result: { activities: [] } },
    ...interactionSteps([]),
    ...smallSteps([]),
    ...pendingSteps(),
  ];
}

const nodesRecord = (
  revision: number, values: LayoutValues, state: ActivityState, degradedFeatures: readonly string[],
): LayoutActivityRecord => ({ ...layoutRecord(revision, 'x', state), id: 'layout-nodes',
  activityKey: 'integration-nodes:test', snapshot: { revision, values }, degradedFeatures });

/** The layout with a switch, a link and nodes that follow staleness: a start that leaves `leftOut` out, an update, an end. */
function interactionSteps(leftOut: readonly string[]): Step[] {
  return [
    { method: 'startLayout', result: nodesRecord(0, { status: 'Starting', muted: false }, 'active', leftOut) },
    { method: 'updateLayout', result: nodesRecord(1, { status: 'Muted', muted: true }, 'active', leftOut) },
    { method: 'endLayout', result: nodesRecord(1, { status: 'Muted', muted: true }, 'ended', leftOut) },
  ];
}

const smallRecord = (state: ActivityState, degradedFeatures: readonly string[]): LayoutActivityRecord => ({ ...layoutRecord(0, 'Starting', state), id: 'layout-small',
  activityKey: 'integration-small:test', degradedFeatures });

/** The layout with a region for a watch and a car: a start that leaves `leftOut` out, and an end. */
function smallSteps(leftOut: readonly string[]): Step[] {
  return [
    { method: 'startLayout', result: smallRecord('active', leftOut) },
    { method: 'endLayout', result: smallRecord('ended', leftOut) },
  ];
}

const laterRecord = (state: ActivityState): LayoutActivityRecord => ({ ...layoutRecord(0, 'Starting', state), id: 'layout-later', activityKey: 'integration-later:test' });

/** A scheduled start where the system begins activities by itself: pending, the same start, an update, the list, an end. */
function pendingSteps(): Step[] {
  return [
    { method: 'startLayout', result: laterRecord('pending') },
    { method: 'startLayout', result: laterRecord('pending') },
    { method: 'updateLayout', error: { code: 'CONFLICT' } },
    { method: 'listLayout', result: [laterRecord('pending')] },
    { method: 'endLayout', result: laterRecord('ended') },
  ];
}

/** A scheduled start where the system starts nothing later. */
const refusedSteps = (): Step[] => [{ method: 'startLayout', error: { code: 'UNSUPPORTED_FEATURE' } }];

/** The steps on Android, where a start with a push is a plain one. */
function androidSteps(): Step[] {
  return passingSteps().slice(0, 21).map((step, index): Step => index === 0
    ? { method: 'getCapabilities', result: { start: 'supported', push: 'unsupported', platform: 'android' } }
    : index === 1 ? { method: 'checkPermissions', result: { notifications: 'granted', liveActivities: 'notApplicable' } } : step)
    .concat([
      { method: 'startLayout', result: { ...layoutRecord(0, 'Starting'), id: 'layout-push' } },
      { method: 'pushTokens', result: { activities: [] } },
      { method: 'endLayout', result: { ...layoutRecord(0, 'Starting', 'ended'), id: 'layout-push' } },
      // A notification is drawn once: Android names the nodes that follow staleness, and starts nothing later.
      ...interactionSteps(['layout.ifStale']),
      // A notification has no place for the small region either.
      ...smallSteps(['nativeLiveActivity', 'layout.small']),
      ...refusedSteps(),
    ]);
}

// TP-E2E-4
test('runs start/update/end and generation safety checks through the supplied public API', async () => {
  const harness = scripted(passingSteps());
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.checks.length, 31);
  assert.equal(report.checks.every(check => check.passed), true);
  assert.equal(harness.consumed(), true);
  assert.deepEqual(member(harness.calls[2]?.input, 'snapshot'), snapshot);
  assert.equal(report.visibility, 'unknown');
  // The layout API: a start, a jump from revision 0 to 5, a stale 3, an end after a time with final content at 6, a
  // repeated end and a late update.
  const layout = harness.calls.slice(15).map(({ method, input }) => [method, input]);
  assert.equal(member(layout[0]?.[1], 'schemaVersion'), 2);
  assert.equal(member(layout[0]?.[1], 'snapshot', 'revision'), 0);
  assert.deepEqual(layout[1]?.[1], { id: 'layout-1', snapshot: { revision: 5, values: { status: 'Jumped' } } });
  assert.equal(member(layout[2]?.[1], 'snapshot', 'revision'), 3);
  assert.equal(member(layout[3]?.[1], 'policy', 'kind'), 'after');
  assert.ok(number(member(layout[3]?.[1], 'policy', 'at')) > Date.now() - 60_000);
  assert.deepEqual(member(layout[3]?.[1], 'snapshot'), { revision: 6, values: { status: 'Done' } });
  assert.deepEqual(layout[4]?.[1], { id: 'layout-1', policy: { kind: 'immediate' } });
  assert.equal(member(layout[5]?.[1], 'snapshot', 'revision'), 7);
  // A layout with a switch, a link and one line each for fresh and for stale content; an update sets the flag.
  const nodes = harness.calls.slice(23, 26).map(({ input }) => input);
  assert.deepEqual(list(member(nodes[0], 'layout', 'lockScreen', 'children')).map(node => [member(node, 'type'), member(node, 'ifStale')]),
    [['text', false], ['text', true], ['toggle', undefined], ['link', undefined]]);
  assert.equal(member(nodes[1], 'snapshot', 'values', 'muted'), true);
  assert.deepEqual(nodes[2], { id: 'layout-nodes', policy: { kind: 'immediate' } });
  // A layout with a region for a watch and a car, a row of a symbol and a text, which the record does not name:
  // the widget extension draws it.
  const small = harness.calls.slice(26, 28).map(({ input }) => input);
  assert.deepEqual(list(member(small[0], 'layout', 'small', 'children')).map(node => member(node, 'type')), ['symbol', 'text']);
  assert.equal(jsonObject(member(small[0], 'layout')).island, undefined);
  assert.deepEqual(small[1], { id: 'layout-small', policy: { kind: 'immediate' } });
  assert.deepEqual(report.checks.slice(24, 26).map(check => check.name), [
    'a layout with a small region starts, and the widget extension draws the region',
    'the layout with a small region ends',
  ]);
  // A start ten minutes ahead, the same start for another time, an update, the list and the end.
  const later = harness.calls.slice(28).map(({ method, input }) => [method, input]);
  assert.ok(number(member(later[0]?.[1], 'scheduled', 'at')) > Date.now() + 500_000);
  assert.equal(jsonObject(later[1]?.[1]).activityKey, jsonObject(later[0]?.[1]).activityKey);
  assert.equal(member(later[1]?.[1], 'scheduled', 'at'), number(member(later[0]?.[1], 'scheduled', 'at')) + 60_000);
  assert.deepEqual(later.slice(2).map(([method]) => method), ['updateLayout', 'listLayout', 'endLayout']);
  assert.deepEqual(later[4]?.[1], { id: 'layout-later', policy: { kind: 'immediate' } });
});

// TP-E2E-4
test('a scheduled start that is refused is one passed check, and a layout that leaves a node out unexpectedly fails', async () => {
  // An iOS before 26: everything as on iOS 26 up to the scheduled start, which the system refuses.
  const older = scripted([...passingSteps().slice(0, -5), ...refusedSteps()]);
  const report = await runLifecycleChecks(older.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.checks.length, 27);
  assert.equal(report.checks.at(-1)?.name, 'a scheduled start is refused where the system starts nothing later');
  assert.equal(older.consumed(), true);
  // A refusal for another reason is a failure.
  const broken = scripted([...passingSteps().slice(0, -5), { method: 'startLayout', error: { code: 'NATIVE_ERROR', message: 'x' } }]);
  assert.match(present((await runLifecycleChecks(broken.api, 'test')).error), /Expected UNSUPPORTED_FEATURE/);
  // iOS draws every node: one that it leaves out fails the run, and the activity is ended.
  const lossy = scripted([...passingSteps().slice(0, 23), { method: 'startLayout', result: nodesRecord(0, {}, 'active', ['layout.toggle']) },
    { method: 'endLayout', result: nodesRecord(0, {}, 'ended', []) }]);
  const failed = await runLifecycleChecks(lossy.api, 'test');
  assert.equal(failed.status, 'failed');
  assert.match(present(failed.error), /left out \["layout.toggle"\]/);
  assert.deepEqual(lossy.calls.at(-1)?.input, { id: 'layout-nodes', policy: { kind: 'immediate' } });
  // The small region. An iOS whose widget extension does not draw the small family, and one before iOS 18, name
  // it: the run passes, and the check says so.
  const named = scripted([...passingSteps().slice(0, 26), ...smallSteps(['layout.small']), ...pendingSteps()]);
  const told = await runLifecycleChecks(named.api, 'test');
  assert.equal(told.status, 'passed', JSON.stringify(told));
  assert.equal(told.checks[24]?.name, 'a layout with a small region starts, and its record names the region that is not drawn');
  // What iOS leaves out beside it fails the run, and the activity is ended.
  const lacking = scripted([...passingSteps().slice(0, 26), { method: 'startLayout', result: smallRecord('active', ['layout.symbol']) },
    { method: 'endLayout', result: smallRecord('ended', []) }]);
  const lacked = await runLifecycleChecks(lacking.api, 'test');
  assert.equal(lacked.status, 'failed');
  assert.match(present(lacked.error), /left out \["layout.symbol"\]/);
  assert.deepEqual(lacking.calls.at(-1)?.input, { id: 'layout-small', policy: { kind: 'immediate' } });
  assert.equal(lacking.consumed(), true);
  // A scheduled start that is not pending fails, and the activity it began is ended.
  const eager = scripted([...passingSteps().slice(0, -5), { method: 'startLayout', result: laterRecord('active') },
    { method: 'endLayout', result: laterRecord('ended') }]);
  const early = await runLifecycleChecks(eager.api, 'test');
  assert.match(present(early.error), /The scheduled start is active/);
  assert.deepEqual(eager.calls.at(-1)?.input, { id: 'layout-later', policy: { kind: 'immediate' } });
});

// TP-E2E-4
test('ends a layout on Android with the default policy, which Android takes, and cleans up a failed layout run', async () => {
  const harness = scripted(androidSteps());
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.deepEqual(member(harness.calls[18]?.input, 'policy'), { kind: 'default' });
  // Android draws nothing of the small region and names it; a record that does not would fail the run.
  assert.ok(report.checks.some(check => check.name === 'a layout with a small region starts, and its record names the region that is not drawn'));
  const silent = scripted([...androidSteps().slice(0, -3), { method: 'startLayout', result: smallRecord('active', ['nativeLiveActivity']) },
    { method: 'endLayout', result: smallRecord('ended', []) }]);
  assert.match(present((await runLifecycleChecks(silent.api, 'test')).error), /left out \["nativeLiveActivity"\]/);
  // A layout update that accepts a stale revision fails the run, and the layout activity is ended.
  const failing = scripted([
    ...passingSteps().slice(0, 17),
    { method: 'updateLayout', result: layoutRecord(3, 'Old') },
    { method: 'endLayout', result: layoutRecord(4, 'Old', 'ended') },
  ]);
  const failed = await runLifecycleChecks(failing.api, 'test');
  assert.equal(failed.status, 'failed');
  assert.match(present(failed.error), /STALE_REVISION/);
  assert.deepEqual(failing.calls.at(-1)?.input, { id: 'layout-1', policy: { kind: 'immediate' } });
  assert.equal(failing.consumed(), true);
});

/** The command that each function of the API invokes with a request, by the name that the fake was called by. */
const COMMANDS: Readonly<Record<string | symbol, string>> = {
  start: 'start', update: 'update', end: 'end', startLayout: 'start_layout', updateLayout: 'update_layout', endLayout: 'end_layout',
};

// TP-CONTRACT-9
test('every request of the lifecycle test, on iOS and on Android, is kept for Rust to judge', async (t) => {
  // The run reads the clock for the times it asks for: an end after a time, and a scheduled start.
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  // A request that was sent before, after the same start, is kept once, under the name of its first sending.
  const cases = new Map<string, KeptRequest>();
  for (const [platform, steps] of [['iOS', passingSteps()], ['Android', androidSteps()]] as const) {
    const harness = scripted(steps);
    const report = await runLifecycleChecks(harness.api, 'test');
    assert.equal(report.status, 'passed', JSON.stringify(report));
    // The id that a layout start of this run answered, with the name of that start: Rust judges what follows a
    // start against it.
    const started = new Map<unknown, string>();
    harness.calls.forEach(({ method, input }, index) => {
      // A read sends no request.
      if (input === undefined) return;
      const after = started.get(member(input, 'id'));
      const request = JSON.stringify([method, input, after]);
      const kept = cases.get(request) ?? { name: `on ${platform}, call ${index + 1}: ${String(method)}`, command: present(COMMANDS[method]), input, after };
      cases.set(request, kept);
      const answered = member(present(steps[index]).result, 'id');
      if (method === 'startLayout' && answered !== undefined && !started.has(answered)) started.set(answered, kept.name);
    });
  }
  const kept = [...cases.values()];
  // Every update and end of a layout follows a start of the run, the end with final content among them.
  for (const { name, command, after } of kept) assert.equal(after !== undefined, ['update_layout', 'end_layout'].includes(command), name);
  keep(t, 'demo-self-test', kept);
});

test('marks unsupported platforms separately without pretending a native test passed', async () => {
  const harness = scripted([{ method: 'getCapabilities', result: { start: 'unsupported', platform: 'macos' } }]);
  assert.equal((await runLifecycleChecks(harness.api, 'test')).status, 'unsupported');
  assert.equal(harness.consumed(), true);
});

test('accepts a newly posted Android handle while native observation is pending', async () => {
  const steps = passingSteps().map((step, index): Step => index === 2 || index === 3
    ? { method: 'start', result: { ...record, state: 'unknown', backend: 'androidNotification' } }
    : step);
  const harness = scripted(steps);
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.visibility, 'unknown');
  assert.equal(harness.consumed(), true);
});

test('fails when stale revisions are accepted and still ends the created activity', async () => {
  const steps = passingSteps().slice(0, 7);
  const harness = scripted([
    ...steps.slice(0, 6),
    { method: 'update', result: record },
    { method: 'end', result: ended },
  ]);
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'failed');
  assert.match(present(report.error), /STALE_REVISION/);
  assert.equal(harness.consumed(), true);
});

test('reports permission denial before attempting to start', async () => {
  const harness = scripted([
    { method: 'getCapabilities', result: { start: 'supported', platform: 'android' } },
    { method: 'checkPermissions', result: { notifications: 'denied', liveActivities: 'notApplicable' } },
  ]);
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'failed');
  assert.match(present(report.error), /permission/i);
  assert.equal(harness.consumed(), true);
});
