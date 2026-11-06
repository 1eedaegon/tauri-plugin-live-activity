import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateRequest } from '../../../tools/validate-request.mjs';
import {
  actionMessage, findLayoutExample, layoutExamples, layoutRecordFor, nextLayoutSnapshot, runningLayoutExamples,
} from '../src/layouts.ts';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const widget = new URL('../widget/', import.meta.url);

/** Every node of the lock screen and of each island region, depth first. */
function nodes(layout) {
  const island = layout.island ?? {};
  const roots = [layout.lockScreen, ...Object.values(island.expanded ?? {}),
    island.compactLeading, island.compactTrailing, island.minimal].filter(Boolean);
  const walk = node => [node, ...(node.children ?? []).flatMap(walk), ...(node.child ? walk(node.child) : [])];
  return roots.flatMap(walk);
}

const startOf = id => findLayoutExample(id).start(NOW);
const nodesOf = id => nodes(startOf(id).layout);
const ofType = (id, type) => nodesOf(id).filter(node => node.type === type);

test('offers one example per layout feature, each under its own key', () => {
  assert.deepEqual(layoutExamples.map(example => example.id), [
    'text', 'symbols', 'image', 'paths', 'gauge', 'progress', 'timer', 'stacks', 'buttons', 'island', 'android', 'nowBar',
  ]);
  const keys = layoutExamples.map(example => example.start(NOW).activityKey);
  assert.deepEqual(keys, layoutExamples.map(example => `mochi:${example.id}`));
  for (const example of layoutExamples) {
    assert.ok(example.name.length > 0 && example.name.length <= 16, example.id);
    assert.ok(example.feature.length > 0 && example.feature.length <= 160, example.id);
    assert.ok(example.android.length > 0 && example.android.length <= 160, example.id);
  }
});

test('every example starts with a valid contract v2 request that asks for the notification fallback', () => {
  for (const example of layoutExamples) {
    const input = example.start(NOW);
    assert.equal(input.schemaVersion, 2);
    assert.equal(input.fallback, 'notification');
    assert.equal(input.snapshot.revision, 0);
    assert.deepEqual(validateRequest({ command: 'start_layout', input }), { valid: true, issues: [] }, example.id);
  }
});

test('updates keep the keys and value types of the start and change what is shown', () => {
  for (const example of layoutExamples.filter(item => item.next !== undefined)) {
    const first = example.start(NOW).snapshot.values;
    let values = first;
    for (let step = 0; step < 4; step += 1) {
      const next = example.next(values);
      assert.deepEqual(Object.keys(next).sort(), Object.keys(first).sort(), example.id);
      for (const key of Object.keys(first)) assert.equal(typeof next[key], typeof first[key], `${example.id}.${key}`);
      assert.notDeepEqual(next, values, example.id);
      const input = { id: 'handle', snapshot: { revision: step + 1, values: next } };
      assert.deepEqual(validateRequest({ command: 'update_layout', input }), { valid: true, issues: [] }, example.id);
      values = next;
    }
  }
});

test('text binds values, names styles and hides nodes with if and unless', () => {
  const texts = ofType('text', 'text');
  assert.ok(texts.some(node => node.bind === 'title' && node.style === 'title'));
  assert.ok(texts.some(node => node.unless === 'arrived'));
  assert.ok(texts.some(node => node.value !== undefined && node.if === 'arrived'));
  const example = findLayoutExample('text');
  let values = example.start(NOW).snapshot.values;
  const seen = [values.arrived];
  for (let step = 0; step < 3; step += 1) { values = example.next(values); seen.push(values.arrived); }
  assert.deepEqual(seen, [false, false, true, false]);
});

test('symbols show a plain, a multicolor and a variable SF Symbol', () => {
  const symbols = ofType('symbols', 'symbol');
  assert.ok(symbols.some(node => node.rendering === undefined && node.variableBind === undefined));
  assert.ok(symbols.some(node => node.rendering === 'multicolor'));
  const variable = symbols.find(node => node.variableBind !== undefined);
  assert.equal(typeof startOf('symbols').snapshot.values[variable.variableBind], 'number');
});

test('the image example names a PNG in the widget extension asset catalog', () => {
  const [image] = ofType('image', 'image');
  const set = new URL(`Assets.xcassets/${image.source.asset}.imageset/`, widget);
  const contents = JSON.parse(readFileSync(new URL('Contents.json', set), 'utf8'));
  const files = contents.images.map(entry => entry.filename).filter(Boolean);
  assert.ok(files.length >= 2);
  for (const file of files) {
    assert.match(file, /\.png$/);
    assert.ok(existsSync(new URL(file, set)), file);
    assert.ok(readFileSync(new URL(file, set)).length < 64 * 1024, file);
  }
});

