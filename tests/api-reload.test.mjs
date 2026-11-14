import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import * as activity from '../dist-js/index.js';

// A page that has just loaded: this file is a process of its own, so the module under test starts from nothing,
// while the plugin it talks to has been running.
// The event mock draws its listener ids from window.crypto.
globalThis.window = { crypto: globalThis.crypto };
afterEach(() => clearMocks());

// TP-EVENT-3
test('a page that loads hears the openings that the page before it did not let go, and no others', async t => {
  t.mock.method(console, 'warn', () => {});
  // The plugin has kept three openings. The page before this one let the first two go, and went while it handed
  // over the third, before it could say so.
  const waiting = [{ activityId: 'la-3', actionId: 'link:1' }];
  const kept = 3;
  const asked = [];
  mockIPC(async (command, payload) => {
    if (command !== 'plugin:live-activity|openings') return undefined;
    asked.push(payload.taken);
    waiting.splice(0, Math.max(0, Math.min(waiting.length, payload.taken - (kept - waiting.length))));
    return { openings: [...waiting], through: kept };
  }, { shouldMockEvents: true });
  const heard = [];
  const leave = await activity.onOpened(event => heard.push(event));
  assert.deepEqual(heard, [{ activityId: 'la-3', actionId: 'link:1' }]);
  // It asked from nothing, and then said that it had handed over the third.
  assert.deepEqual(asked, [0, 3]);
  assert.deepEqual(waiting, []);
  await leave();
});
