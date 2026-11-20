import assert from 'node:assert/strict';
import test from 'node:test';
import type { Layout, LayoutActivityRecord, LayoutEndInput, LayoutValues } from '../../../guest-js/index.js';
import { unchecked } from '../../../tests/support.ts';
import { endLeftovers, errorText, liveKey } from '../src/live-page.ts';

const layout = { lockScreen: { type: 'text', value: 'Mochi' } } as const;
const styles = { card: { padding: 16 } } as const;
const values: LayoutValues = { title: 'Mochi', done: 0.3, late: false };

test('the same layout and styles give the same key, whatever the order of their members', () => {
  const again = { lockScreen: { value: 'Mochi', type: 'text' } } as const;
  assert.equal(liveKey(layout, styles, values), liveKey(again, { card: { padding: 16 } }, { late: true, done: 1, title: 'Mochi' }));
});

test('another layout or other styles give another key, so the activity starts again', () => {
  const key = liveKey(layout, styles, values);
  assert.notEqual(liveKey({ lockScreen: { type: 'text', value: 'Mochi!' } }, styles, values), key);
  assert.notEqual(liveKey(layout, { card: { padding: 12 } }, values), key);
  assert.notEqual(liveKey(layout, undefined, values), key);
});

test('new values of the same names and types keep the key: the running activity takes them as an update', () => {
  assert.equal(liveKey(layout, styles, { title: 'Mochi’s dinner', done: 1, late: true }), liveKey(layout, styles, values));
});

test('a value added, removed or of another type gives another key, since an update keeps the names and types', () => {
  const key = liveKey(layout, styles, values);
  assert.notEqual(liveKey(layout, styles, { ...values, subtitle: 'Fish' }), key);
  assert.notEqual(liveKey(layout, styles, { title: 'Mochi', done: 0.3 }), key);
  assert.notEqual(liveKey(layout, styles, { ...values, done: '30%' }), key);
});

test('a key is a valid activity key: short, and only letters, digits, colons and dashes', () => {
  assert.match(liveKey(layout, styles, values), /^live:[0-9a-f]{8}$/);
});

test('the key is the FNV-1a hash of the layout, the styles and the values\' types, in eight hex digits', () => {
  // Pinned, and computed apart from this code: FNV-1a over `{"layout":…,"styles":…,"types":{"done":"number",…}}` with
  // every object's members in key order. A change of the hash or of what it covers shows here first.
  assert.equal(liveKey(layout, styles, values), 'live:327f2a3d');
  assert.equal(liveKey({ lockScreen: { type: 'spacer' } }, undefined, {}), 'live:4933fc65');
});

test('arrays keep their order: a reordered stack is another layout', () => {
  const stack = (children: readonly string[]): Layout => ({
    lockScreen: { type: 'vstack', children: children.map((value) => ({ type: 'text', value })) },
  });
  assert.notEqual(liveKey(stack(['a', 'b']), styles, values), liveKey(stack(['b', 'a']), styles, values));
});

test('a member that is undefined counts as one that is not there, as in the JSON that crosses the IPC', () => {
  // An app compiled without exactOptionalPropertyTypes may write one so.
  const written = unchecked<Layout>({ lockScreen: layout.lockScreen, island: undefined });
  assert.equal(liveKey(written, styles, values), liveKey(layout, styles, values));
});

/** A record as the plugin answers one; only the members `endLeftovers` reads differ between them. */
function record(id: string, activityKey: string, state: LayoutActivityRecord['state']): LayoutActivityRecord {
  return {
    id, activityKey, state, schemaVersion: 2, snapshot: { revision: 0, values: {} }, backend: 'activityKit',
    visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable',
  };
}

test('a load of the page ends what an earlier load left running, and only that', async () => {
  const ended: LayoutEndInput[] = [];
  const records = [
    record('a', 'live:0badf00d', 'active'),
    record('b', 'live:12345678', 'stale'),
    record('c', 'live:87654321', 'ended'),
    record('d', 'live:abcdef01', 'dismissed'),
    record('e', 'mochi:island', 'active'),
  ];
  const ids = await endLeftovers({
    listLayout: async () => records,
    endLayout: async (input) => {
      ended.push(input);
      return record(input.id, 'live:x', 'ended');
    },
  });
  assert.deepEqual(ids, ['a', 'b']);
  assert.deepEqual(ended, [{ id: 'a', policy: { kind: 'immediate' } }, { id: 'b', policy: { kind: 'immediate' } }]);
});

test('a refused list or end reaches the caller, which shows it, once every end was tried', async () => {
  const refusal = { code: 'NATIVE_ERROR', message: 'ActivityKit is not there' };
  await assert.rejects(endLeftovers({ listLayout: async () => Promise.reject(refusal), endLayout: async () => Promise.reject(refusal) }), refusal);
  const two = [record('a', 'live:0badf00d', 'active'), record('b', 'live:12345678', 'active')];
  const tried: string[] = [];
  let finished = false;
  await assert.rejects(endLeftovers({
    listLayout: async () => two,
    endLayout: async (input) => {
      tried.push(input.id);
      if (input.id === 'a') return Promise.reject(refusal);
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
      return record(input.id, 'live:12345678', 'ended');
    },
  }), refusal);
  // The page starts its card only after the end that is still under way has answered, or it would meet a conflict.
  assert.deepEqual(tried, ['a', 'b']);
  assert.equal(finished, true);
});

test('an error reads as its code and message, as the plugin refuses, or as itself', () => {
  assert.equal(errorText({ code: 'CONFLICT', message: 'Another activity runs under this key' }), 'CONFLICT: Another activity runs under this key');
  assert.equal(errorText(new Error('The page lost its socket')), 'The page lost its socket');
  assert.equal(errorText('plain'), 'plain');
  assert.equal(errorText({ message: 42 }), '[object Object]');
});
