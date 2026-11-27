import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { InvokeArgs } from '@tauri-apps/api/core';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { LAYOUT_FIXTURES, contract } from '../tools/activitykit.ts';
import * as activity from '../dist-js/index.js';
import type {
  ActionEvent, ActivityRecord, ErrorCode, Layout, LayoutActivityRecord, LayoutBound, LayoutEndInput, LayoutNode, LayoutPush,
  LayoutStartInput, LayoutUpdateInput, OpenedEvent, Permissions, ProgressSnapshot, PushedEvent, PushTarget, PushToStartTokenEvent,
  PushTokenEvent, StartInput,
  StartedEvent, StateEvent, UpdateInput, UpdatedEvent,
} from '../dist-js/index.js';
import { isRecord, list, member, number, present, record as jsonObject, text, unchecked } from './support.ts';
import type { JsonObject } from './support.ts';

// activitykit's fixtures, from the crate that the plugin builds with.
const fixtures = contract(LAYOUT_FIXTURES);

/** What every fixture of the file has: its name. */
interface NamedFixture {
  readonly name: string;
}

/** The fixtures of the list `key` in the file: of each its name, and the members that `read` takes from its JSON object. */
const fixturesOf = <Members>(key: string, read: (fixture: JsonObject) => Members): readonly (Members & NamedFixture)[] =>
  list(member(fixtures, key), key).map(fixture => {
    const object = jsonObject(fixture, `a fixture of ${key}`);
    return { ...read(object), name: text(object.name, 'the name of a fixture') };
  });
// What the tests read of the fixtures: every list of the file, and of each fixture the members that the tests take.
// The input of a valid request is an object; that of an invalid one may be anything, and it has the code of its rejection.
const layoutFixtures = {
  valid: fixturesOf('valid', ({ command, input }) => ({ command: text(command, 'the command of a fixture'), input: jsonObject(input, 'the input of a valid fixture') })),
  invalid: fixturesOf('invalid', ({ command, input, code }) => ({ command: text(command, 'the command of a fixture'), input, code })),
  updates: fixturesOf('updates', ({ start, update, code }) => ({ start, update, code })),
  ends: fixturesOf('ends', ({ start, end, code }) => ({ start, end, code })),
};

Reflect.set(globalThis, 'window', {});
afterEach(() => clearMocks());

/** A call of a native command, as the mock of Tauri's IPC got it. */
interface NativeCall {
  readonly nativeCommand: string;
  readonly payload: InvokeArgs | undefined;
}

/**
 * The functions of the API, which a table of tests calls by name: every export but the builders of `layout` and
 * `pushTarget`, which asks the plugin nothing.
 */
type Commands = Omit<typeof activity, 'layout' | 'pushTarget'>;
/** The arguments that each of them takes. */
type CommandArgs = { readonly [Name in keyof Commands]: Parameters<Commands[Name]> };
/**
 * A row of such a table: the name of a command, the arguments that this command takes, and what the table says of
 * the call before and after them.
 */
type CommandRow<Before extends readonly unknown[], After extends readonly unknown[]> =
  { readonly [Name in keyof Commands]: readonly [Name, ...Before, CommandArgs[Name], ...After] }[keyof Commands];
/** The API with each command as a function of those arguments, which is how the compiler lets a row call one by name. */
const commandsByName: { readonly [Name in keyof Commands]: (...args: CommandArgs[Name]) => Promise<unknown> } = activity;
/** Calls the command `name` of the API with `args`, as `activity[name](...args)`. */
const call = <Name extends keyof Commands>(name: Name, args: CommandArgs[Name]): Promise<unknown> => commandsByName[name](...args);

const snapshot: ProgressSnapshot = Object.freeze({ revision: 0, title: 'Delivery', status: 'Preparing', progress: 0.1 });
const input: StartInput = Object.freeze({ activityKey: 'delivery:42', schemaVersion: 1, template: 'progress', fallback: 'notification', snapshot });
const record: ActivityRecord = Object.freeze({ id: 'opaque-native-handle', activityKey: input.activityKey, schemaVersion: 1, template: 'progress', snapshot, backend: 'activityKit', state: 'active', visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' });

for (const [name, command, args, expectedPayload, result] of [
  ['getCapabilities', 'get_capabilities', [], {}, { platform: 'ios', backend: 'activityKit', start: 'supported' }],
  ['checkPermissions', 'check_permissions', [], {}, { notifications: 'notApplicable', liveActivities: 'granted', promotion: 'notApplicable' }],
  ['requestPermissions', 'request_permissions', ['notifications'], { kind: 'notifications' }, { notifications: 'granted' }],
  ['openExactAlarmSettings', 'open_exact_alarm_settings', [], {}, { platform: 'android', backend: 'androidNotification', androidPresentation: { scheduledStart: true, exactStart: true } }],
  ['openPromotionSettings', 'open_promotion_settings', [], {}, null],
  ['start', 'start', [input], { input }, record],
  ['update', 'update', [{ id: record.id, snapshot: { ...snapshot, revision: 1, progress: 0.5 } }], { input: { id: record.id, snapshot: { ...snapshot, revision: 1, progress: 0.5 } } }, { ...record, snapshot: { ...snapshot, revision: 1, progress: 0.5 } }],
  ['end', 'end', [{ id: record.id, policy: { kind: 'immediate' } }], { input: { id: record.id, policy: { kind: 'immediate' } } }, { ...record, state: 'ended' }],
  ['list', 'list', [], {}, [record]],
  ['pushTokens', 'push_tokens', [], {}, { activities: [] }],
] satisfies readonly CommandRow<[command: string], [expectedPayload: InvokeArgs, result: unknown]>[]) {
  test(`${name} invokes the namespaced command with its public arguments`, async () => {
    const calls: NativeCall[] = [];
    mockIPC((nativeCommand, payload?: InvokeArgs) => {
      calls.push({ nativeCommand, payload });
      return result;
    });
    assert.deepEqual(await call(name, args), result);
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: expectedPayload }]);
  });
}

test('keeps the complete timer snapshot and caller-owned input unchanged', async () => {
  const timer = Object.freeze({ startedAt: 1_700_000_000_000, endsAt: 1_700_000_060_000 });
  const timerSnapshot = Object.freeze({ revision: 2, title: 'Timer', status: 'Running', timer, staleAt: timer.endsAt });
  const request = Object.freeze({ ...input, template: 'timer', snapshot: timerSnapshot });
  const serialized = JSON.stringify(request);
  mockIPC((_command, payload?: InvokeArgs) => {
    assert.deepEqual(payload, { input: request });
    return { ...record, template: 'timer', snapshot: timerSnapshot };
  });
  const actual = await activity.start(request);
  assert.deepEqual(actual.snapshot, timerSnapshot);
  assert.equal(JSON.stringify(request), serialized);
});

for (const code of ['PERMISSION_DENIED', 'UNSUPPORTED_PLATFORM', 'STALE_REVISION', 'CONFLICT', 'NOT_FOUND'] satisfies readonly ErrorCode[]) {
  test(`preserves the native ${code} error instead of reporting success`, async () => {
    const expected = { code, message: 'Operation could not be completed.' };
    mockIPC(() => Promise.reject(expected));
    await assert.rejects(activity.start(input), error => {
      assert.deepEqual(error, expected);
      return true;
    });
  });
}

// TP-JS-2
test('writeImage sends the name and the bytes of a Uint8Array or an ArrayBuffer', async () => {
  const calls: NativeCall[] = [];
  mockIPC((nativeCommand, payload?: InvokeArgs) => {
    calls.push({ nativeCommand, payload });
    return null;
  });
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 255);
  assert.equal(await activity.writeImage('badge.png', png), null);
  await activity.writeImage('badge.png', png.buffer);
  const expected = { nativeCommand: 'plugin:live-activity|write_image', payload: { input: { name: 'badge.png', png: [0x89, 0x50, 0x4e, 0x47, 0, 255] } } };
  assert.deepEqual(calls, [expected, expected]);
});

test('writeImage reports the native rejection of an image', async () => {
  const expected = { code: 'CONFIGURATION_REQUIRED', message: 'The widget extension names no App Group: run setup with --app-group.' };
  mockIPC(() => Promise.reject(expected));
  await assert.rejects(activity.writeImage('badge.png', new Uint8Array(1)), error => {
    assert.deepEqual(error, expected);
    return true;
  });
});

test('preserves unknown visibility and unknown promotion without inventing delivery', async () => {
  const unknownRecord = { ...record, backend: 'androidNotification', state: 'unknown', promotionRequested: true, promotionState: 'unknown' };
  mockIPC(() => [unknownRecord]);
  assert.deepEqual(await activity.list(), [unknownRecord]);
});

// Contract v2: layout activities.
window.crypto = globalThis.crypto; // the event mock draws its listener ids from it
const { layout } = activity;
const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value === 'object' && value !== null) Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};

