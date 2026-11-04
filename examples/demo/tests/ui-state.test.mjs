import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permissionAction, permissionFeedback, selectCurrent } from '../src/ui-state.ts';
import { startMochiActivity, advanceMochiActivity, snackStage, countdown, selectMochiActivity } from '../src/mochi.ts';

test('uses the iOS Live Activity settings check instead of notification permission', () => {
  assert.deepEqual(permissionAction('ios'), { kind: 'liveActivities', label: 'Check Live Activity settings' });
  assert.deepEqual(permissionAction('android'), { kind: 'notifications', label: 'Request notification permission' });
});

test('uncertain or promptable permission invites another explicit attempt', () => {
  assert.match(permissionFeedback('unknown'), /try.*again/);
  assert.match(permissionFeedback('prompt'), /try.*again/);
});

test('permission feedback distinguishes settings controls from granted access', () => {
  assert.match(permissionFeedback('settingsRequired'), /Settings/);
  assert.match(permissionFeedback('denied'), /Settings/);
  assert.match(permissionFeedback('granted'), /All set/);
  assert.match(permissionFeedback('notApplicable'), /No permission/);
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

test('snack starts with a small preparation step and explicit fallback', () => {
  const input = startMochiActivity('snack', 1_700_000_000_000, 5);
  assert.equal(input.activityKey, 'mochi:snack:1700000000000');
  assert.equal(input.template, 'progress');
  assert.equal(input.fallback, 'notification');
  assert.equal(input.snapshot.title, 'Mochi’s snack delivery');
  assert.equal(input.snapshot.progress, 0.15);
  assert.equal(input.snapshot.revision, 0);
});

test('snack updates increase revisions without mutating the previous snapshot', () => {
  const input = startMochiActivity('snack', 10, 5);
  const current = Object.freeze({ ...input, id: 'snack', snapshot: Object.freeze(input.snapshot) });
  const next = advanceMochiActivity(current);
  assert.equal(next.progress, 0.65);
  assert.equal(next.revision, 1);
  assert.equal(current.snapshot.progress, 0.15);
  const delivered = advanceMochiActivity({ ...current, snapshot: next });
  assert.equal(delivered.progress, 1);
  assert.equal(delivered.revision, 2);
  assert.equal(snackStage(delivered.progress), 2);
});

test('a nap uses absolute timestamps and snoozing preserves its start time', () => {
  const input = startMochiActivity('nap', 1_700_000_000_000, 5);
  assert.equal(input.template, 'timer');
  assert.deepEqual(input.snapshot.timer, { startedAt: 1_700_000_000_000, endsAt: 1_700_000_300_000 });
  const next = advanceMochiActivity({ ...input, id: 'nap' });
  assert.equal(next.timer.startedAt, input.snapshot.timer.startedAt);
  assert.equal(next.timer.endsAt, input.snapshot.timer.endsAt + 60_000);
  assert.equal(next.revision, 1);
});

test('countdown is derived from the clock, clamps at zero and does not send updates', () => {
  assert.equal(countdown(61_000, 0), '01:01');
  assert.equal(countdown(300_000, 0), '05:00');
  assert.equal(countdown(500, 0), '00:01');
  assert.equal(countdown(0, 1), '00:00');
});

test('scenario recovery isolates snack and nap records and retains pending ownership', () => {
  const snack = { id: 'snack', activityKey: 'mochi:snack:1', state: 'active' };
  const nap = { id: 'nap', activityKey: 'mochi:nap:2', state: 'unknown' };
  const unrelated = { id: 'other', activityKey: 'integration:3', state: 'active' };
  assert.equal(selectMochiActivity([snack, nap, unrelated], 'snack')?.id, 'snack');
  assert.equal(selectMochiActivity([snack, nap, unrelated], 'nap')?.id, 'nap');
  assert.equal(selectMochiActivity([{ ...snack, state: 'ended' }], 'snack'), undefined);
  assert.equal(selectMochiActivity([unrelated], 'snack'), undefined);
});

test('invalid nap durations are rejected before constructing a native request', () => {
  for (const minutes of [0, -1, Number.NaN, 0.5, 120]) {
    assert.throws(() => startMochiActivity('nap', 100, minutes));
  }
});
