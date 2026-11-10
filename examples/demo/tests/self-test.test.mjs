import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  ];
}

/** The steps on Android, where a start with a push is a plain one. */
function androidSteps() {
  return passingSteps().slice(0, 21).map((step, index) => index === 0
    ? { ...step, result: { start: 'supported', push: 'unsupported', platform: 'android' } }
    : index === 1 ? { ...step, result: { notifications: 'granted', liveActivities: 'notApplicable' } } : step)
    .concat([
      { method: 'startLayout', result: { ...layoutRecord(0, 'Starting'), id: 'layout-push' } },
      { method: 'pushTokens', result: { activities: [] } },
      { method: 'endLayout', result: { ...layoutRecord(0, 'Starting', 'ended'), id: 'layout-push' } },
    ]);
}

// TP-E2E-4
test('runs start/update/end and generation safety checks through the supplied public API', async () => {
  const harness = scripted(passingSteps());
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.checks.length, 21);
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