const values = { title: 'Focus', progress: 0.25, paused: false };
const layoutInput: LayoutStartInput = deepFreeze({
  activityKey: 'focus:1', schemaVersion: 2, fallback: 'notification',
  layout: { lockScreen: { type: 'vstack', spacing: 6, children: [
    { type: 'text', bind: 'title', style: 'title' },
    { type: 'progress', bind: 'progress' },
    { type: 'button', actionId: 'focus.pause', unless: 'paused', child: { type: 'text', value: 'Pause' } },
  ] } },
  styles: { title: { font: 'headline', lineLimit: 1 } },
  snapshot: { revision: 0, values, staleAt: 1_790_000_900_000 },
});
const layoutRecord: LayoutActivityRecord = deepFreeze({ id: 'opaque-layout-handle', activityKey: layoutInput.activityKey, schemaVersion: 2, snapshot: layoutInput.snapshot, backend: 'activityKit', state: 'active', visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' });
const layoutUpdate: LayoutUpdateInput = deepFreeze({ id: layoutRecord.id, snapshot: { revision: 1, values: { ...values, progress: 0.5 } } });
const layoutEnd: LayoutEndInput = deepFreeze({ id: layoutRecord.id, policy: { kind: 'immediate' } });

for (const [name, command, args, result] of [
  ['startLayout', 'start_layout', [layoutInput], layoutRecord],
  ['updateLayout', 'update_layout', [layoutUpdate], { ...layoutRecord, snapshot: layoutUpdate.snapshot }],
  ['endLayout', 'end_layout', [layoutEnd], { ...layoutRecord, state: 'ended' }],
  ['listLayout', 'list_layout', [], [layoutRecord]],
] satisfies readonly CommandRow<[command: string], [result: unknown]>[]) {
  test(`${name} invokes the namespaced command with its public arguments`, async () => {
    const expectedPayload = args.length === 0 ? {} : { input: structuredClone(args[0]) };
    const calls: NativeCall[] = [];
    mockIPC((nativeCommand, payload?: InvokeArgs) => {
      calls.push({ nativeCommand, payload });
      return result;
    });
    assert.deepEqual(await call(name, args), result);
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: expectedPayload }]);
  });
}

// TP-JS-1
test('keeps the caller-owned layout request, its tree and its values unchanged', async () => {
  const serialized = JSON.stringify(layoutInput);
  mockIPC((_command, payload?: InvokeArgs) => {
    assert.deepEqual(payload, { input: layoutInput });
    return layoutRecord;
  });
  const actual = await activity.startLayout(layoutInput);
  assert.deepEqual(actual.snapshot.values, values);
  assert.equal(JSON.stringify(layoutInput), serialized);
});

for (const [name, args, code] of [
  ['startLayout', [layoutInput], 'PAYLOAD_TOO_LARGE'],
  ['startLayout', [layoutInput], 'CONFIGURATION_REQUIRED'],
  ['updateLayout', [layoutUpdate], 'INVALID_INPUT'],
  ['endLayout', [layoutEnd], 'NOT_FOUND'],
  ['listLayout', [], 'UNSUPPORTED_PLATFORM'],
] satisfies readonly CommandRow<[], [code: ErrorCode]>[]) {
  test(`${name} preserves the native ${code} error instead of reporting success`, async () => {
    const expected = { code, message: 'Operation could not be completed.' };
    mockIPC(() => Promise.reject(expected));
    await assert.rejects(call(name, args), error => {
      assert.deepEqual(error, expected);
      return true;
    });
  });
}

// TP-JS-3
test('onAction hands each action payload, and nothing else, to its handler until that handler is unsubscribed', async t => {
  // The event mock keeps an unsubscribed listener id and warns when it finds no callback for it.
  t.mock.method(console, 'warn', () => {});
  mockIPC(() => {}, { shouldMockEvents: true });
  const first: ActionEvent[][] = [];
  const second: ActionEvent[][] = [];
  const unlisten = await activity.onAction((...received) => first.push(received));
  await activity.onAction((...received) => second.push(received));
  const pause = { actionId: 'focus.pause', activityId: layoutRecord.id, activityKey: layoutInput.activityKey };
  const resume = { actionId: 'focus.resume', activityId: layoutRecord.id };

  await emit('live-activity://action', pause);
  await emit('live-activity://other', resume);
  assert.deepEqual(first, [[pause]]);
  assert.deepEqual(second, [[pause]]);

  await unlisten();
  await emit('live-activity://action', resume);
  assert.deepEqual(first, [[pause]]);
  assert.deepEqual(second, [[pause], [resume]]);
});

// TP-PUSH-1
test('startLayout passes push through unchanged', async () => {
  for (const push of ['token', { channel: 'dGVzdA==' }] satisfies readonly LayoutPush[]) {
    const calls: NativeCall[] = [];
    mockIPC((nativeCommand, payload?: InvokeArgs) => {
      calls.push({ nativeCommand, payload });
      return layoutRecord;
    });
    const request = Object.freeze({ ...layoutInput, push });
    assert.deepEqual(await activity.startLayout(request), layoutRecord);
    assert.deepEqual(calls, [{ nativeCommand: 'plugin:live-activity|start_layout', payload: { input: request } }]);
    clearMocks();
  }
});

// TP-PUSH-2, TP-PUSH-4
test('onPushToken, onPushToStartToken and onUpdated listen to their events', async t => {
  t.mock.method(console, 'warn', () => {});
  mockIPC(command => (command === 'plugin:live-activity|push_tokens' ? { activities: [] } : undefined), { shouldMockEvents: true });
  const tokens: PushTokenEvent[] = [];
  const starts: PushToStartTokenEvent[] = [];
  const updates: UpdatedEvent[] = [];
  const unlisten = await activity.onPushToken(event => tokens.push(event));
  await activity.onPushToStartToken(event => starts.push(event));
  await activity.onUpdated(event => updates.push(event));
  const token = { activityId: layoutRecord.id, activityKey: layoutInput.activityKey, token: '0a1b' };
  await emit('live-activity://push-token', token);
  await emit('live-activity://push-to-start-token', { token: 'ff00' });
  await emit('live-activity://updated', { record: layoutRecord });
  await emit('live-activity://action', { actionId: 'pet', activityId: layoutRecord.id });
  assert.deepEqual(tokens, [token]);
  assert.deepEqual(starts, [{ token: 'ff00' }]);
  assert.deepEqual(updates, [{ record: layoutRecord }]);

  await unlisten();
  await emit('live-activity://push-token', { ...token, token: 'later' });
  assert.deepEqual(tokens, [token]);
});

// TP-PUSH-9
test("pushTarget makes the target of APNs for a token's event, which the server's liveactivity reads", () => {
  const activityToken: PushTokenEvent = { activityId: 'la-1', activityKey: 'job:1', token: '0a1b' };
  const startToken: PushToStartTokenEvent = { token: 'ff00' };
  const targets: PushTarget[] = [activity.pushTarget(activityToken), activity.pushTarget(startToken)];
  assert.deepEqual(targets, [{ type: 'apnsActivity', token: '0a1b' }, { type: 'apnsPushToStart', token: 'ff00' }]);
  // An activity's event without its key is still the activity's.
  assert.deepEqual(activity.pushTarget({ activityId: 'la-2', token: '0c0d' }), { type: 'apnsActivity', token: '0c0d' });
  // The JSON that crosses to the server is the target and nothing of the event.
  assert.equal(JSON.stringify(activity.pushTarget(activityToken)), '{"type":"apnsActivity","token":"0a1b"}');
});

// TP-PUSH-10
test('onPushed hands what each Android push did to its handler until it is unsubscribed', async t => {
  t.mock.method(console, 'warn', () => {});
  mockIPC(() => undefined, { shouldMockEvents: true });
  const heard: PushedEvent[] = [];
  const unlisten = await activity.onPushed(event => heard.push(event));
  const taken: PushedEvent = { activityId: layoutRecord.id, activityKey: layoutInput.activityKey, command: 'update', revision: 4 };
  const refused: PushedEvent = { activityKey: 'job:3', command: 'end', code: 'NOT_FOUND' };
  await emit('live-activity://pushed', taken);
  await emit('live-activity://pushed', refused);
  // Another event is none of its own.
  await emit('live-activity://updated', { record: layoutRecord });
  assert.deepEqual(heard, [taken, refused]);

  await unlisten();
  await emit('live-activity://pushed', taken);
  assert.equal(heard.length, 2);
});

// TP-EVENT-1
test('onStarted, onState and onPermissions listen to their events', async t => {
  t.mock.method(console, 'warn', () => {});
  mockIPC(() => undefined, { shouldMockEvents: true });
  const started: StartedEvent[] = [];
  const states: StateEvent[] = [];
  const permissions: Permissions[] = [];
  const unlisten = await activity.onStarted(event => started.push(event));
  await activity.onState(event => states.push(event));
  await activity.onPermissions(event => permissions.push(event));
  const dismissed = { activityId: layoutRecord.id, activityKey: layoutInput.activityKey, state: 'dismissed' };
  const denied = { notifications: 'notApplicable', liveActivities: 'denied', promotion: 'notApplicable', frequentPushes: 'denied' };
  await emit('live-activity://started', { record: layoutRecord });
  await emit('live-activity://state', dismissed);
  await emit('live-activity://permissions', denied);
  await emit('live-activity://updated', { record: layoutRecord });
  assert.deepEqual(started, [{ record: layoutRecord }]);
  assert.deepEqual(states, [dismissed]);
  assert.deepEqual(permissions, [denied]);

  await unlisten();
  await emit('live-activity://started', { record: layoutRecord });
  assert.equal(started.length, 1);
});

// TP-EVENT-4
test('onUnknown hands each unknown event to its handler until it is unsubscribed', async t => {
  t.mock.method(console, 'warn', () => {});
  mockIPC(() => undefined, { shouldMockEvents: true });
  const heard: unknown[] = [];
  const unlisten = await activity.onUnknown(event => heard.push(event));
  const known = { activityId: layoutRecord.id, activityKey: layoutInput.activityKey };
  const forgotten = { activityId: 'an-activity-the-plugin-knows-no-longer' };
  await emit('live-activity://unknown', known);
  await emit('live-activity://unknown', forgotten);
  // Another event is none of its own.
  await emit('live-activity://state', { ...known, state: 'active' });
  assert.deepEqual(heard, [known, forgotten]);

  await unlisten();
  await emit('live-activity://unknown', known);
  assert.equal(heard.length, 2);
});

