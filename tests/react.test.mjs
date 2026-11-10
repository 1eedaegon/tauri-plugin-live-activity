import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { act, createElement, StrictMode } from 'react';
import TestRenderer from 'react-test-renderer';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { useLiveActivity } from '../dist-js/react/index.js';
import { Session } from '../dist-js/react/session.js';

// The event mock draws its listener ids from window.crypto.
globalThis.window = { crypto: globalThis.crypto };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mounted = [];
afterEach(async () => {
  for (const view of mounted.splice(0)) await view.unmount();
  clearMocks();
});

const PREFIX = 'plugin:live-activity|';
const layout = { lockScreen: { type: 'text', bind: 'status' } };
const values = { status: 'Preparing', done: 0.1 };

/**
 * The plugin's commands, answered as the plugin would. `hold` names the commands whose answers wait until the test
 * settles them with `release(name)` or `refuse(name, error)`; `refusing` names those that reject at once.
 */
function plugin({ hold = [], refusing = {} } = {}) {
  const calls = [];
  const waiting = [];
  let started = 0;
  const answer = (name, input) => {
    if (name === 'start_layout') {
      started += 1;
      return {
        id: `activity-${started}`, activityKey: input.activityKey, schemaVersion: 2, snapshot: input.snapshot,
        backend: 'activityKit', state: 'active', visibility: 'unknown', degradedFeatures: [],
        promotionRequested: false, promotionState: 'notApplicable',
      };
    }
    const last = calls.findLast(({ name: called }) => called === 'start_layout');
    const record = { ...answer.records.get(input.id), id: input.id, activityKey: last?.input.activityKey };
    if (name === 'update_layout') return { ...record, snapshot: input.snapshot };
    return { ...record, state: 'ended' };
  };
  answer.records = new Map();
  mockIPC((command, payload) => {
    if (!command.startsWith(PREFIX)) return undefined;
    const name = command.slice(PREFIX.length);
    const { input } = payload;
    calls.push({ name, input });
    if (refusing[name]) return Promise.reject(refusing[name]);
    const settle = () => {
      const result = answer(name, input);
      answer.records.set(result.id, result);
      return result;
    };
    if (!hold.includes(name)) return settle();
    return new Promise((resolve, reject) => waiting.push({ name, resolve: () => resolve(settle()), reject }));
  }, { shouldMockEvents: true });
  const take = (name) => {
    const index = waiting.findIndex((entry) => entry.name === name);
    assert.notEqual(index, -1, `no ${name} is waiting`);
    return waiting.splice(index, 1)[0];
  };
  return {
    calls,
    named: (name) => calls.filter((call) => call.name === name).map((call) => call.input),
    release: (name) => act(async () => take(name).resolve()),
    refuse: (name, error) => act(async () => take(name).reject(error)),
  };
}

/** Renders a component that calls the hook with `options`; returns what it saw and how to change or remove it. */
async function mount(options, { strict = false } = {}) {
  const seen = [];
  const Probe = ({ options: given }) => {
    seen.push(useLiveActivity(given));
    return null;
  };
  const tree = (given) => (strict ? createElement(StrictMode, null, createElement(Probe, { options: given })) : createElement(Probe, { options: given }));
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(tree(options));
  });
  let gone = false;
  const view = {
    seen,
    get state() { return seen.at(-1); },
    rerender: (next) => act(async () => renderer.update(tree(next))),
    unmount: async () => {
      if (gone) return;
      gone = true;
      await act(async () => renderer.unmount());
    },
  };
  mounted.push(view);
  return view;
}

const options = (more = {}) => ({ activityKey: 'delivery:42', layout, values, ...more });

// TP-REACT-1
test('mounting starts the activity at revision 0 and reports it active', async () => {
  const native = plugin({ hold: ['start_layout'] });
  const styles = { card: { padding: 16 } };
  const view = await mount(options({ styles, android: { visibility: 'public' } }));
  assert.deepEqual(native.named('start_layout'), [{
    activityKey: 'delivery:42', schemaVersion: 2, fallback: 'notification', layout, styles,
    snapshot: { revision: 0, values }, android: { visibility: 'public' },
  }]);
  assert.equal(view.state.status, 'starting');
  assert.equal(view.state.record, undefined);

  await native.release('start_layout');
  assert.equal(view.state.status, 'active');
  assert.equal(view.state.record.id, 'activity-1');
  assert.equal(view.state.error, undefined);
  assert.deepEqual(view.seen[0], { status: 'idle', record: undefined, error: undefined, pushToken: undefined });

  const other = plugin();
  const second = await mount({ activityKey: 'k', layout, values, fallback: 'none' });
  assert.deepEqual(other.named('start_layout'), [{ activityKey: 'k', schemaVersion: 2, fallback: 'none', layout, snapshot: { revision: 0, values } }]);
  await second.unmount();
});

