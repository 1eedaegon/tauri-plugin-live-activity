import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRequest } from '../../../tools/validate-request.mjs';
import { runLifecycleChecks } from '../src/self-test.ts';

const snapshot = { revision: 0, title: 'Integration test', status: 'Starting', progress: 0.1 };
const record = { id: 'generation-1', activityKey: 'integration:test', schemaVersion: 1, template: 'progress', snapshot, state: 'active', backend: 'activityKit', visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' };
const updated = { ...record, snapshot: { ...snapshot, revision: 1, status: 'Updated', progress: 0.5 } };
const ended = { ...updated, state: 'ended' };
const next = { ...record, id: 'generation-2' };
const layoutRecord = (revision, status, state = 'active') => ({ id: 'layout-1', activityKey: 'integration-layout:test',
  schemaVersion: 2, snapshot: { revision, values: { status } }, state, backend: 'activityKit', visibility: 'unknown',
  degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' });

function scripted(steps) {
  let position = 0;
  const calls = [];
  const api = new Proxy({}, {
    get(_target, method) {
      return async input => {
        const step = steps[position++];
        calls.push({ method, input });
        assert.equal(method, step?.method, `Unexpected call ${String(method)} at ${position}`);
        if (step.error) throw step.error;
        return step.result;
      };
    },
  });
  return { api, calls, consumed: () => position === steps.length };
}

function passingSteps() {
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
    ...pendingSteps(),
  ];
}

const nodesRecord = (revision, values, state, degradedFeatures) => ({ ...layoutRecord(revision, 'x', state), id: 'layout-nodes',
  activityKey: 'integration-nodes:test', snapshot: { revision, values }, degradedFeatures });

/** The layout with a switch, a link and nodes that follow staleness: a start that leaves `leftOut` out, an update, an end. */
function interactionSteps(leftOut) {
  return [
    { method: 'startLayout', result: nodesRecord(0, { status: 'Starting', muted: false }, 'active', leftOut) },
    { method: 'updateLayout', result: nodesRecord(1, { status: 'Muted', muted: true }, 'active', leftOut) },
    { method: 'endLayout', result: nodesRecord(1, { status: 'Muted', muted: true }, 'ended', leftOut) },
  ];
}

const laterRecord = state => ({ ...layoutRecord(0, 'Starting', state), id: 'layout-later', activityKey: 'integration-later:test' });

/** A scheduled start where the system begins activities by itself: pending, the same start, an update, the list, an end. */
function pendingSteps() {
  return [
    { method: 'startLayout', result: laterRecord('pending') },
    { method: 'startLayout', result: laterRecord('pending') },
    { method: 'updateLayout', error: { code: 'CONFLICT' } },
    { method: 'listLayout', result: [laterRecord('pending')] },
    { method: 'endLayout', result: laterRecord('ended') },
  ];
}

/** A scheduled start where the system starts nothing later. */
const refusedSteps = () => [{ method: 'startLayout', error: { code: 'UNSUPPORTED_FEATURE' } }];

/** The steps on Android, where a start with a push is a plain one. */
function androidSteps() {
  return passingSteps().slice(0, 21).map((step, index) => index === 0
    ? { ...step, result: { start: 'supported', push: 'unsupported', platform: 'android' } }
    : index === 1 ? { ...step, result: { notifications: 'granted', liveActivities: 'notApplicable' } } : step)
    .concat([
      { method: 'startLayout', result: { ...layoutRecord(0, 'Starting'), id: 'layout-push' } },
      { method: 'pushTokens', result: { activities: [] } },
      { method: 'endLayout', result: { ...layoutRecord(0, 'Starting', 'ended'), id: 'layout-push' } },
      // A notification is drawn once: Android names the nodes that follow staleness, and starts nothing later.
      ...interactionSteps(['layout.ifStale']),
      ...refusedSteps(),
    ]);
}

// TP-E2E-4
test('runs start/update/end and generation safety checks through the supplied public API', async () => {
  const harness = scripted(passingSteps());
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.checks.length, 29);
  assert.equal(report.checks.every(check => check.passed), true);
  assert.equal(harness.consumed(), true);
  assert.deepEqual(harness.calls[2].input.snapshot, snapshot);
  assert.equal(report.visibility, 'unknown');
  // The layout API: a start, a jump from revision 0 to 5, a stale 3, an end after a time with final content at 6, a
  // repeated end and a late update.
  const layout = harness.calls.slice(15).map(({ method, input }) => [method, input]);
  assert.equal(layout[0][1].schemaVersion, 2);
  assert.equal(layout[0][1].snapshot.revision, 0);
  assert.deepEqual(layout[1][1], { id: 'layout-1', snapshot: { revision: 5, values: { status: 'Jumped' } } });
  assert.equal(layout[2][1].snapshot.revision, 3);
  assert.equal(layout[3][1].policy.kind, 'after');
  assert.ok(layout[3][1].policy.at > Date.now() - 60_000);
  assert.deepEqual(layout[3][1].snapshot, { revision: 6, values: { status: 'Done' } });
  assert.deepEqual(layout[4][1], { id: 'layout-1', policy: { kind: 'immediate' } });
  assert.equal(layout[5][1].snapshot.revision, 7);
  // A layout with a switch, a link and one line each for fresh and for stale content; an update sets the flag.
  const nodes = harness.calls.slice(23, 26).map(({ input }) => input);
  assert.deepEqual(nodes[0].layout.lockScreen.children.map(node => [node.type, node.ifStale]),
    [['text', false], ['text', true], ['toggle', undefined], ['link', undefined]]);
  assert.deepEqual(validateRequest({ command: 'start_layout', input: nodes[0] }), { valid: true, issues: [] });
  assert.equal(nodes[1].snapshot.values.muted, true);
  assert.deepEqual(nodes[2], { id: 'layout-nodes', policy: { kind: 'immediate' } });
  // A start ten minutes ahead, the same start for another time, an update, the list and the end.
  const later = harness.calls.slice(26).map(({ method, input }) => [method, input]);
  assert.ok(later[0][1].scheduled.at > Date.now() + 500_000);
  assert.deepEqual(validateRequest({ command: 'start_layout', input: later[0][1] }), { valid: true, issues: [] });
  assert.equal(later[1][1].activityKey, later[0][1].activityKey);
  assert.equal(later[1][1].scheduled.at, later[0][1].scheduled.at + 60_000);
  assert.deepEqual(later.slice(2).map(([method]) => method), ['updateLayout', 'listLayout', 'endLayout']);
  assert.deepEqual(later[4][1], { id: 'layout-later', policy: { kind: 'immediate' } });
});

// TP-E2E-4
test('a scheduled start that is refused is one passed check, and a layout that leaves a node out unexpectedly fails', async () => {
  // An iOS before 26: everything as on iOS 26 up to the scheduled start, which the system refuses.
  const older = scripted([...passingSteps().slice(0, -5), ...refusedSteps()]);
  const report = await runLifecycleChecks(older.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.checks.length, 25);
  assert.equal(report.checks.at(-1).name, 'a scheduled start is refused where the system starts nothing later');
  assert.equal(older.consumed(), true);
  // A refusal for another reason is a failure.
  const broken = scripted([...passingSteps().slice(0, -5), { method: 'startLayout', error: { code: 'NATIVE_ERROR', message: 'x' } }]);
  assert.match((await runLifecycleChecks(broken.api, 'test')).error, /Expected UNSUPPORTED_FEATURE/);
  // iOS draws every node: one that it leaves out fails the run, and the activity is ended.
  const lossy = scripted([...passingSteps().slice(0, 23), { method: 'startLayout', result: nodesRecord(0, {}, 'active', ['layout.toggle']) },
    { method: 'endLayout', result: nodesRecord(0, {}, 'ended', []) }]);
  const failed = await runLifecycleChecks(lossy.api, 'test');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /left out \["layout.toggle"\]/);
  assert.deepEqual(lossy.calls.at(-1).input, { id: 'layout-nodes', policy: { kind: 'immediate' } });
  // A scheduled start that is not pending fails, and the activity it began is ended.
  const eager = scripted([...passingSteps().slice(0, -5), { method: 'startLayout', result: laterRecord('active') },
    { method: 'endLayout', result: laterRecord('ended') }]);
  const early = await runLifecycleChecks(eager.api, 'test');
  assert.match(early.error, /The scheduled start is active/);
  assert.deepEqual(eager.calls.at(-1).input, { id: 'layout-later', policy: { kind: 'immediate' } });
});