// TP-EVENT-5
test("onHandled hands each tap that the app's component took to its handler, and onAction hears none of them", async t => {
  t.mock.method(console, 'warn', () => {});
  mockIPC(() => undefined, { shouldMockEvents: true });
  const handled: unknown[] = [];
  const tapped: unknown[] = [];
  const unlisten = await activity.onHandled(event => handled.push(event));
  const unlistenTaps = await activity.onAction(event => tapped.push(event));
  const taken = { activityId: layoutRecord.id, activityKey: layoutInput.activityKey, actionId: 'record',
    tap: { id: '7', at: 1_800_000_000_000 } };
  await emit('live-activity://handled', taken);
  assert.deepEqual(handled, [taken]);
  assert.deepEqual(tapped, []);
  await unlisten();
  await unlistenTaps();
  await emit('live-activity://handled', taken);
  assert.equal(handled.length, 1);
});

// TP-ANDROID-22
test("a start whose button runs the app's own service is sent as given", async () => {
  const calls: NativeCall[] = [];
  mockIPC((nativeCommand, payload?: InvokeArgs) => {
    calls.push({ nativeCommand, payload });
    return layoutRecord;
  });
  // A target of the options, by a control's action id; and one of an Android content's action.
  const recorder: LayoutStartInput = deepFreeze({
    ...layoutInput,
    android: {
      visibility: 'public',
      targets: { record: { kind: 'foregroundService', component: 'dev.example.app.RecorderService', action: 'dev.example.app.RECORD' } },
    },
    snapshot: {
      ...layoutInput.snapshot,
      android: {
        title: 'Recorder', status: 'Listening',
        presentation: { style: { kind: 'standard' }, actions: [{ id: 'stop', title: 'Stop', target: { kind: 'broadcast', component: 'dev.example.app.StopReceiver' } }] },
      },
    },
  });
  await activity.startLayout(recorder);
  assert.deepEqual(calls, [{ nativeCommand: 'plugin:live-activity|start_layout', payload: { input: recorder } }]);
});

// TP-ANDROID-20
test("a start that keeps its activity off a watch's face is sent as given", async () => {
  const calls: NativeCall[] = [];
  mockIPC((nativeCommand, payload?: InvokeArgs) => {
    calls.push({ nativeCommand, payload });
    return layoutRecord;
  });
  // In the options of the start, for every snapshot of the activity; and in the presentation of an Android content,
  // for its snapshot.
  const quiet: LayoutStartInput = deepFreeze({
    ...layoutInput,
    android: { visibility: 'private', wearOngoingActivity: false },
    snapshot: {
      ...layoutInput.snapshot,
      android: { title: 'Mochi', status: 'Dreaming of tuna', presentation: { style: { kind: 'standard' }, wearOngoingActivity: false } },
    },
  });
  await activity.startLayout(quiet);
  assert.deepEqual(calls, [{ nativeCommand: 'plugin:live-activity|start_layout', payload: { input: quiet } }]);
});

// TP-ANDROID-24
test('a start that keeps its activity off a paired watch is sent as given', async () => {
  const calls: NativeCall[] = [];
  mockIPC((nativeCommand, payload?: InvokeArgs) => {
    calls.push({ nativeCommand, payload });
    return layoutRecord;
  });
  // In the options of the start, for every snapshot of the activity; and in the presentation of an Android content,
  // for its snapshot.
  const local: LayoutStartInput = deepFreeze({
    ...layoutInput,
    android: { visibility: 'private', localOnly: true },
    snapshot: {
      ...layoutInput.snapshot,
      android: { title: 'Mochi', status: 'Napping by the window', presentation: { style: { kind: 'standard' }, localOnly: true } },
    },
  });
  await activity.startLayout(local);
  assert.deepEqual(calls, [{ nativeCommand: 'plugin:live-activity|start_layout', payload: { input: local } }]);
});

/** How many openings the plugin of this page has kept so far. The tests of this file are one page with one plugin:
 * its numbers go on from test to test, as the page's own do. */
let openingsKept = 0;

/** The plugin's side of the openings in a test: what waits and what it was asked, what a test sets, and how it keeps an opening. */
interface PluginOpenings {
  readonly waiting: OpenedEvent[];
  readonly asked: number[];
  fails: boolean;
  forgetful: boolean;
  held: Promise<void> | undefined;
  release: (() => void) | undefined;
  unanswered: number;
  mostUnanswered: number;
  readonly kept: number;
  readonly keep: (opening: OpenedEvent) => void;
  readonly opened: (opening: OpenedEvent) => Promise<void>;
  readonly hold: () => void;
}

/** How many openings a question to the plugin says the page has taken. The test fails when the question names no number. */
const openingsTaken = (payload: InvokeArgs | undefined): number => number(member(payload, 'taken'), 'how many openings the page has taken');

/**
 * The plugin's side of the openings, as `src/openings.rs` keeps them: `opened` keeps one and says so with the event;
 * the command lets go of the openings up to the number it is told and answers those that wait, with the number of
 * the newest. `waiting` is what waits when the test begins, and what an earlier test left is gone. `asked` lists
 * what each call said was taken. While `held` is set, an answer waits for `release`.
 */
function openingsOfThePlugin(waiting: readonly OpenedEvent[] = []): PluginOpenings {
  const plugin: PluginOpenings = {
    waiting: [...waiting], asked: [], fails: false, forgetful: false, held: undefined, release: undefined,
    unanswered: 0, mostUnanswered: 0,
    get kept() {
      return openingsKept;
    },
    keep: opening => {
      plugin.waiting.push(opening);
      openingsKept += 1;
    },
    opened: async opening => {
      plugin.keep(opening);
      await emit('live-activity://opened', opening);
      await settled();
    },
    /** Holds the answers back from now on, until `plugin.release()`. */
    hold: () => {
      plugin.held = new Promise(resolve => {
        plugin.release = () => {
          plugin.held = undefined;
          resolve();
        };
      });
    },
  };
  openingsKept += waiting.length;
  mockIPC(async (command, payload?: InvokeArgs) => {
    if (command !== 'plugin:live-activity|openings') return undefined;
    plugin.asked.push(openingsTaken(payload));
    if (plugin.fails) throw { code: 'NATIVE_ERROR', message: 'Operation could not be completed.' };
    // A forgetful plugin lets nothing go, which the real one never does: it answers what the page has handed over.
    const before = plugin.kept - plugin.waiting.length;
    if (!plugin.forgetful) plugin.waiting.splice(0, Math.max(0, Math.min(plugin.waiting.length, openingsTaken(payload) - before)));
    const answer = { openings: [...plugin.waiting], through: plugin.kept };
    plugin.unanswered += 1;
    plugin.mostUnanswered = Math.max(plugin.mostUnanswered, plugin.unanswered);
    try {
      if (plugin.held !== undefined) await plugin.held;
      return answer;
    } finally {
      plugin.unanswered -= 1;
    }
  }, { shouldMockEvents: true });
  return plugin;
}

/**
 * Lets the questions that a subscription or an event started run to their end: fifty turns of the event loop, each
 * of which runs every promise that is ready, however slow the machine. A question and its answer take a few.
 */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await new Promise(resolve => setImmediate(resolve));
}

// TP-EVENT-2
test('onOpened hands each opening from a notification to its handler until it is unsubscribed', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin();
  const openings: OpenedEvent[] = [];
  const unlisten = await activity.onOpened(event => openings.push(event));
  const byTheNotification = { activityId: layoutRecord.id, activityKey: layoutInput.activityKey };
  const byALink = { ...byTheNotification, actionId: 'link:1' };
  await plugin.opened(byTheNotification);
  await plugin.opened(byALink);
  await emit('live-activity://state', { ...byTheNotification, state: 'active' });
  await settled();
  assert.deepEqual(openings, [byTheNotification, byALink]);
  // What was handed over was let go: the plugin holds nothing of it.
  assert.deepEqual(plugin.waiting, []);

  await unlisten();
  await settled();
  await plugin.opened(byTheNotification);
  assert.equal(openings.length, 2);
  // What nobody heard still waits in the plugin, for the next that subscribes.
  assert.deepEqual(plugin.waiting, [byTheNotification]);
});

// TP-EVENT-3
test('onOpened hands over the openings that waited for the page, then each as it comes, once and in order', async t => {
  t.mock.method(console, 'warn', () => {});
  const launch = { activityId: 'la-1', activityKey: 'job:1', actionId: 'link:1' };
  const second = { activityId: 'la-1', activityKey: 'job:1' };
  // The opening that launched the app was reported before the page loaded: nothing heard its event.
  const plugin = openingsOfThePlugin([launch, second]);
  const openings: OpenedEvent[] = [];
  const unlisten = await activity.onOpened(event => openings.push(event));
  assert.deepEqual(openings, [launch, second]);
  // One question brought them and a second one told the plugin that they were handed over.
  assert.equal(plugin.asked.length, 2);
  assert.equal(plugin.asked[1], plugin.kept);
  assert.deepEqual(plugin.waiting, []);

  // Later ones come with their event, each once, also two that come at once.
  const third = { activityId: 'la-2' };
  const fourth = { activityId: 'la-2', actionId: 'link:2' };
  plugin.keep(third);
  plugin.keep(fourth);
  await Promise.all([emit('live-activity://opened', third), emit('live-activity://opened', fourth)]);
  await settled();
  assert.deepEqual(openings, [launch, second, third, fourth]);

  // The event says that an opening came and carries nothing the page trusts: what the plugin hands over counts.
  await emit('live-activity://opened', { activityId: 'not-kept' });
  await settled();
  assert.equal(openings.length, 4);

  // A question that fails loses nothing: the opening waits, and the next event brings both.
  plugin.fails = true;
  await plugin.opened({ activityId: 'la-3' });
  assert.equal(openings.length, 4);
  plugin.fails = false;
  await plugin.opened({ activityId: 'la-4' });
  assert.deepEqual(openings.slice(4), [{ activityId: 'la-3' }, { activityId: 'la-4' }]);
  assert.deepEqual(plugin.waiting, []);
  await unlisten();
  await settled();
});