// TP-REACT-2
test('changed values go out as one update at the next revision and equal values send nothing', async () => {
  const native = plugin();
  const view = await mount(options());
  await view.rerender(options({ values: { ...values } }));
  assert.deepEqual(native.named('update_layout'), []);

  await view.rerender(options({ values: { status: 'On the way', done: 0.1 } }));
  await view.rerender(options({ values: { status: 'On the way', done: 0.5 } }));
  assert.deepEqual(native.named('update_layout'), [
    { id: 'activity-1', snapshot: { revision: 1, values: { status: 'On the way', done: 0.1 } } },
    { id: 'activity-1', snapshot: { revision: 2, values: { status: 'On the way', done: 0.5 } } },
  ]);
  assert.equal(view.state.status, 'active');
  assert.deepEqual(view.state.record.snapshot, { revision: 2, values: { status: 'On the way', done: 0.5 } });
});

// TP-REACT-2
test('values changed in place or with a key added or removed go out as an update', async () => {
  const native = plugin();
  const shown = { status: 'a', done: 0.1 };
  const view = await mount(options({ values: shown }));
  shown.status = 'b';
  await view.rerender(options({ values: shown }));
  await view.rerender(options({ values: { status: 'b', done: 0.1, extra: true } }));
  await view.rerender(options({ values: { status: 'b' } }));
  assert.deepEqual(native.named('update_layout').map(({ snapshot }) => snapshot), [
    { revision: 1, values: { status: 'b', done: 0.1 } },
    { revision: 2, values: { status: 'b', done: 0.1, extra: true } },
    { revision: 3, values: { status: 'b' } },
  ]);
  // What went out is a copy: changing the caller's object later does not change it.
  shown.status = 'c';
  assert.equal(native.named('start_layout')[0].snapshot.values.status, 'a');
});

// TP-REACT-2
test('values that change during a request go out once it answers, the newest only', async () => {
  const native = plugin({ hold: ['update_layout'] });
  const view = await mount(options());
  await view.rerender(options({ values: { status: 'b', done: 0.2 } }));
  await view.rerender(options({ values: { status: 'c', done: 0.3 } }));
  await view.rerender(options({ values: { status: 'd', done: 0.4 } }));
  assert.equal(native.named('update_layout').length, 1);

  await native.release('update_layout');
  assert.deepEqual(native.named('update_layout'), [
    { id: 'activity-1', snapshot: { revision: 1, values: { status: 'b', done: 0.2 } } },
    { id: 'activity-1', snapshot: { revision: 2, values: { status: 'd', done: 0.4 } } },
  ]);
  await native.release('update_layout');
  assert.deepEqual(view.state.record.snapshot.values, { status: 'd', done: 0.4 });

  // Values that a start still in flight did not carry go out once it answers.
  const late = plugin({ hold: ['start_layout'] });
  const second = await mount(options());
  await second.rerender(options({ values: { status: 'e', done: 0.5 } }));
  assert.deepEqual(late.named('update_layout'), []);
  await late.release('start_layout');
  assert.deepEqual(late.named('update_layout'), [{ id: 'activity-1', snapshot: { revision: 1, values: { status: 'e', done: 0.5 } } }]);
});

// TP-REACT-3
test('unmounting ends the activity with the end policy', async () => {
  const native = plugin();
  const view = await mount(options());
  await view.unmount();
  assert.deepEqual(native.named('end_layout'), [{ id: 'activity-1', policy: { kind: 'immediate' } }]);

  const other = plugin();
  const second = await mount(options({ endPolicy: { kind: 'after', at: 1_900_000_000_000 } }));
  await second.unmount();
  assert.deepEqual(other.named('end_layout'), [{ id: 'activity-1', policy: { kind: 'after', at: 1_900_000_000_000 } }]);
});

// TP-REACT-3
test('a start still in flight is ended once it answers', async () => {
  const native = plugin({ hold: ['start_layout'] });
  const view = await mount(options());
  await view.unmount();
  assert.deepEqual(native.named('end_layout'), []);
  await native.release('start_layout');
  assert.deepEqual(native.named('end_layout'), [{ id: 'activity-1', policy: { kind: 'immediate' } }]);
  assert.deepEqual(native.named('update_layout'), []);
});

