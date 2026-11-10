import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import fixtures from './fixtures/layout-requests.json' with { type: 'json' };
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

// TP-JS-2
test('writeImage sends the name and the bytes of a Uint8Array or an ArrayBuffer', async () => {
  const calls = [];
  mockIPC((nativeCommand, payload) => {
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
const deepFreeze = value => {
  if (typeof value === 'object' && value !== null) Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};

const values = { title: 'Focus', progress: 0.25, paused: false };
const layoutInput = deepFreeze({
  activityKey: 'focus:1', schemaVersion: 2, fallback: 'notification',
  layout: { lockScreen: { type: 'vstack', spacing: 6, children: [
    { type: 'text', bind: 'title', style: 'title' },
    { type: 'progress', bind: 'progress' },
    { type: 'button', actionId: 'focus.pause', unless: 'paused', child: { type: 'text', value: 'Pause' } },
  ] } },
  styles: { title: { font: 'headline', lineLimit: 1 } },
  snapshot: { revision: 0, values, staleAt: 1_790_000_900_000 },
});
const layoutRecord = deepFreeze({ id: 'opaque-layout-handle', activityKey: layoutInput.activityKey, schemaVersion: 2, snapshot: layoutInput.snapshot, backend: 'activityKit', state: 'active', visibility: 'unknown', degradedFeatures: [], promotionRequested: false, promotionState: 'notApplicable' });
const layoutUpdate = deepFreeze({ id: layoutRecord.id, snapshot: { revision: 1, values: { ...values, progress: 0.5 } } });
const layoutEnd = deepFreeze({ id: layoutRecord.id, policy: { kind: 'immediate' } });

for (const [name, command, args, result] of [
  ['startLayout', 'start_layout', [layoutInput], layoutRecord],
  ['updateLayout', 'update_layout', [layoutUpdate], { ...layoutRecord, snapshot: layoutUpdate.snapshot }],
  ['endLayout', 'end_layout', [layoutEnd], { ...layoutRecord, state: 'ended' }],
  ['listLayout', 'list_layout', [], [layoutRecord]],
]) {
  test(`${name} invokes the namespaced command with its public arguments`, async () => {
    const expectedPayload = args.length === 0 ? {} : { input: structuredClone(args[0]) };
    const calls = [];
    mockIPC((nativeCommand, payload) => {
      calls.push({ nativeCommand, payload });
      return result;
    });
    assert.deepEqual(await activity[name](...args), result);
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: expectedPayload }]);
  });
}

// TP-JS-1
test('keeps the caller-owned layout request, its tree and its values unchanged', async () => {
  const serialized = JSON.stringify(layoutInput);
  mockIPC((_command, payload) => {
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
]) {
  test(`${name} preserves the native ${code} error instead of reporting success`, async () => {
    const expected = { code, message: 'Operation could not be completed.' };
    mockIPC(() => Promise.reject(expected));
    await assert.rejects(activity[name](...args), error => {
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
  const first = [];
  const second = [];
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
  for (const push of ['token', { channel: 'dGVzdA==' }]) {
    const calls = [];
    mockIPC((nativeCommand, payload) => {
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
  mockIPC(() => {}, { shouldMockEvents: true });
  const tokens = [];
  const starts = [];
  const updates = [];
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

test('onAction reports a refused subscription instead of pretending to listen', async () => {
  mockIPC(() => Promise.reject('event.listen not allowed'));
  await assert.rejects(activity.onAction(() => {}), error => {
    assert.equal(error, 'event.listen not allowed');
    return true;
  });
});

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
]) {
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
test('layout builders omit options that were not given or are undefined', () => {
  assert.deepEqual(Object.keys(layout.vstack([])), ['type', 'children']);
  assert.deepEqual(layout.spacer({}), { type: 'spacer' });
  assert.deepEqual(layout.spacer(undefined), { type: 'spacer' });
  assert.deepEqual(layout.text('a', { style: undefined, if: 'shown' }), { type: 'text', value: 'a', if: 'shown' });
  assert.deepEqual(layout.gauge('level', { min: 0, max: undefined }), { type: 'gauge', bind: 'level', min: 0 });
});

test('layout builders do not validate and leave their arguments unchanged', () => {
  const child = deepFreeze({ type: 'text', value: 'Pause' });
  const children = deepFreeze([child, { type: 'unknown' }]);
  const options = deepFreeze({ spacing: 999, style: 'card' });
  const box = deepFreeze([0, 4096]);
  const serialized = JSON.stringify({ child, children, options, box });

  for (const type of ['vstack', 'hstack', 'zstack']) {
    const node = layout[type](children, options);
    assert.deepEqual(node, { type, children: [{ type: 'text', value: 'Pause' }, { type: 'unknown' }], spacing: 999, style: 'card' });
    assert.notEqual(node, options);
  }
  assert.deepEqual(layout.path('not a path', box, deepFreeze({ stroke: -1 })), { type: 'path', d: 'not a path', box: [0, 4096], stroke: -1 });
  assert.deepEqual(layout.button('', child, options), { type: 'button', actionId: '', child: { type: 'text', value: 'Pause' }, spacing: 999, style: 'card' });
  assert.deepEqual(layout.text('a', deepFreeze({ bind: 'both' })), { type: 'text', value: 'a', bind: 'both' });
  assert.equal(JSON.stringify({ child, children, options, box }), serialized);
});

// The shared layout fixtures, as far as this layer goes: it sends every request as written, leaves
// the verdict to the plugin, and its builders can write every valid layout.
const send = {
  start: activity.start, update: activity.update,
  start_layout: activity.startLayout, update_layout: activity.updateLayout, end_layout: activity.endLayout,
};
const starts = fixtures.valid.filter(({ command }) => command === 'start_layout');
const each = async (cases, check) => {
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
  const commands = new Set(fixtures.valid.map(({ command }) => command));
  for (const command of ['start_layout', 'update_layout', 'end_layout']) assert.ok(commands.has(command), `no valid fixture for ${command}`);
  await each(fixtures.valid, async ({ command, input }) => {
    const request = deepFreeze(structuredClone(input));
    const reply = { ...layoutRecord, state: command === 'end_layout' ? 'ended' : 'active' };
    const calls = [];
    mockIPC((nativeCommand, payload) => {
      calls.push({ nativeCommand, payload });
      return reply;
    });
    assert.deepEqual(await send[command](request), reply);
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: { input } }]);
  });
});

test('sends every invalid layout fixture unchanged and reports the code of its rejection', async () => {
  // Left to the validators: fixtures whose command this API cannot send with an input.
  const sendable = fixtures.invalid.filter(({ command }) => Object.hasOwn(send, command));
  assert.notEqual(sendable.length, 0);
  await each(sendable, async ({ command, input, code }) => {
    const request = deepFreeze(structuredClone(input));
    const expected = { code, message: 'Operation could not be completed.' };
    const calls = [];
    mockIPC((nativeCommand, payload) => {
      calls.push({ nativeCommand, payload });
      return Promise.reject(expected);
    });
    await assert.rejects(send[command](request), error => {
      assert.deepEqual(error, expected);
      return true;
    });
    assert.deepEqual(calls, [{ nativeCommand: `plugin:live-activity|${command}`, payload: { input } }]);
  });
});

// Writes a fixture node again through the builders: its members become the builder's arguments.
const rebuilder = builders => {
  const rebuild = ({ type, ...members }) => table[type === 'text' && 'bind' in members ? 'bound' : type](members);
  const table = {
    vstack: ({ children, ...options }) => builders.vstack(children.map(rebuild), options),
    hstack: ({ children, ...options }) => builders.hstack(children.map(rebuild), options),
    zstack: ({ children, ...options }) => builders.zstack(children.map(rebuild), options),
    spacer: options => builders.spacer(options),
    divider: options => builders.divider(options),
    text: ({ value, ...options }) => builders.text(value, options),
    bound: ({ bind, ...options }) => builders.bound(bind, options),
    symbol: ({ name, ...options }) => builders.symbol(name, options),
    image: ({ source, ...options }) => builders.image('asset' in source ? source.asset : { file: source.file }, options),
    custom: ({ name, props, ...options }) => builders.custom(name, {
      ...options, ...(props && { props: mapValues(props, prop => rebind(prop, builders.bind)) }),
    }),
    path: ({ d, box, ...options }) => builders.path(d, box, options),
    progress: ({ bind, ...options }) => builders.progress(bind, options),
    gauge: ({ bind, ...options }) => builders.gauge(bind, options),
    timerText: ({ start, end, ...options }) => builders.timerText(start, end, options),
    button: ({ actionId, child, ...options }) => builders.button(actionId, rebuild(child), options),
  };
  return rebuild;
};
const mapValues = (object, map) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, map(value, key)]));
// A bound member is written again with `bind`, a literal as it is.
const rebind = (member, bind) => (typeof member === 'object' && 'bind' in member ? bind(member.bind) : member);
const rebuildLayout = ({ lockScreen, island, ...tints }, rebuild, bind) => ({
  lockScreen: rebuild(lockScreen),
  ...(island && { island: mapValues(island, (part, key) => (key === 'expanded' ? mapValues(part, rebuild) : rebuild(part))) }),
  ...mapValues(tints, tint => rebind(tint, bind)),
});
const rebuildStyles = (styles, bind) => mapValues(styles, style => mapValues(style, member => rebind(member, bind)));

test('layout builders reproduce every node of every valid fixture layout', async () => {
  const used = new Set();
  const rebuild = rebuilder(mapValues(layout, (build, name) => (...given) => {
    used.add(name);
    return build(...given);
  }));
  const bind = key => {
    used.add('bind');
    return layout.bind(key);
  };
  await each(starts, ({ input }) => {
    assert.deepEqual(rebuildLayout(input.layout, rebuild, bind), input.layout);
    if (input.styles) assert.deepEqual(rebuildStyles(input.styles, bind), input.styles);
  });
  assert.deepEqual([...used].sort(), Object.keys(layout).sort());
});

test('sends the start and the update of every update fixture unchanged', async () => {
  assert.notEqual(fixtures.updates.length, 0);
  await each(fixtures.updates, async ({ start, update }) => {
    const calls = [];
    mockIPC((nativeCommand, payload) => {
      calls.push({ nativeCommand, payload });
      return layoutRecord;
    });
    await activity.startLayout(deepFreeze(structuredClone(start)));
    await activity.updateLayout(deepFreeze(structuredClone(update)));
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
  }, named.input.styles);
});

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
]) {
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
  const calls = [];
  mockIPC((nativeCommand, payload) => {
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
test('the declarations follow the contract of 0.5', async () => {
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
});