// TP-EVENT-3
test('an opening that comes while the plugin is being asked is handed over once, after the ones before it', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin([{ activityId: 'la-1' }]);
  const openings: string[] = [];
  plugin.hold();
  const subscribing = activity.onOpened(event => openings.push(event.activityId));
  await settled();
  // The first answer, with la-1, is on its way. Two more openings come, each with its event.
  plugin.keep({ activityId: 'la-2' });
  await emit('live-activity://opened', { activityId: 'la-2' });
  plugin.keep({ activityId: 'la-3' });
  await emit('live-activity://opened', { activityId: 'la-3' });
  assert.deepEqual(openings, []);
  present(plugin.release)();
  const unlisten = await subscribing;
  await settled();
  assert.deepEqual(openings, ['la-1', 'la-2', 'la-3']);
  assert.deepEqual(plugin.waiting, []);
  // One question follows the other: the events that came meanwhile asked nothing until the first was answered.
  assert.equal(plugin.mostUnanswered, 1);
  assert.deepEqual(plugin.asked, [...plugin.asked].sort((a, b) => a - b));
  await unlisten();
  await settled();
});

// TP-EVENT-3
test('an opening that no handler got stays with the plugin, for the next handler', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin([{ activityId: 'la-1' }]);
  const heard: string[] = [];
  const leave = await activity.onOpened(event => heard.push(event.activityId));
  assert.deepEqual(heard, ['la-1']);

  // The handler leaves while the plugin's answer to an event is on its way: the answer finds nobody. A second
  // event came meanwhile, and its question waits behind the first.
  plugin.hold();
  plugin.keep({ activityId: 'la-2' });
  await emit('live-activity://opened', { activityId: 'la-2' });
  await emit('live-activity://opened', { activityId: 'la-2' });
  await settled();
  const asked = plugin.asked.length;
  await leave();
  present(plugin.release)();
  await settled();
  assert.deepEqual(heard, ['la-1']);
  assert.deepEqual(plugin.waiting, [{ activityId: 'la-2' }]);
  // With nobody to hand to and nothing to let go, the question that waited is not asked.
  assert.equal(plugin.asked.length, asked);
  // The next handler of the page gets it, and then the plugin lets it go.
  const later: string[] = [];
  const leaveLater = await activity.onOpened(event => {
    later.push(event.activityId);
    // From la-3 on, the page cannot tell the plugin what it has handed over, as when it is torn down right then.
    if (event.activityId === 'la-3') plugin.fails = true;
  });
  assert.deepEqual(later, ['la-2']);
  assert.deepEqual(plugin.waiting, []);

  // What was handed over but not let go stays with the plugin: the page that loads next hears it once more
  // (tests/api-reload.test.ts), and this page does not.
  await plugin.opened({ activityId: 'la-3' });
  assert.deepEqual(later, ['la-2', 'la-3']);
  assert.deepEqual(plugin.waiting, [{ activityId: 'la-3' }]);
  plugin.fails = false;
  await leaveLater();
  await settled();
});

// TP-EVENT-3
test('a page hears an opening once, also when its word that it handed it over did not reach the plugin', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin();
  const heard: string[] = [];
  const leave = await activity.onOpened(event => {
    heard.push(event.activityId);
    plugin.fails = true;
  });
  // The question that would have let la-1 go fails, so the plugin still holds it.
  await plugin.opened({ activityId: 'la-1' });
  assert.deepEqual(plugin.waiting, [{ activityId: 'la-1' }]);
  plugin.fails = false;
  // The next question says it again: la-1 is let go and not heard again, and la-2 is heard.
  await emit('live-activity://opened', { activityId: 'la-1' });
  await settled();
  assert.deepEqual(heard, ['la-1']);
  assert.deepEqual(plugin.waiting, []);
  await plugin.opened({ activityId: 'la-2' });
  assert.deepEqual(heard, ['la-1', 'la-2']);

  // A plugin that answered an opening again, which this page has handed over, would not have it heard twice.
  plugin.fails = false;
  plugin.forgetful = true;
  await plugin.opened({ activityId: 'la-3' });
  await emit('live-activity://opened', { activityId: 'la-3' });
  await settled();
  assert.deepEqual(heard, ['la-1', 'la-2', 'la-3']);
  await leave();
  await settled();
});

// TP-EVENT-3
test('a subscription stands once the plugin has answered, also when the page cannot say what it handed over', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin([{ activityId: 'la-1' }]);
  const heard: string[] = [];
  // The first question is answered and la-1 handed over; the second, which would let it go, fails.
  const leave = await activity.onOpened(event => {
    heard.push(event.activityId);
    if (event.activityId === 'la-1') plugin.fails = true;
  });
  assert.deepEqual(heard, ['la-1']);
  assert.deepEqual(plugin.waiting, [{ activityId: 'la-1' }]);
  // The handler is subscribed: the next opening reaches it, and the plugin is told of both.
  plugin.fails = false;
  await plugin.opened({ activityId: 'la-2' });
  assert.deepEqual(heard, ['la-1', 'la-2']);
  assert.deepEqual(plugin.waiting, []);
  await leave();
  await settled();
});

// TP-EVENT-3
test('a handler that another handler unsubscribes is handed nothing more, not even the opening at hand', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin();
  const heard: string[] = [];
  let leaveSecond: UnlistenFn;
  const leaveFirst = await activity.onOpened(event => {
    heard.push(`first ${event.activityId}`);
    leaveSecond();
  });
  leaveSecond = await activity.onOpened(event => heard.push(`second ${event.activityId}`));
  await plugin.opened({ activityId: 'la-1' });
  assert.deepEqual(heard, ['first la-1']);
  // A handler that leaves in its own callback, as the last one, ends the subscription: the next opening waits.
  const once: string[] = [];
  const leaveOnce = await activity.onOpened(event => {
    once.push(event.activityId);
    leaveOnce();
  });
  await leaveFirst();
  plugin.keep({ activityId: 'la-2' });
  plugin.keep({ activityId: 'la-3' });
  await emit('live-activity://opened', { activityId: 'la-2' });
  await settled();
  assert.deepEqual(once, ['la-2']);
  assert.deepEqual(plugin.waiting, [{ activityId: 'la-3' }]);
});

// TP-EVENT-3
test('the handlers of a page share the openings, and the last to leave ends the subscription', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin([{ activityId: 'la-1' }]);
  const first: OpenedEvent[] = [];
  const second: OpenedEvent[] = [];
  const leaveFirst = await activity.onOpened(event => first.push(event));
  // What waited went to the handler there was; one that subscribes later gets what is handed over from then on.
  const leaveSecond = await activity.onOpened(event => second.push(event));
  assert.deepEqual([first, second], [[{ activityId: 'la-1' }], []]);
  await plugin.opened({ activityId: 'la-2' });
  assert.deepEqual(first, [{ activityId: 'la-1' }, { activityId: 'la-2' }]);
  assert.deepEqual(second, [{ activityId: 'la-2' }]);
  // One subscription serves both handlers: an opening is two questions, one that brings it and one that lets it go.
  const asked = plugin.asked.length;
  await plugin.opened({ activityId: 'la-3' });
  assert.equal(plugin.asked.length, asked + 2);

  await leaveFirst();
  await leaveFirst();
  await plugin.opened({ activityId: 'la-4' });
  assert.equal(first.length, 3);
  assert.deepEqual(second.map(event => event.activityId), ['la-2', 'la-3', 'la-4']);

  // With nobody left the page asks nothing: the opening waits for the next handler.
  await leaveSecond();
  await settled();
  const idle = plugin.asked.length;
  await plugin.opened({ activityId: 'la-5' });
  assert.equal(plugin.asked.length, idle);
  const third: OpenedEvent[] = [];
  const leaveThird = await activity.onOpened(event => third.push(event));
  assert.deepEqual(third, [{ activityId: 'la-5' }]);
  // The subscription of the handlers that left is gone, not only idle: with it still there, an opening would be
  // three questions, the third from the listener that stayed.
  const again = plugin.asked.length;
  await plugin.opened({ activityId: 'la-6' });
  assert.equal(plugin.asked.length, again + 2);
  await leaveThird();
  await settled();
});

// TP-EVENT-3
test('a handler that throws keeps no opening from the other handlers or from itself later', async t => {
  t.mock.method(console, 'warn', () => {});
  const reported: unknown[] = [];
  t.mock.method(console, 'error', (error: unknown) => reported.push(member(error, 'message')));
  const plugin = openingsOfThePlugin([{ activityId: 'la-1' }, { activityId: 'la-2' }]);
  const heard: string[] = [];
  const leaveFaulty = await activity.onOpened(event => {
    heard.push(`faulty ${event.activityId}`);
    if (event.activityId === 'la-1') throw new Error('the handler failed');
  });
  const leaveSound = await activity.onOpened(event => heard.push(`sound ${event.activityId}`));
  // Both openings of the first answer reached the handler that threw at the first.
  assert.deepEqual(heard, ['faulty la-1', 'faulty la-2']);
  assert.deepEqual(reported, ['the handler failed']);
  await plugin.opened({ activityId: 'la-3' });
  assert.deepEqual(heard.slice(2), ['faulty la-3', 'sound la-3']);
  await leaveFaulty();
  await leaveSound();
  await settled();
});

// TP-EVENT-3
test('onOpened gives up its subscription when the plugin cannot be asked for the openings that wait', async t => {
  t.mock.method(console, 'warn', () => {});
  const plugin = openingsOfThePlugin([{ activityId: 'la-1' }]);
  plugin.fails = true;
  const openings: OpenedEvent[] = [];
  await assert.rejects(activity.onOpened(event => openings.push(event)), { code: 'NATIVE_ERROR' });
  // Nothing is subscribed: an event starts no question, and the opening still waits.
  const asked = plugin.asked.length;
  await emit('live-activity://opened', { activityId: 'la-1' });
  await settled();
  assert.equal(plugin.asked.length, asked);
  assert.deepEqual<OpenedEvent[]>(openings, []);
  plugin.fails = false;
  const leave = await activity.onOpened(event => openings.push(event));
  assert.deepEqual(openings, [{ activityId: 'la-1' }]);
  await leave();
  await settled();
});

