import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permissionAction, selectCurrent } from '../src/ui-state.ts';

test('uses the iOS Live Activity settings check instead of notification permission', () => {
  assert.deepEqual(permissionAction('ios'), { kind: 'liveActivities', label: 'Check Live Activity settings' });
  assert.deepEqual(permissionAction('android'), { kind: 'notifications', label: 'Request notification permission' });
});

test('preserves the current handle while Android observation is pending', () => {
  const previous = { id: 'current', state: 'active' };
  const observed = { id: 'current', state: 'unknown' };
  assert.deepEqual(selectCurrent([observed], previous), observed);
});

test('releases terminal handles and selects another observed active activity', () => {
  const previous = { id: 'current', state: 'active' };
  const active = { id: 'other', state: 'active' };
  assert.deepEqual(selectCurrent([{ id: 'current', state: 'ended' }, active], previous), active);
  assert.equal(selectCurrent([{ id: 'current', state: 'dismissed' }], previous), undefined);
  assert.equal(selectCurrent([], previous), undefined);
});

test('does not select an unrelated unknown record as an observed active activity', () => {
  assert.equal(selectCurrent([{ id: 'unrelated', state: 'unknown' }], undefined), undefined);
});
