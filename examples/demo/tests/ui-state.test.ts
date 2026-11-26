import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityRecord, Snapshot, UpdateInput } from '../../../guest-js/index.js';
import { present } from '../../../tests/support.ts';
import { keep } from '../../../tests/typescript-requests.ts';
import {
  exactAlarmFeedback, offersExactAlarms, offersPromotionSettings, permissionAction, permissionFeedback, promotionFeedback,
  selectCurrent,
} from '../src/ui-state.ts';
import { startMochiActivity, advanceMochiActivity, snackStage, countdown, selectMochiActivity } from '../src/mochi.ts';

/** Of a record, the members that the page reads when it selects one. */
type Listed = Pick<ActivityRecord, 'id' | 'state'>;
/** The same of one of Mochi's activities, which the page tells by their keys. */
type ListedByKey = Pick<ActivityRecord, 'id' | 'activityKey' | 'state'>;

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

test('the setting for exact alarms is offered where a start can be scheduled and would not begin at its time', () => {
  const android = (scheduledStart: boolean, exactStart: boolean) => ({ androidPresentation: { scheduledStart, exactStart } });
  assert.equal(offersExactAlarms(android(true, false)), true);
  // Allowed already, or no scheduled start at all: nothing to offer.
  assert.equal(offersExactAlarms(android(true, true)), false);
  assert.equal(offersExactAlarms(android(false, false)), false);
  // iOS and desktop say nothing of Android's presentation: iOS begins a scheduled start itself.
  assert.equal(offersExactAlarms({}), false);
  assert.match(exactAlarmFeedback(true), /on the minute/);
  assert.match(exactAlarmFeedback(false), /still off/);
});

test("Android's screen of Live Updates is offered only where they are turned off", () => {
  // Android has no dialog for them: the plugin reads a promotion that is off as `settingsRequired`.
  assert.equal(offersPromotionSettings({ promotion: 'settingsRequired' }), true);
  // Allowed, unknown, not Android 16, or a state that the plugin does not report for it: nothing to offer.
  for (const promotion of ['granted', 'prompt', 'unknown', 'notApplicable', 'denied'] as const) {
    assert.equal(offersPromotionSettings({ promotion }), false, promotion);
  }
  assert.match(promotionFeedback(), /refresh/i);
});

test('preserves the current handle while Android observation is pending', () => {
  const previous: Listed = { id: 'current', state: 'active' };
  const observed: Listed = { id: 'current', state: 'unknown' };
  assert.deepEqual(selectCurrent([observed], previous), observed);
});

test('releases terminal handles and selects another observed active activity', () => {
  const previous: Listed = { id: 'current', state: 'active' };
  const active: Listed = { id: 'other', state: 'active' };
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
  // The update reads the snapshot alone. The compiler takes an object with a member more by a name, not in place.
  const current = { ...input, id: 'nap' };
  const next = advanceMochiActivity(current);
  assert.equal(next.timer?.startedAt, input.snapshot.timer.startedAt);
  assert.equal(next.timer?.endsAt, input.snapshot.timer.endsAt + 60_000);
  assert.equal(next.revision, 1);
});

test('countdown is derived from the clock, clamps at zero and does not send updates', () => {
  assert.equal(countdown(61_000, 0), '01:01');
  assert.equal(countdown(300_000, 0), '05:00');
  assert.equal(countdown(500, 0), '00:01');
  assert.equal(countdown(0, 1), '00:00');
});

test('scenario recovery isolates snack and nap records and retains pending ownership', () => {
  const snack: ListedByKey = { id: 'snack', activityKey: 'mochi:snack:1', state: 'active' };
  const nap: ListedByKey = { id: 'nap', activityKey: 'mochi:nap:2', state: 'unknown' };
  const unrelated: ListedByKey = { id: 'other', activityKey: 'integration:3', state: 'active' };
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

// TP-CONTRACT-9
test("the requests of Mochi's snack and nap are kept for Rust to judge", (t) => {
  const now = 1_800_000_000_000;
  const update = (snapshot: Snapshot): UpdateInput => ({ id: 'handle', snapshot });
  const snack = startMochiActivity('snack', now, 5);
  const onTheWay = advanceMochiActivity(snack);
  const home = advanceMochiActivity({ snapshot: onTheWay });
  // The shortest and the longest nap that a start takes.
  const [short, long] = [1, 60].map((minutes) => startMochiActivity('nap', now, minutes));
  keep(t, 'demo-templates', [
    { name: 'the snack starts', command: 'start', input: snack },
    { name: 'the snack is on its way', command: 'update', input: update(onTheWay) },
    { name: 'the snack is home', command: 'update', input: update(home) },
    { name: 'a nap of one minute starts', command: 'start', input: short },
    { name: 'a nap of an hour starts', command: 'start', input: long },
    { name: 'the nap of an hour is a minute longer', command: 'update', input: update(advanceMochiActivity(present(long))) },
  ]);
});