// TP-REACT-3
test('strict mode neither ends nor starts the activity again', async () => {
  const native = plugin();
  const view = await mount(options(), { strict: true });
  await act(async () => {});
  assert.equal(native.named('start_layout').length, 1);
  assert.deepEqual(native.named('end_layout'), []);
  assert.equal(view.state.status, 'active');
  await view.unmount();
  assert.equal(native.named('end_layout').length, 1);
});

// TP-REACT-3
test('enabled false during an update ends the activity once the update answers', async () => {
  const native = plugin({ hold: ['update_layout'] });
  const view = await mount(options());
  await view.rerender(options({ values: { status: 'b', done: 0.2 } }));
  await view.rerender(options({ enabled: false, values: { status: 'b', done: 0.2 }, endPolicy: { kind: 'default' } }));
  assert.deepEqual(native.named('end_layout'), []);
  await native.release('update_layout');
  assert.deepEqual(native.named('end_layout'), [{ id: 'activity-1', policy: { kind: 'default' } }]);
  assert.equal(view.state.status, 'ended');
});

// TP-REACT-3
test('a release ends the activity unless a mount follows within the microtask', async () => {
  const sent = [];
  const record = { id: 'a1', activityKey: 'k', snapshot: { revision: 0, values: {} }, state: 'active' };
  const commands = {
    startLayout: async (input) => { sent.push('start'); return { ...record, snapshot: input.snapshot }; },
    updateLayout: async () => { sent.push('update'); return record; },
    endLayout: async () => { sent.push('end'); return { ...record, state: 'ended' }; },
  };
  const states = [];
  const session = new Session(commands, (state) => states.push(state.status));
  session.keep();
  session.sync({ activityKey: 'k', layout, values: {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(states, ['starting', 'active']);
  // Strict Mode: the unmount and the mount come before the microtask.
  session.release();
  session.keep();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, ['start']);
  session.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, ['start', 'end']);
  assert.deepEqual(states, ['starting', 'active', 'ending', 'ended']);
});

// TP-REACT-3
test('enabled false ends the activity and true starts it again', async () => {
  const native = plugin();
  const view = await mount(options());
  await view.rerender(options({ enabled: false }));
  assert.deepEqual(native.named('end_layout'), [{ id: 'activity-1', policy: { kind: 'immediate' } }]);
  assert.equal(view.state.status, 'ended');
  assert.equal(view.state.record.state, 'ended');

  await view.rerender(options({ enabled: false, values: { status: 'x', done: 1 } }));
  assert.deepEqual(native.named('update_layout'), []);
  await view.rerender(options({ values: { status: 'again', done: 0 } }));
  assert.deepEqual(native.named('start_layout').at(-1).snapshot, { revision: 0, values: { status: 'again', done: 0 } });
  assert.equal(view.state.status, 'active');
  assert.equal(view.state.record.id, 'activity-2');

  const idle = plugin();
  const never = await mount(options({ enabled: false }));
  assert.deepEqual(idle.calls, []);
  assert.equal(never.state.status, 'idle');
});

// TP-REACT-4
test("a refused start is failed with the plugin's error", async () => {
  const refusal = { code: 'PERMISSION_DENIED', message: 'Live Activities are off' };
  plugin({ refusing: { start_layout: refusal } });
  const view = await mount(options());
  assert.equal(view.state.status, 'failed');
  assert.deepEqual(view.state.error, refusal);
  assert.equal(view.state.record, undefined);

  // A rejection that is not the plugin's error still reads as one.
  plugin({ refusing: { start_layout: 'ipc closed' } });
  const other = await mount(options());
  assert.deepEqual(other.state.error, { code: 'NATIVE_ERROR', message: 'ipc closed' });

  // Off and on again starts again.
  const native = plugin();
  await view.rerender(options({ enabled: false }));
  await view.rerender(options());
  assert.equal(native.named('start_layout').length, 1);
  assert.equal(view.state.status, 'active');
  assert.equal(view.state.error, undefined);
});

// TP-REACT-4
test('a refused update keeps the activity and the next accepted one clears the error', async () => {
  const native = plugin({ hold: ['update_layout'] });
  const view = await mount(options());
  await view.rerender(options({ values: { status: 'b', done: 0.2 } }));
  await native.refuse('update_layout', { code: 'STALE_REVISION', message: 'older than the last' });
  assert.equal(view.state.status, 'active');
  assert.deepEqual(view.state.error, { code: 'STALE_REVISION', message: 'older than the last' });

  await view.rerender(options({ values: { status: 'b', done: 0.2 } }));
  assert.equal(native.named('update_layout').length, 1);
  await view.rerender(options({ values: { status: 'c', done: 0.3 } }));
  assert.deepEqual(native.named('update_layout').at(-1), { id: 'activity-1', snapshot: { revision: 2, values: { status: 'c', done: 0.3 } } });
  await native.release('update_layout');
  assert.equal(view.state.error, undefined);
  assert.equal(view.state.status, 'active');
});

// TP-REACT-4
test('a start refused after enabled turned off starts again when it turns on', async () => {
  const native = plugin({ hold: ['start_layout'] });
  const view = await mount(options());
  await view.rerender(options({ enabled: false }));
  await native.refuse('start_layout', { code: 'NOT_FOREGROUND', message: 'in the background' });
  assert.equal(view.state.status, 'failed');
  await view.rerender(options());
  assert.equal(native.named('start_layout').length, 2);
  await native.release('start_layout');
  assert.equal(view.state.status, 'active');
});

// TP-REACT-4
test('a session whose start is refused after enabled turned off starts again when it turns on', async () => {
  const starts = [];
  const commands = {
    startLayout: (input) => new Promise((resolve, reject) => starts.push({ input, resolve, reject })),
    updateLayout: async () => assert.fail('no update'),
    endLayout: async () => assert.fail('no end'),
  };
  const session = new Session(commands, () => {});
  const wanted = { activityKey: 'k', layout, values: {} };
  session.sync(wanted);
  session.sync({ ...wanted, enabled: false });
  starts[0].reject({ code: 'NOT_FOREGROUND', message: 'in the background' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.sync(wanted);
  assert.equal(starts.length, 2);
  // A refusal of the key still wanted blocks it until enabled turns off.
  starts[1].reject({ code: 'NOT_FOREGROUND', message: 'in the background' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.sync(wanted);
  assert.equal(starts.length, 2);
});

// TP-REACT-4
test('a key change during a start ends the activity of the old key and starts the new one', async () => {
  const native = plugin({ hold: ['start_layout'] });
  const view = await mount(options());
  await view.rerender(options({ activityKey: 'delivery:43' }));
  assert.equal(native.named('start_layout').length, 1);
  await native.release('start_layout');
  assert.deepEqual(native.calls.map(({ name, input }) => `${name} ${input.activityKey ?? input.id}`),
    ['start_layout delivery:42', 'end_layout activity-1', 'start_layout delivery:43']);
  await native.release('start_layout');
  assert.equal(view.state.record.activityKey, 'delivery:43');
  assert.equal(view.state.status, 'active');
});

// TP-REACT-4
test('another activity key starts again', async () => {
  const native = plugin({ refusing: { start_layout: { code: 'SYSTEM_LIMIT', message: 'too many' } } });
  const view = await mount(options());
  assert.equal(view.state.status, 'failed');
  const fresh = plugin();
  await view.rerender(options({ activityKey: 'delivery:43' }));
  assert.equal(native.named('start_layout').length, 1);
  assert.deepEqual(fresh.named('start_layout').map(({ activityKey }) => activityKey), ['delivery:43']);
  assert.equal(view.state.status, 'active');

  // A running activity ends before the activity of the new key starts.
  await view.rerender(options({ activityKey: 'delivery:44' }));
  assert.deepEqual(fresh.calls.map(({ name }) => name), ['start_layout', 'end_layout', 'start_layout']);
  assert.deepEqual(fresh.named('end_layout'), [{ id: 'activity-1', policy: { kind: 'immediate' } }]);
  assert.equal(view.state.record.activityKey, 'delivery:44');
});

// TP-REACT-4
test('a refused end is failed and not tried again', async () => {
  const native = plugin({ refusing: { end_layout: { code: 'NOT_FOUND', message: 'gone' } } });
  const view = await mount(options());
  await view.rerender(options({ enabled: false }));
  assert.equal(view.state.status, 'failed');
  assert.deepEqual(view.state.error, { code: 'NOT_FOUND', message: 'gone' });
  assert.equal(view.state.record.id, 'activity-1');
  await view.rerender(options({ enabled: false, values: { status: 'x', done: 1 } }));
  await view.unmount();
  assert.equal(native.named('end_layout').length, 1);
});

// TP-REACT-5
test('onAction gets the taps of this activity only, until unmount', async (t) => {
  t.mock.method(console, 'warn', () => {});
  plugin();
  const taps = [];
  const view = await mount(options({ onAction: (event) => taps.push(event.actionId) }));
  await act(async () => {
    await emit('live-activity://action', { actionId: 'pet', activityId: 'activity-1' });
    await emit('live-activity://action', { actionId: 'other', activityId: 'activity-9' });
  });
  // The newest handler is the one called.
  await view.rerender(options({ onAction: (event) => taps.push(`new ${event.actionId}`) }));
  await act(async () => emit('live-activity://action', { actionId: 'done', activityId: 'activity-1' }));
  await view.unmount();
  await act(async () => emit('live-activity://action', { actionId: 'late', activityId: 'activity-1' }));
  assert.deepEqual(taps, ['pet', 'new done']);
});

// TP-PUSH-7
test('the state carries the push token and takes pushed content of its activity', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const native = plugin({ hold: ['start_layout'] });
  const view = await mount(options({ push: 'token' }));
  assert.equal(view.state.pushToken, undefined);
  // A token that comes before the start has answered is the activity's once it has.
  await act(async () => emit('live-activity://push-token', { activityId: 'activity-1', token: 'early' }));
  await native.release('start_layout');
  assert.equal(native.named('start_layout')[0].push, 'token');
  assert.equal(view.state.pushToken, 'early');
  await act(async () => {
    await emit('live-activity://push-token', { activityId: 'activity-9', token: 'other' });
    await emit('live-activity://push-token', { activityId: 'activity-1', token: 'later' });
  });
  assert.equal(view.state.pushToken, 'later');
  // Pushed content becomes the record; the component's values did not change, so nothing is sent.
  const pushed = { ...view.state.record, snapshot: { revision: 3, values: { status: 'Delivered', done: 1 } } };
  await act(async () => {
    await emit('live-activity://updated', { record: { ...pushed, id: 'activity-9' } });
    await emit('live-activity://updated', { record: pushed });
  });
  assert.deepEqual(view.state.record, pushed);
  assert.equal(view.state.status, 'active');
  assert.equal(native.named('update_layout').length, 0);
  // The next change of the values goes above the pushed revision.
  await view.rerender(options({ push: 'token', values: { status: 'Rated', done: 1 } }));
  assert.deepEqual(native.named('update_layout'), [{ id: 'activity-1', snapshot: { revision: 4, values: { status: 'Rated', done: 1 } } }]);
  assert.equal(view.state.pushToken, 'later');
  // The token goes with the activity.
  await view.rerender(options({ push: 'token', values: { status: 'Rated', done: 1 }, enabled: false }));
  assert.equal(view.state.status, 'ended');
  assert.equal(view.state.pushToken, undefined);
});

// TP-REACT-5
test('no tap is passed on while no activity of this hook runs', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const native = plugin({ hold: ['start_layout', 'end_layout'] });
  const taps = [];
  const view = await mount(options({ onAction: (event) => taps.push(event.actionId) }));
  // Starting: no id yet, and a tap without an activity id is not this activity's.
  await act(async () => {
    await emit('live-activity://action', { actionId: 'early' });
    await emit('live-activity://action', { actionId: 'early', activityId: 'activity-1' });
  });
  await native.release('start_layout');
  // Another key: the old activity's taps are not passed on once it ends.
  await view.rerender(options({ activityKey: 'delivery:43', onAction: (event) => taps.push(event.actionId) }));
  await native.release('end_layout');
  await act(async () => emit('live-activity://action', { actionId: 'old', activityId: 'activity-1' }));
  await native.release('start_layout');
  // Unmounted while the end is in flight: the activity still runs, but the hook no longer listens.
  await view.unmount();
  await act(async () => emit('live-activity://action', { actionId: 'after unmount', activityId: 'activity-2' }));
  assert.deepEqual(taps, []);
  assert.deepEqual(native.named('end_layout').map(({ id }) => id), ['activity-1', 'activity-2']);
});

// TP-REACT-6
test('a new layout while the activity runs sends nothing', async () => {
  const native = plugin();
  const view = await mount(options());
  await view.rerender(options({ layout: { lockScreen: { type: 'text', value: 'other' } }, styles: { a: { padding: 1 } }, fallback: 'none' }));
  assert.deepEqual(native.calls.map(({ name }) => name), ['start_layout']);
  assert.equal(view.state.status, 'active');
});
