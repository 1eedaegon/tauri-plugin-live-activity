import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { InvokeArgs } from '@tauri-apps/api/core';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import * as activity from '../dist-js/index.js';
import type { OpenedEvent } from '../dist-js/index.js';
import { member, number } from './support.ts';

// A page that has just loaded: this file is a process of its own, so the module under test starts from nothing,
// while the plugin it talks to has been running.
// The event mock draws its listener ids from window.crypto.
Reflect.set(globalThis, 'window', { crypto: globalThis.crypto });
afterEach(() => clearMocks());

/** How many openings a question to the plugin says the page has taken. The test fails when the question names no number. */
const openingsTaken = (payload: InvokeArgs | undefined): number => number(member(payload, 'taken'), 'how many openings the page has taken');

// TP-EVENT-3
test('a page that loads hears the openings that the page before it did not let go, and no others', async t => {
  t.mock.method(console, 'warn', () => {});
  // The plugin has kept three openings. The page before this one let the first two go, and went while it handed
  // over the third, before it could say so.
  const waiting: OpenedEvent[] = [{ activityId: 'la-3', actionId: 'link:1' }];
  const kept = 3;
  const asked: number[] = [];
  mockIPC(async (command, payload?: InvokeArgs) => {
    if (command !== 'plugin:live-activity|openings') return undefined;
    asked.push(openingsTaken(payload));
    waiting.splice(0, Math.max(0, Math.min(waiting.length, openingsTaken(payload) - (kept - waiting.length))));
    return { openings: [...waiting], through: kept };
  }, { shouldMockEvents: true });
  const heard: OpenedEvent[] = [];
  const leave = await activity.onOpened(event => heard.push(event));
  assert.deepEqual(heard, [{ activityId: 'la-3', actionId: 'link:1' }]);
  // It asked from nothing, and then said that it had handed over the third.
  assert.deepEqual(asked, [0, 3]);
  assert.deepEqual(waiting, []);
  await leave();
});