// TP-PUSH-2, TP-PUSH-8
test('onPushToken and onPushToStartToken deliver the tokens the plugin holds first, each token once', async t => {
  t.mock.method(console, 'warn', () => {});
  const held = {
    pushToStart: 'ff00',
    activities: [{ activityId: 'la-1', activityKey: 'job:1', token: '01' }, { activityId: 'la-2', token: '02' }],
  };
  mockIPC(command => (command === 'plugin:live-activity|push_tokens' ? held : undefined), { shouldMockEvents: true });
  const tokens: string[] = [];
  const starts: string[] = [];
  await activity.onPushToken(event => tokens.push(`${event.activityId}:${event.token}`));
  await activity.onPushToStartToken(event => starts.push(event.token));
  assert.deepEqual(tokens, ['la-1:01', 'la-2:02']);
  assert.deepEqual(starts, ['ff00']);
  // The same token again is not delivered again; a changed one is.
  await emit('live-activity://push-token', { activityId: 'la-1', token: '01' });
  await emit('live-activity://push-token', { activityId: 'la-1', token: '11' });
  await emit('live-activity://push-to-start-token', { token: 'ff00' });
  await emit('live-activity://push-to-start-token', { token: 'ee00' });
  assert.deepEqual(tokens, ['la-1:01', 'la-2:02', 'la-1:11']);
  assert.deepEqual(starts, ['ff00', 'ee00']);
});

// TP-PUSH-8
test('a token that comes while the plugin is asked outranks the one it held', async t => {
  t.mock.method(console, 'warn', () => {});
  const held = { activities: [{ activityId: 'la-1', token: 'old' }, { activityId: 'la-2', token: '02' }] };
  let answer: (() => void) | undefined;
  mockIPC(command => (command === 'plugin:live-activity|push_tokens'
    ? new Promise(resolve => { answer = () => resolve(held); })
    : undefined), { shouldMockEvents: true });
  const tokens: string[] = [];
  const subscribing = activity.onPushToken(event => tokens.push(`${event.activityId}:${event.token}`));
  // The listener is up before the plugin is asked; an event now is newer than what the plugin holds.
  while (answer === undefined) await new Promise(resolve => setTimeout(resolve, 1));
  await emit('live-activity://push-token', { activityId: 'la-1', token: 'new' });
  answer();
  await subscribing;
  assert.deepEqual(tokens, ['la-1:new', 'la-2:02']);
});

// TP-PUSH-8
test('onPushToken gives its subscription up when the plugin cannot be asked for the tokens it holds', async t => {
  t.mock.method(console, 'warn', () => {});
  const refused = { code: 'NATIVE_ERROR', message: 'push_tokens not allowed' };
  mockIPC(command => (command === 'plugin:live-activity|push_tokens' ? Promise.reject(refused) : undefined), { shouldMockEvents: true });
  const tokens: (PushTokenEvent | PushToStartTokenEvent)[] = [];
  await assert.rejects(activity.onPushToken(event => tokens.push(event)), error => {
    assert.deepEqual(error, refused);
    return true;
  });
  await assert.rejects(activity.onPushToStartToken(event => tokens.push(event)));
  await emit('live-activity://push-token', { activityId: 'la-1', token: '01' });
  await emit('live-activity://push-to-start-token', { token: 'ff00' });
  assert.deepEqual(tokens, []);
});

test('onAction reports a refused subscription instead of pretending to listen', async () => {
  mockIPC(() => Promise.reject('event.listen not allowed'));
  await assert.rejects(activity.onAction(() => {}), error => {
    assert.equal(error, 'event.listen not allowed');
    return true;
  });
});

/** A case of the builders: its name, a call that builds a node, and the plain node that the call is to give. */
type BuiltNode = readonly [name: string, build: () => LayoutNode, expected: LayoutNode];

for (const [name, build, expected] of [
  ['vstack', () => layout.vstack([layout.text('a')]), { type: 'vstack', children: [{ type: 'text', value: 'a' }] }],
  ['vstack with options', () => layout.vstack([layout.divider()], { spacing: 6, alignment: 'leading', style: 'card', if: 'open' }),
    { type: 'vstack', children: [{ type: 'divider' }], spacing: 6, alignment: 'leading', style: 'card', if: 'open' }],
  ['hstack', () => layout.hstack([layout.spacer()]), { type: 'hstack', children: [{ type: 'spacer' }] }],
  ['hstack with options', () => layout.hstack([layout.spacer()], { spacing: 0, alignment: 'firstTextBaseline', unless: 'closed' }),
    { type: 'hstack', children: [{ type: 'spacer' }], spacing: 0, alignment: 'firstTextBaseline', unless: 'closed' }],
  ['zstack', () => layout.zstack([layout.symbol('timer')]), { type: 'zstack', children: [{ type: 'symbol', name: 'timer' }] }],
  ['zstack with options', () => layout.zstack([layout.symbol('timer')], { alignment: 'topLeading', style: 'card' }),
    { type: 'zstack', children: [{ type: 'symbol', name: 'timer' }], alignment: 'topLeading', style: 'card' }],
  ['spacer', () => layout.spacer(), { type: 'spacer' }],
  ['spacer with options', () => layout.spacer({ minLength: 0, if: 'wide' }), { type: 'spacer', minLength: 0, if: 'wide' }],
  ['divider', () => layout.divider(), { type: 'divider' }],
  ['divider with options', () => layout.divider({ style: 'rule', unless: 'compact' }), { type: 'divider', style: 'rule', unless: 'compact' }],
  ['text', () => layout.text(''), { type: 'text', value: '' }],
  ['text with options', () => layout.text('Pause', { style: 'title', if: 'running' }), { type: 'text', value: 'Pause', style: 'title', if: 'running' }],
  ['bound', () => layout.bound('title'), { type: 'text', bind: 'title' }],
  ['bound with options', () => layout.bound('note', { style: 'note', if: 'hasNote' }), { type: 'text', bind: 'note', style: 'note', if: 'hasNote' }],
  ['symbol', () => layout.symbol('timer'), { type: 'symbol', name: 'timer' }],
  ['symbol with options', () => layout.symbol('wifi', { rendering: 'hierarchical', variableBind: 'level', style: 'accent' }),
    { type: 'symbol', name: 'wifi', rendering: 'hierarchical', variableBind: 'level', style: 'accent' }],
  ['image', () => layout.image('logo'), { type: 'image', source: { asset: 'logo' } }],
  ['image with options', () => layout.image('logo', { resizable: false, contentMode: 'fill', style: 'icon' }),
    { type: 'image', source: { asset: 'logo' }, resizable: false, contentMode: 'fill', style: 'icon' }],
  ['image from a file', () => layout.image({ file: 'badge.png' }, { resizable: true }), { type: 'image', source: { file: 'badge.png' }, resizable: true }],
  ['image from an asset source', () => layout.image({ asset: 'logo' }), { type: 'image', source: { asset: 'logo' } }],
  ['custom', () => layout.custom('ring'), { type: 'custom', name: 'ring' }],
  ['custom with options', () => layout.custom('ring', { props: { level: layout.bind('bowl'), width: 3 }, style: 'art', if: 'shown' }),
    { type: 'custom', name: 'ring', props: { level: { bind: 'bowl' }, width: 3 }, style: 'art', if: 'shown' }],
  ['path', () => layout.path('M0 0L10 10', [24, 24]), { type: 'path', d: 'M0 0L10 10', box: [24, 24] }],
  ['path with options', () => layout.path('M0 0L10 10', [24, 12], { stroke: 1.5, style: 'accent' }),
    { type: 'path', d: 'M0 0L10 10', box: [24, 12], stroke: 1.5, style: 'accent' }],
  ['progress', () => layout.progress('done'), { type: 'progress', bind: 'done' }],
  ['progress with options', () => layout.progress('done', { kind: 'circular', style: 'bar' }), { type: 'progress', bind: 'done', kind: 'circular', style: 'bar' }],
  ['gauge', () => layout.gauge('level'), { type: 'gauge', bind: 'level' }],
  ['gauge with options', () => layout.gauge('level', { min: 0, max: 10, kind: 'linear', unless: 'idle' }),
    { type: 'gauge', bind: 'level', min: 0, max: 10, kind: 'linear', unless: 'idle' }],
  ['timerText', () => layout.timerText('from', 'to'), { type: 'timerText', start: 'from', end: 'to' }],
  ['timerText with options', () => layout.timerText('from', 'to', { countsDown: false, style: 'digits' }),
    { type: 'timerText', start: 'from', end: 'to', countsDown: false, style: 'digits' }],
  ['button', () => layout.button('focus.pause', layout.text('Pause')), { type: 'button', actionId: 'focus.pause', child: { type: 'text', value: 'Pause' } }],
  ['button with options', () => layout.button('focus.pause', layout.text('Pause'), { style: 'action', unless: 'paused' }),
    { type: 'button', actionId: 'focus.pause', child: { type: 'text', value: 'Pause' }, style: 'action', unless: 'paused' }],
  ['link', () => layout.link('myapp://delivery/7', layout.text('Open')), { type: 'link', url: 'myapp://delivery/7', child: { type: 'text', value: 'Open' } }],
  ['link with a bound url and options', () => layout.link(layout.bind('target'), layout.symbol('map'), { style: 'action', if: 'tracked' }),
    { type: 'link', url: { bind: 'target' }, child: { type: 'symbol', name: 'map' }, style: 'action', if: 'tracked' }],
  ['toggle', () => layout.toggle('mute', 'muted', layout.text('Mute')),
    { type: 'toggle', actionId: 'mute', bind: 'muted', child: { type: 'text', value: 'Mute' } }],
  ['toggle with options', () => layout.toggle('mute', 'muted', layout.text('Mute'), { style: 'switch', unless: 'locked' }),
    { type: 'toggle', actionId: 'mute', bind: 'muted', child: { type: 'text', value: 'Mute' }, style: 'switch', unless: 'locked' }],
  ['text for stale content that slides in', () => layout.text('No signal', { ifStale: true, transition: 'slide' }),
    { type: 'text', value: 'No signal', ifStale: true, transition: 'slide' }],
  ['bound text that is private', () => layout.bound('total', { privacy: 'sensitive', ifStale: false }), { type: 'text', bind: 'total', privacy: 'sensitive', ifStale: false }],
  ['progress with what assistive technologies read', () => layout.progress('done', { accessibility: { label: 'Delivery', value: layout.bind('percent'), hint: 'Opens the app' } }),
    { type: 'progress', bind: 'done', accessibility: { label: 'Delivery', value: { bind: 'percent' }, hint: 'Opens the app' } }],
  ['symbol hidden from assistive technologies', () => layout.symbol('sparkles', { accessibility: { hidden: true } }),
    { type: 'symbol', name: 'sparkles', accessibility: { hidden: true } }],
] satisfies readonly BuiltNode[]) {
  test(`layout builds a plain ${name} node with exactly the members it was given`, () => {
    assert.deepEqual(build(), expected);
  });
}