test('paths fill and stroke SVG path data in one shared box', () => {
  const paths = ofType('paths', 'path');
  assert.ok(paths.some(node => node.stroke === undefined));
  assert.ok(paths.some(node => node.stroke !== undefined));
  assert.equal(new Set(paths.map(node => node.box.join('x'))).size, 1);
  assert.equal(ofType('paths', 'zstack').length, 1);
});

test('gauges and progress views come in both shapes', () => {
  assert.deepEqual(ofType('gauge', 'gauge').map(node => node.kind ?? 'linear').sort(), ['circular', 'linear']);
  assert.ok(ofType('gauge', 'gauge').every(node => node.max === 100));
  assert.deepEqual(ofType('progress', 'progress').map(node => node.kind ?? 'linear').sort(), ['circular', 'linear']);
});

test('the timer counts down five minutes from the start and a snooze adds one', () => {
  const [timer] = ofType('timer', 'timerText');
  const { values } = startOf('timer').snapshot;
  assert.equal(values[timer.start], NOW);
  assert.equal(values[timer.end], NOW + 5 * MINUTE);
  const next = findLayoutExample('timer').next(values);
  assert.equal(next[timer.start], NOW);
  assert.equal(next[timer.end], NOW + 6 * MINUTE);
});

test('stacks use every container, a spacer and a divider', () => {
  const types = new Set(nodesOf('stacks').map(node => node.type));
  for (const type of ['vstack', 'hstack', 'zstack', 'spacer', 'divider']) assert.ok(types.has(type), type);
});

test('buttons report pet and done, and have no in-app update', () => {
  assert.deepEqual(ofType('buttons', 'button').map(node => node.actionId), ['pet', 'done']);
  assert.equal(startOf('buttons').snapshot.values.pets, 0);
  assert.equal(findLayoutExample('buttons').next, undefined);
});

test('the Dynamic Island example fills every region and tints the keyline', () => {
  const { island, keyline } = startOf('island').layout;
  assert.deepEqual(Object.keys(island.expanded).sort(), ['bottom', 'center', 'leading', 'trailing']);
  for (const region of ['compactLeading', 'compactTrailing', 'minimal']) assert.ok(island[region], region);
  assert.ok(keyline);
});

test('the Android and Now Bar examples are public and lead with a title and a body', () => {
  for (const id of ['android', 'nowBar']) {
    const input = startOf(id);
    assert.deepEqual(input.android, { visibility: 'public' });
    const [title, body] = nodes(input.layout).filter(node => node.type === 'text' && node.bind !== undefined);
    assert.equal(title.bind, 'title');
    assert.equal(body.bind, 'status');
    assert.equal(ofType(id, 'progress').length, 1);
  }
  assert.deepEqual(ofType('android', 'button').map(node => node.actionId), ['wake']);
});

test('only the demo examples that are still running are ended before another starts', () => {
  const records = [
    { id: 'a', activityKey: 'mochi:paths', state: 'active' },
    { id: 'b', activityKey: 'mochi:gauge', state: 'ended' },
    { id: 'c', activityKey: 'mochi:timer', state: 'unknown' },
    { id: 'd', activityKey: 'other:paths', state: 'active' },
    { id: 'e', activityKey: 'mochi:island', state: 'dismissed' },
    { id: 'f', activityKey: 'mochi:stale', state: 'stale' },
  ];
  assert.deepEqual(runningLayoutExamples(records).map(record => record.id), ['a', 'c']);
  assert.equal(layoutRecordFor(records, 'paths')?.id, 'a');
  assert.equal(layoutRecordFor(records, 'gauge'), undefined);
  assert.equal(findLayoutExample('missing'), undefined);
});

test('the next snapshot raises the revision and leaves the record alone', () => {
  const example = findLayoutExample('progress');
  const input = example.start(NOW);
  const record = Object.freeze({ id: 'p', activityKey: input.activityKey, snapshot: Object.freeze({ ...input.snapshot, staleAt: NOW }) });
  const next = nextLayoutSnapshot(record, example);
  assert.equal(next.revision, 1);
  assert.equal(next.staleAt, undefined);
  assert.deepEqual(next.values, example.next(input.snapshot.values));
  assert.equal(record.snapshot.revision, 0);
  assert.throws(() => nextLayoutSnapshot(record, findLayoutExample('image')), /no update/);
});

test('a button tap is described with its action and example', () => {
  assert.equal(actionMessage({ actionId: 'pet', activityId: 'x', activityKey: 'mochi:buttons' }), 'Mochi felt “pet” from the Buttons example.');
  assert.equal(actionMessage({ actionId: 'wake', activityId: 'x' }), 'Mochi felt “wake” from an activity.');
  assert.equal(actionMessage({ actionId: 'wake', activityId: 'x', activityKey: 'other' }), 'Mochi felt “wake” from an activity.');
});