// TP-E2E-4
test('ends a layout on Android with the default policy, which Android takes, and cleans up a failed layout run', async () => {
  const harness = scripted(androidSteps());
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.deepEqual(harness.calls[18].input.policy, { kind: 'default' });
  // A layout update that accepts a stale revision fails the run, and the layout activity is ended.
  const failing = scripted([
    ...passingSteps().slice(0, 17),
    { method: 'updateLayout', result: layoutRecord(3, 'Old') },
    { method: 'endLayout', result: layoutRecord(4, 'Old', 'ended') },
  ]);
  const failed = await runLifecycleChecks(failing.api, 'test');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /STALE_REVISION/);
  assert.deepEqual(failing.calls.at(-1).input, { id: 'layout-1', policy: { kind: 'immediate' } });
  assert.equal(failing.consumed(), true);
});

test('marks unsupported platforms separately without pretending a native test passed', async () => {
  const harness = scripted([{ method: 'getCapabilities', result: { start: 'unsupported', platform: 'macos' } }]);
  assert.equal((await runLifecycleChecks(harness.api, 'test')).status, 'unsupported');
  assert.equal(harness.consumed(), true);
});

test('accepts a newly posted Android handle while native observation is pending', async () => {
  const steps = passingSteps().map((step, index) => index === 2 || index === 3
    ? { ...step, result: { ...record, state: 'unknown', backend: 'androidNotification' } }
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
  assert.match(report.error, /STALE_REVISION/);
  assert.equal(harness.consumed(), true);
});

test('reports permission denial before attempting to start', async () => {
  const harness = scripted([
    { method: 'getCapabilities', result: { start: 'supported', platform: 'android' } },
    { method: 'checkPermissions', result: { notifications: 'denied', liveActivities: 'notApplicable' } },
  ]);
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'failed');
  assert.match(report.error, /permission/i);
  assert.equal(harness.consumed(), true);
});