// TP-JS-6
test('layout.bind writes the binding of a style member and nothing else', () => {
  assert.deepEqual(layout.bind('tone'), { bind: 'tone' });
  assert.deepEqual(Object.keys(layout.bind('')), ['bind']);
  assert.notEqual(layout.bind('tone'), layout.bind('tone'));
});

// TP-JS-6
test('every layout builder takes the members any node may carry', () => {
  const common = deepFreeze({
    style: 'card', unless: 'hidden', ifStale: false, ifFullscreen: true, accessibility: { label: 'Mochi', value: layout.bind('mood') },
    transition: 'moveTop', privacy: 'sensitive',
  } as const);
  const child = layout.text('a');
  const built = {
    vstack: layout.vstack([child], common), hstack: layout.hstack([child], common), zstack: layout.zstack([child], common),
    spacer: layout.spacer(common), divider: layout.divider(common), text: layout.text('a', common), bound: layout.bound('title', common),
    symbol: layout.symbol('timer', common), image: layout.image('logo', common), path: layout.path('M0 0L1 1', [8, 8], common),
    progress: layout.progress('done', common), gauge: layout.gauge('level', common), timerText: layout.timerText('from', 'to', common),
    button: layout.button('pet', child, common), link: layout.link('app://a', child, common), toggle: layout.toggle('mute', 'muted', child, common),
    custom: layout.custom('ring', common),
  };
  assert.deepEqual(Object.keys(built).sort(), Object.keys(layout).filter(name => name !== 'bind').sort());
  for (const [name, node] of Object.entries<JsonObject>(built)) {
    assert.deepEqual(Object.fromEntries(Object.keys(common).map(member => [member, node[member]])), common, name);
  }
  // A member that is undefined is left out, as any option.
  assert.deepEqual(layout.link('app://a', child, unchecked<Parameters<typeof layout.link>[2]>({ ifStale: undefined, accessibility: undefined })), { type: 'link', url: 'app://a', child });
  assert.deepEqual(layout.toggle('mute', 'muted', child, unchecked<Parameters<typeof layout.toggle>[3]>({ transition: undefined })), { type: 'toggle', actionId: 'mute', bind: 'muted', child });
});

// TP-JS-6
test('layout builders omit options that were not given or are undefined', () => {
  assert.deepEqual(Object.keys(layout.vstack([])), ['type', 'children']);
  assert.deepEqual(layout.spacer({}), { type: 'spacer' });
  assert.deepEqual(layout.spacer(undefined), { type: 'spacer' });
  assert.deepEqual(layout.text('a', unchecked<Parameters<typeof layout.text>[1]>({ style: undefined, if: 'shown' })), { type: 'text', value: 'a', if: 'shown' });
  assert.deepEqual(layout.gauge('level', unchecked<Parameters<typeof layout.gauge>[1]>({ min: 0, max: undefined })), { type: 'gauge', bind: 'level', min: 0 });
});

test('layout builders do not validate and leave their arguments unchanged', () => {
  const child: LayoutNode = deepFreeze({ type: 'text', value: 'Pause' });
  const children = deepFreeze([child, { type: 'unknown' }]);
  const options = deepFreeze({ spacing: 999, style: 'card' });
  const box = deepFreeze([0, 4096] as const);
  const serialized = JSON.stringify({ child, children, options, box });

  for (const type of ['vstack', 'hstack', 'zstack'] as const) {
    const node = layout[type](unchecked<readonly LayoutNode[]>(children), options);
    assert.deepEqual(node, { type, children: [{ type: 'text', value: 'Pause' }, { type: 'unknown' }], spacing: 999, style: 'card' });
    assert.notEqual(node, options);
  }
  assert.deepEqual(layout.path('not a path', box, deepFreeze({ stroke: -1 })), { type: 'path', d: 'not a path', box: [0, 4096], stroke: -1 });
  assert.deepEqual(layout.button('', child, options), { type: 'button', actionId: '', child: { type: 'text', value: 'Pause' }, spacing: 999, style: 'card' });
  assert.deepEqual(layout.text('a', unchecked<Parameters<typeof layout.text>[1]>(deepFreeze({ bind: 'both' }))), { type: 'text', value: 'a', bind: 'both' });
  assert.equal(JSON.stringify({ child, children, options, box }), serialized);
});

// The shared layout fixtures, as far as this layer goes: it sends every request as written, leaves
// the verdict to the plugin, and its builders can write every valid layout. A fixture's request is JSON, valid or
// invalid on purpose: each command takes it unchecked, as the request that it takes.
const send: Readonly<Record<string, (request: unknown) => Promise<unknown>>> = {
  start: request => activity.start(unchecked<StartInput>(request)),
  update: request => activity.update(unchecked<UpdateInput>(request)),
  start_layout: request => activity.startLayout(unchecked<LayoutStartInput>(request)),
  update_layout: request => activity.updateLayout(unchecked<LayoutUpdateInput>(request)),
  end_layout: request => activity.endLayout(unchecked<LayoutEndInput>(request)),
};
const starts = layoutFixtures.valid.filter(({ command }) => command === 'start_layout');
const each = async <Fixture extends NamedFixture>(cases: readonly Fixture[], check: (fixture: Fixture) => void | Promise<void>): Promise<void> => {
  for (const fixture of cases) {
    try {
      await check(fixture);
    } catch (cause) {
      throw new Error(`fixture: ${fixture.name}`, { cause });
    }
  }
};

// TP-JS-1
test('sends every valid layout fixture to its command unchanged', async () => {
  const commands = new Set(layoutFixtures.valid.map(({ command }) => command));
  for (const command of ['start_layout', 'update_layout', 'end_layout']) assert.ok(commands.has(command), `no valid fixture for ${command}`);
  await each(layoutFixtures.valid, async ({ command, input }) => {
    const request = deepFreeze(structuredClone(input));
    const reply = { ...layoutRecord, state: command === 'end_layout' ? 'ended' : 'active' };
    const calls: NativeCall[] = [];
    mockIPC((nativeCommand, payload?: InvokeArgs) => {
      calls.push({ nativeCommand, payload });
      return reply;
    });
    assert.deepEqual(await present(send[command], `a way to send ${command}`)(request), reply);
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: { input } }]);
  });
});

test('sends every invalid layout fixture unchanged and reports the code of its rejection', async () => {
  // Left to the validators: fixtures whose command this API cannot send with an input.
  const sendable = layoutFixtures.invalid.filter(({ command }) => Object.hasOwn(send, command));
  assert.notEqual(sendable.length, 0);
  await each(sendable, async ({ command, input, code }) => {
    const request = deepFreeze(structuredClone(input));
    const expected = { code, message: 'Operation could not be completed.' };
    const calls: NativeCall[] = [];
    mockIPC((nativeCommand, payload?: InvokeArgs) => {
      calls.push({ nativeCommand, payload });
      return Promise.reject(expected);
    });
    await assert.rejects(present(send[command], `a way to send ${command}`)(request), error => {
      assert.deepEqual(error, expected);
      return true;
    });
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: { input } }]);
  });
});

/** A builder as the rebuilder calls it: with the members of a fixture's node, which are JSON. */
type FixtureBuilder = (...given: readonly unknown[]) => unknown;
/** Writes a node of a fixture again. */
type Rebuild = (node: unknown) => unknown;
/** Writes the binding of a value key. */
type Bind = (key: string) => unknown;

