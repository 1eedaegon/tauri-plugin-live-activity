import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import * as activity from '../dist-js/index.js';

globalThis.window = {};
afterEach(() => clearMocks());

const snapshot = Object.freeze({ revision: 0, title: 'Delivery', status: 'Preparing', progress: 0.1 });
const input = Object.freeze({ activityKey: 'delivery:42', schemaVersion: 1, template: 'progress', fallback: 'notification', snapshot });
const record = Object.freeze({ id: 'opaque-native-handle', activityKey: input.activityKey, schemaVersion: 1, template: 'progress', snapshot, backend: 'activityKit', state: 'active', visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' });

for (const [name, command, args, expectedPayload, result] of [
  ['getCapabilities', 'get_capabilities', [], {}, { platform: 'ios', backend: 'activityKit', start: 'supported' }],
  ['checkPermissions', 'check_permissions', [], {}, { notifications: 'notApplicable', liveActivities: 'granted', promotion: 'notApplicable' }],
  ['requestPermissions', 'request_permissions', ['notifications'], { kind: 'notifications' }, { notifications: 'granted' }],
  ['start', 'start', [input], { input }, record],
  ['update', 'update', [{ id: record.id, snapshot: { ...snapshot, revision: 1, progress: 0.5 } }], { input: { id: record.id, snapshot: { ...snapshot, revision: 1, progress: 0.5 } } }, { ...record, snapshot: { ...snapshot, revision: 1, progress: 0.5 } }],
  ['end', 'end', [{ id: record.id, policy: { kind: 'immediate' } }], { input: { id: record.id, policy: { kind: 'immediate' } } }, { ...record, state: 'ended' }],
  ['list', 'list', [], {}, [record]],
]) {
  test(`${name} invokes the namespaced command with its public arguments`, async () => {
    const calls = [];
    mockIPC((nativeCommand, payload) => {
      calls.push({ nativeCommand, payload });
      return result;
    });
    assert.deepEqual(await activity[name](...args), result);
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: expectedPayload }]);
  });
}

test('keeps the complete timer snapshot and caller-owned input unchanged', async () => {
  const timer = Object.freeze({ startedAt: 1_700_000_000_000, endsAt: 1_700_000_060_000 });
  const timerSnapshot = Object.freeze({ revision: 2, title: 'Timer', status: 'Running', timer, staleAt: timer.endsAt });
  const request = Object.freeze({ ...input, template: 'timer', snapshot: timerSnapshot });
  const serialized = JSON.stringify(request);
  mockIPC((_command, payload) => {
    assert.deepEqual(payload, { input: request });
    return { ...record, template: 'timer', snapshot: timerSnapshot };
  });
  const actual = await activity.start(request);
  assert.deepEqual(actual.snapshot, timerSnapshot);
  assert.equal(JSON.stringify(request), serialized);
});

for (const code of ['PERMISSION_DENIED', 'UNSUPPORTED_PLATFORM', 'STALE_REVISION', 'CONFLICT', 'NOT_FOUND']) {
  test(`preserves the native ${code} error instead of reporting success`, async () => {
    const expected = { code, message: 'Operation could not be completed.' };
    mockIPC(() => Promise.reject(expected));
    await assert.rejects(activity.start(input), error => {
      assert.deepEqual(error, expected);
      return true;
    });
  });
}

test('preserves unknown visibility and unknown promotion without inventing delivery', async () => {
  const unknownRecord = { ...record, backend: 'androidNotification', state: 'unknown', promotionRequested: true, promotionState: 'unknown' };
  mockIPC(() => [unknownRecord]);
  assert.deepEqual(await activity.list(), [unknownRecord]);
});
