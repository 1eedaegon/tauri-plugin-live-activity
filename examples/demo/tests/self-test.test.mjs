import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLifecycleChecks } from '../src/self-test.ts';

const snapshot = { revision: 0, title: 'Integration test', status: 'Starting', progress: 0.1 };
const record = { id: 'generation-1', activityKey: 'integration:test', schemaVersion: 1, template: 'progress', snapshot, state: 'active', backend: 'activityKit', visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' };
const updated = { ...record, snapshot: { ...snapshot, revision: 1, status: 'Updated', progress: 0.5 } };
const ended = { ...updated, state: 'ended' };
const next = { ...record, id: 'generation-2' };

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
    { method: 'getCapabilities', result: { start: 'supported', platform: 'ios' } },
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
  ];
}

test('runs start/update/end and generation safety checks through the supplied public API', async () => {
  const harness = scripted(passingSteps());
  const report = await runLifecycleChecks(harness.api, 'test');
  assert.equal(report.status, 'passed', JSON.stringify(report));
  assert.equal(report.checks.length, 13);
  assert.equal(report.checks.every(check => check.passed), true);
  assert.equal(harness.consumed(), true);
  assert.deepEqual(harness.calls[2].input.snapshot, snapshot);
  assert.equal(report.visibility, 'unknown');
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