// Writes a fixture node again through the builders: its members become the builder's arguments, and a bound
// member of its accessibility is written again with `bind`.
const rebuilder = (builders: Readonly<Record<string, FixtureBuilder>>): Rebuild => {
  const common = ({ accessibility, ...members }: JsonObject): JsonObject => ({
    ...members, ...(isRecord(accessibility) && { accessibility: mapValues(accessibility, member => rebind(member, present(builders.bind))) }),
  });
  const rebuild: Rebuild = node => {
    const { type, ...members } = jsonObject(node, 'a node');
    return present(table[type === 'text' && 'bind' in members ? 'bound' : text(type, 'the type of a node')])(common(members));
  };
  const table: Readonly<Record<string, (members: JsonObject) => unknown>> = {
    vstack: ({ children, ...options }) => present(builders.vstack)(list(children).map(rebuild), options),
    hstack: ({ children, ...options }) => present(builders.hstack)(list(children).map(rebuild), options),
    zstack: ({ children, ...options }) => present(builders.zstack)(list(children).map(rebuild), options),
    spacer: options => present(builders.spacer)(options),
    divider: options => present(builders.divider)(options),
    text: ({ value, ...options }) => present(builders.text)(value, options),
    bound: ({ bind, ...options }) => present(builders.bound)(bind, options),
    symbol: ({ name, ...options }) => present(builders.symbol)(name, options),
    image: ({ source, ...options }) => present(builders.image)('asset' in jsonObject(source) ? member(source, 'asset') : { file: member(source, 'file') }, options),
    custom: ({ name, props, ...options }) => present(builders.custom)(name, {
      ...options, ...(isRecord(props) && { props: mapValues(props, prop => rebind(prop, present(builders.bind))) }),
    }),
    path: ({ d, box, ...options }) => present(builders.path)(d, box, options),
    progress: ({ bind, ...options }) => present(builders.progress)(bind, options),
    gauge: ({ bind, ...options }) => present(builders.gauge)(bind, options),
    timerText: ({ start, end, ...options }) => present(builders.timerText)(start, end, options),
    button: ({ actionId, child, ...options }) => present(builders.button)(actionId, rebuild(child), options),
    link: ({ url, child, ...options }) => present(builders.link)(rebind(url, present(builders.bind)), rebuild(child), options),
    toggle: ({ actionId, bind, child, ...options }) => present(builders.toggle)(actionId, bind, rebuild(child), options),
  };
  return rebuild;
};
const mapValues = <Value, Mapped>(object: Readonly<Record<string, Value>>, map: (value: Value, key: string) => Mapped): Record<string, Mapped> =>
  Object.fromEntries(Object.entries(object).map(([key, value]) => [key, map(value, key)]));
// A bound member is written again with `bind`, a literal as it is.
const rebind = (member: unknown, bind: Bind): unknown => (isRecord(member) && 'bind' in member ? bind(text(member.bind, 'the key of a binding')) : member);
// The options of the island are no nodes: they are written as they are.
const ISLAND_OPTIONS = ['priority', 'belowIfTooWide', 'margins'];
const rebuildParts = (parts: JsonObject, rebuild: Rebuild): JsonObject => mapValues(parts, (part, key) => {
  if (ISLAND_OPTIONS.includes(key)) return part;
  return key === 'expanded' ? rebuildParts(jsonObject(part, 'the expanded part of an island'), rebuild) : rebuild(part);
});
// The two tints and the url are literals or bound.
const rebuildLayout = ({ lockScreen, island, ...bindable }: JsonObject, rebuild: Rebuild, bind: Bind): JsonObject => ({
  lockScreen: rebuild(lockScreen),
  ...(isRecord(island) && { island: rebuildParts(island, rebuild) }),
  ...mapValues(bindable, member => rebind(member, bind)),
});
const rebuildStyles = (styles: JsonObject, bind: Bind): JsonObject => mapValues(styles, style => mapValues(jsonObject(style, 'a style'), member => rebind(member, bind)));

test('layout builders reproduce every node of every valid fixture layout', async () => {
  const used = new Set<string>();
  // A builder is typed, and what it is given here is the JSON of a fixture's node: it takes that unchecked.
  const rebuild = rebuilder(mapValues(layout, (build, name) => (...given: readonly unknown[]) => {
    used.add(name);
    return unchecked<FixtureBuilder>(build)(...given);
  }));
  const bind = (key: string): LayoutBound => {
    used.add('bind');
    return layout.bind(key);
  };
  await each(starts, ({ input }) => {
    assert.deepEqual(rebuildLayout(jsonObject(input.layout, 'the layout of a start'), rebuild, bind), input.layout);
    if (input.styles) assert.deepEqual(rebuildStyles(jsonObject(input.styles, 'the styles of a start'), bind), input.styles);
  });
  assert.deepEqual([...used].sort(), Object.keys(layout).sort());
});

test('sends the start and the update of every update fixture unchanged', async () => {
  assert.notEqual(layoutFixtures.updates.length, 0);
  await each(layoutFixtures.updates, async ({ start, update }) => {
    const calls: NativeCall[] = [];
    mockIPC((nativeCommand, payload?: InvokeArgs) => {
      calls.push({ nativeCommand, payload });
      return layoutRecord;
    });
    await activity.startLayout(unchecked<LayoutStartInput>(deepFreeze(structuredClone(start))));
    await activity.updateLayout(unchecked<LayoutUpdateInput>(deepFreeze(structuredClone(update))));
    assert.deepEqual(calls, [
      { nativeCommand: 'plugin:live-activity|start_layout', payload: { input: start } },
      { nativeCommand: 'plugin:live-activity|update_layout', payload: { input: update } },
    ]);
  });
});

test('layout.bind writes the styles of the fixture that accepts every bindable style member bound at once', () => {
  const { bind } = layout;
  const named = starts.find(candidate => candidate.name === 'accepts every bindable style member bound at once');
  assert.deepEqual({
    s: {
      size: bind('size'), weight: bind('weight'), color: bind('tone'), background: bind('fill'), cornerRadius: bind('radius'),
      opacity: bind('alpha'), tint: bind('accent'),
    },
  }, present(named, 'the fixture of that name').input.styles);
});

/** A layout of the fixtures: the name of its fixture, and the layout as the builders write it. */
type WrittenLayout = readonly [name: string, build: (builders: typeof layout) => Layout];

for (const [name, build] of [
  ['starts a session layout with styles, an island, conditions and a button', ({ vstack, hstack, symbol, bound, spacer, timerText, progress, button, text }) => ({
    lockScreen: vstack([
      hstack([
        symbol('timer', { rendering: 'hierarchical', style: 'accent' }),
        bound('title', { style: 'title' }),
        spacer(),
        timerText('from', 'to', { style: 'digits' }),
      ], { spacing: 8, alignment: 'center' }),
      progress('progress', { kind: 'linear', style: 'bar' }),
      bound('note', { style: 'note', if: 'hasNote' }),
      button('session.pause', text('Pause'), { style: 'action', unless: 'paused' }),
    ], { spacing: 6, alignment: 'leading', style: 'card' }),
    island: {
      expanded: {
        leading: symbol('timer', { style: 'accent' }),
        trailing: timerText('from', 'to', { style: 'digits' }),
        center: bound('title', { style: 'title' }),
        bottom: progress('progress', { style: 'bar' }),
      },
      compactLeading: symbol('timer', { style: 'accent' }),
      compactTrailing: timerText('from', 'to', { style: 'digits' }),
      minimal: symbol('timer'),
    },
    background: { light: '#FFFFFF', dark: '#111111' },
    keyline: 'accent',
  })],
  ['accepts one value read by several nodes', ({ vstack, bound, progress, gauge, symbol, text }) => ({
    lockScreen: vstack([bound('p'), progress('p'), gauge('p'), symbol('wifi', { variableBind: 'p' }), text('a', { if: 'p' })]),
  })],
  ['accepts 3 nodes in each compact region and 2 in the minimal region', ({ hstack, zstack, symbol, text }) => ({
    lockScreen: text('a'),
    island: {
      compactLeading: hstack([symbol('star.fill'), text('1')]),
      compactTrailing: hstack([text('2'), text('m')]),
      minimal: zstack([symbol('star.fill')]),
    },
  })],
  ['accepts resizable images in both content modes', ({ hstack, image }) => ({
    lockScreen: hstack([image('logo', { resizable: true, contentMode: 'fit' }), image('logo', { resizable: false, contentMode: 'fill' })]),
  })],
  ['accepts the smallest and the largest stroke width', ({ hstack, path }) => ({
    lockScreen: hstack([path('M0 0L10 10', [24, 24], { stroke: 0.5 }), path('M0 0L10 10', [24, 24], { stroke: 16 })]),
  })],
  ['accepts a divider', ({ vstack, divider, text }) => ({ lockScreen: vstack([text('a'), divider(), text('b')]) })],
  ['starts a layout with a url and links on the lock screen and in an expanded region', ({ vstack, text, link, symbol }) => ({
    lockScreen: vstack([text('Recording'), link('https://example.com/a?b=c&d=%20#frag', text('Open'))]),
    island: { expanded: { bottom: link('app://rec/1/stop', symbol('stop.fill')) } },
    url: 'app://rec/1',
  })],
  ['starts a layout whose url and link are bound to a text value', ({ link, text, bind }) => ({
    lockScreen: link(bind('target'), text('Open')), url: bind('target'),
  })],
  ['starts a layout with a toggle on the lock screen and in an expanded region', ({ vstack, text, toggle, symbol }) => ({
    lockScreen: vstack([text('Recorder'), toggle('mute', 'muted', text('Mute'))]),
    island: { expanded: { bottom: toggle('island.mute', 'muted', symbol('mic.slash')) } },
  })],
  ['starts a layout whose nodes say what assistive technologies read', ({ vstack, symbol, progress, divider, bound, bind }) => ({
    lockScreen: vstack([
      symbol('mic.fill', { accessibility: { label: 'Recording' } }),
      progress('level', { accessibility: { label: bind('title'), value: bind('level'), hint: 'Input level' } }),
      divider({ accessibility: { hidden: true } }),
      bound('title', { accessibility: { hidden: false } }),
    ], { accessibility: { label: 'Recorder' } }),
    island: { minimal: symbol('mic.fill', { accessibility: { label: 'Recording' } }) },
  })],
  ['starts a layout with nodes for stale and for fresh content', ({ vstack, text, divider, symbol }) => ({
    lockScreen: vstack([
      text('Live', { ifStale: false }), text('Waiting for an update', { ifStale: true, transition: 'opacity' }), divider({ if: 'live', ifStale: false }),
    ]),
    island: { minimal: symbol('clock', { ifStale: true }) },
  })],
  ['starts a layout with a transition, a content transition and a sensitive node', ({ vstack, bound, text }) => ({
    lockScreen: vstack([bound('total', { style: 'digits', privacy: 'sensitive' }), text('Paid', { if: 'paid', transition: 'pushBottom' })]),
  })],
  ['starts an island with priorities, a placement below the camera and margins', ({ text, divider }) => ({
    lockScreen: text('a'),
    island: {
      expanded: {
        leading: divider(), trailing: divider(), center: divider(), bottom: divider(),
        priority: { leading: 1, trailing: 0.5, center: 100, bottom: 0 }, belowIfTooWide: ['leading', 'trailing'],
      },
      compactLeading: divider(),
      margins: { expanded: 8, compactLeading: [0, 4, 0, 4], compactTrailing: 64, minimal: 0 },
    },
  })],
] satisfies readonly WrittenLayout[]) {
  test(`layout builders write the layout of the fixture that ${name}`, () => {
    const built = build(layout);
    const named = starts.find(candidate => candidate.name === name);
    if (named) assert.deepEqual(built, named.input.layout);
    // A renamed fixture still counts while some valid fixture holds exactly this layout.
    else assert.ok(starts.some(({ input }) => isDeepStrictEqual(input.layout, built)), 'no valid fixture holds this layout');
  });
}

// TP-JS-4
test('endLayout sends the final content of an end unchanged', async () => {
  const end = Object.freeze({
    id: 'opaque-native-handle', policy: Object.freeze({ kind: 'after', at: 1_790_000_000_000 }),
    snapshot: Object.freeze({ revision: 3, values: Object.freeze({ status: 'Delivered' }), timestamp: 1_790_000_000_000 }),
  });
  const calls: NativeCall[] = [];
  mockIPC((nativeCommand, payload?: InvokeArgs) => {
    calls.push({ nativeCommand, payload });
    return { id: end.id, state: 'ended' };
  });
  assert.deepEqual(await activity.endLayout(end), { id: end.id, state: 'ended' });
  await activity.endLayout({ id: end.id, policy: { kind: 'immediate' } });
  assert.deepEqual(calls, [
    { nativeCommand: 'plugin:live-activity|end_layout', payload: { input: end } },
    { nativeCommand: 'plugin:live-activity|end_layout', payload: { input: { id: end.id, policy: { kind: 'immediate' } } } },
  ]);
});

// TP-JS-5
test('the declarations follow the contract of 0.6', async () => {
  const { readFile } = await import('node:fs/promises');
  const types = await readFile(new URL('../dist-js/types.d.ts', import.meta.url), 'utf8');
  const index = await readFile(new URL('../dist-js/index.d.ts', import.meta.url), 'utf8');
  assert.match(types, /export type ActivityState = 'pending' \| 'active' \| 'stale' \| 'ended' \| 'dismissed' \| 'unknown';/);
  assert.match(types, /'NOT_FOREGROUND'/);
  assert.match(types, /export interface LayoutSnapshot \{[^}]*readonly timestamp\?: number;/s);
  assert.match(types, /export interface LayoutEndInput extends EndInput \{\s*readonly snapshot\?: LayoutSnapshot;\s*\}/);
  assert.match(index, /export declare function endLayout\(input: LayoutEndInput\): Promise<LayoutActivityRecord>;/);
  // iOS sends the caller's revision (TP-IOS-3); 0.5.0-dev numbered them, and no comment may say so.
  assert.doesNotMatch(types, /numbers the revisions|record's plus one/);
  // 0.6: pushes.
  assert.match(types, /export type LayoutPush = 'token' \| \{\s*readonly channel: string;\s*\};/);
  assert.match(types, /export interface LayoutStartInput \{[\s\S]*?readonly push\?: LayoutPush;\s*\}/);
  assert.match(types, /export interface Permissions \{[^}]*readonly frequentPushes: PermissionState;/s);
  assert.match(types, /export interface Capabilities \{[^}]*readonly push: FeatureSupport;/s);
  for (const name of ['PushTokenEvent', 'PushToStartTokenEvent', 'UpdatedEvent', 'PushTokens']) {
    assert.match(types, new RegExp(`export interface ${name} \\{`), name);
  }
  assert.match(index, /export declare function pushTokens\(\): Promise<PushTokens>;/);
  for (const name of ['onPushToken', 'onPushToStartToken', 'onUpdated']) {
    assert.match(index, new RegExp(`export declare function ${name}\\(handler: \\(event: \\w+\\) => void\\): Promise<UnlistenFn>;`), name);
  }
  // The events of an activity's life and of the permissions.
  for (const name of ['StartedEvent', 'StateEvent']) {
    assert.match(types, new RegExp(`export interface ${name} \\{`), name);
  }
  for (const name of ['onStarted', 'onState']) {
    assert.match(index, new RegExp(`export declare function ${name}\\(handler: \\(event: \\w+\\) => void\\): Promise<UnlistenFn>;`), name);
  }
  assert.match(index, /export declare function onPermissions\(handler: \(permissions: Permissions\) => void\): Promise<UnlistenFn>;/);
});

// The declarations beside the layout fixtures: a module that the compiler checks, written outside the checkout.
const root = fileURLToPath(new URL('..', import.meta.url));
const written = mkdtempSync(join(tmpdir(), 'layout-declarations-'));
after(() => rmSync(written, { recursive: true, force: true }));
const compileModule = (name: string, source: string): SpawnSyncReturns<string> => {
  const file = join(written, `${name}.mts`);
  writeFileSync(file, `import type * as plugin from ${JSON.stringify(join(root, 'dist-js/index.js'))};\n${source}`);
  return spawnSync(join(root, 'node_modules/.bin/tsc'), [
    '--ignoreConfig', '--noEmit', '--pretty', 'false', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck',
    '--target', 'ES2021', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file,
  ], { encoding: 'utf8' });
};

// TP-JS-5
test('the declarations take every valid layout fixture and the members beside the schema, and refuse what the contract refuses of the new ones', () => {
  const inputs = (command: string): JsonObject[] => layoutFixtures.valid.filter(fixture => fixture.command === command).map(({ input }) => input);
  const accepted = <Fixture extends { readonly code: unknown }>(given: readonly Fixture[]): Fixture[] => given.filter(({ code }) => code === undefined);
  const typed = (name: string, type: string, values: readonly unknown[]): string => `export const ${name}: readonly plugin.${type}[] = ${JSON.stringify(values, null, 1)};\n`;
  const alert = { title: 'Your ride', body: 'It starts now', sound: 'chime.aiff' };
  const taken = compileModule('taken', [
    typed('starts', 'LayoutStartInput', [
      ...inputs('start_layout'), ...layoutFixtures.updates.map(({ start }) => start), ...layoutFixtures.ends.map(({ start }) => start),
      // What the liveactivity crate takes with a start beside activitykit's schema.
      { ...layoutInput, ios: { transient: true }, scheduled: { at: 1_900_000_000_000, alert }, push: 'token' },
    ]),
    typed('updates', 'LayoutUpdateInput', [...inputs('update_layout'), ...accepted(layoutFixtures.updates).map(({ update }) => update), { ...layoutUpdate, alert }]),
    typed('ends', 'LayoutEndInput', [...inputs('end_layout'), ...accepted(layoutFixtures.ends).map(({ end }) => end)]),
    // A region for a paired Apple Watch and CarPlay: one node, as the Lock Screen's.
    typed('layouts', 'Layout', [{ lockScreen: { type: 'text', value: 'a' }, small: { type: 'hstack', children: [{ type: 'text', value: 'a' }] } }]),
  ].join(''));
  assert.equal(taken.status, 0, taken.stdout + taken.stderr);

  // Each line below must be an error: the compiler reports an expectation that nothing meets.
  const refused = compileModule('refused', `
const child: plugin.LayoutNode = { type: 'text', value: 'a' };
type Start = Pick<plugin.LayoutStartInput, 'ios' | 'scheduled'>;
// @ts-expect-error a link needs its url
export const a: plugin.LayoutNode = { type: 'link', child };
// @ts-expect-error a toggle needs the key of its flag
export const b: plugin.LayoutNode = { type: 'toggle', actionId: 'mute', child };
// @ts-expect-error a url is no member of a button
export const c: plugin.LayoutNode = { type: 'button', actionId: 'pet', child, url: 'app://a' };
// @ts-expect-error a hidden node says nothing else
export const d: plugin.LayoutNode = { type: 'divider', accessibility: { hidden: true, label: 'a' } };
// @ts-expect-error a transition is one of the ten
export const e: plugin.LayoutNode = { type: 'divider', transition: 'fade' };
// @ts-expect-error privacy is sensitive or absent
export const f: plugin.LayoutNode = { type: 'divider', privacy: 'public' };
// @ts-expect-error a stale condition is a boolean, and no value key
export const g: plugin.LayoutNode = { type: 'divider', ifStale: 'stale' };
// @ts-expect-error only the regions beside the camera go below it
export const h: plugin.LayoutIslandExpanded = { center: child, belowIfTooWide: ['center'] };
// @ts-expect-error margins are a padding: one number or four
export const i: plugin.LayoutIslandMargins = { minimal: [1, 2, 3] };
// @ts-expect-error a content transition is one of the five
export const j: plugin.LayoutStyle = { contentTransition: 'roll' };
// @ts-expect-error the options of iOS say whether the activity is transient
export const k: Start = { ios: {} };
// @ts-expect-error a scheduled start has its alert
export const l: Start = { scheduled: { at: 1 } };
// @ts-expect-error the sound of an alert is a file name
export const m: plugin.LayoutAlert = { title: 'a', body: 'b', sound: 1 };
// @ts-expect-error the small region is one node, as the Lock Screen's
export const n: plugin.Layout = { lockScreen: child, small: [child] };
// @ts-expect-error the small region has no parts, unlike the island
export const o: plugin.Layout = { lockScreen: child, small: { minimal: child } };
`);
  assert.equal(refused.status, 0, refused.stdout + refused.stderr);
  // The compiler does check the modules: a member that no declaration names fails.
  const unknown = compileModule('unknown', typed('starts', 'LayoutStartInput', [{ ...layoutInput, layout: { ...layoutInput.layout, deepLink: 'app://a' } }]));
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout, /error TS2353: .*deepLink.* does not exist in type 'Layout'/);
});
