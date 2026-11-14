import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateLayoutUpdate, validateRequest } from '../../../tools/validate-request.mjs';
import {
  actionMessage, findLayoutExample, freshFor, layoutExamples, layoutRecordFor, nextLayoutSnapshot, openedMessage,
  runningLayoutExamples, startsIn,
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
    'text', 'symbols', 'image', 'paths', 'gauge', 'progress', 'timer', 'stacks', 'buttons', 'switch', 'link', 'styles',
    'staleness', 'later', 'island', 'android', 'nowBar',
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
      // The check the native layer makes against the stored layout and styles.
      assert.deepEqual(validateLayoutUpdate(example.start(NOW), input), { valid: true, issues: [] }, example.id);
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

test('the switch shows a flag that is off and reports purr, with the lines Rust sets', () => {
  const [purr] = ofType('switch', 'toggle');
  assert.equal(ofType('switch', 'toggle').length, 1);
  assert.deepEqual([purr.actionId, purr.bind, purr.child.value], ['purr', 'purring', 'Purr alerts']);
  const values = startOf('switch').snapshot.values;
  assert.equal(values.purring, false);
  // Rust's handler writes the same two lines (src-tauri/src/actions.rs).
  const rust = readFileSync(new URL('../src-tauri/src/actions.rs', import.meta.url), 'utf8');
  assert.ok(rust.includes(`pub const QUIET: &str = "${values.status}";`));
  assert.ok(rust.includes('pub const PURRING: &str = "Purring out loud";'));
  assert.equal(findLayoutExample('switch').next, undefined);
});

test('the link opens a URL of a scheme that the Android app declares', () => {
  const [jar] = ofType('link', 'link');
  assert.equal(ofType('link', 'link').length, 1);
  assert.equal(jar.url, 'mochi://treats');
  assert.equal(jar.child.value, 'Open the treat jar');
  // Android opens a link only in an activity of the app that takes its scheme; without one the link is left out.
  const manifest = readFileSync(new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /<action android:name="android\.intent\.action\.VIEW" \/>[\s\S]*<data android:scheme="mochi" \/>/);
});

test('the staleness example is stale 45 seconds after its start and draws one line for each condition', () => {
  const input = startOf('staleness');
  assert.equal(freshFor, 45_000);
  assert.equal(input.snapshot.staleAt, NOW + freshFor);
  const conditional = nodesOf('staleness').filter(node => node.ifStale !== undefined);
  assert.deepEqual(conditional.map(node => [node.ifStale, node.bind ?? node.value]), [
    [false, 'news'], [true, 'Waiting for news of the snack'],
  ]);
  // An update carries no stale time: its content is fresh for good.
  const record = { id: 's', activityKey: input.activityKey, snapshot: input.snapshot };
  assert.equal(nextLayoutSnapshot(record, findLayoutExample('staleness')).staleAt, undefined);
});

test('the scheduled start begins 30 seconds after it is asked for, with an alert, and has no update', () => {
  const input = startOf('later');
  assert.equal(startsIn, 30_000);
  assert.deepEqual(input.scheduled, { at: NOW + startsIn, alert: { title: 'Dinner time', body: 'Mochi’s bowl is full.' } });
  assert.equal(findLayoutExample('later').next, undefined);
  // The alert says other words than the activity, so that what shows at the time can be told apart.
  const values = Object.values(input.snapshot.values);
  assert.ok(!values.includes(input.scheduled.alert.title) && !values.includes(input.scheduled.alert.body));
});

test('the changing styles example binds a color, and an update turns the status red', () => {
  const input = startOf('styles');
  const { styles, snapshot: { values } } = input;
  const status = nodesOf('styles').find(node => node.type === 'text' && node.bind === 'status');
  assert.deepEqual(styles[status.style].color, { bind: 'tone' });
  assert.deepEqual(styles[status.style].weight, { bind: 'weight' });
  const bound = Object.values(styles).flatMap(style => Object.values(style)).filter(member => member?.bind === 'tone');
  assert.ok(bound.length >= 3, 'the badge, the status and the bar follow one color');
  assert.equal(values.tone, 'green');
  const example = findLayoutExample('styles');
  const late = example.next(values);
  assert.equal(late.tone, 'red');
  assert.equal(late.weight, 'bold');
  assert.notEqual(late.status, values.status);
  const home = example.next(late);
  assert.match(home.tone, /^#[0-9A-F]{6}$/);
  assert.deepEqual(example.next(home), values);
  // A value the bound member cannot take is refused before the native layer.
  const update = { id: 'handle', snapshot: { revision: 1, values: { ...values, tone: 'crimson' } } };
  assert.equal(validateLayoutUpdate(input, update).valid, false);
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

test('an opening is described with what the person tapped and the example', () => {
  assert.equal(openedMessage({ activityId: 'x', activityKey: 'mochi:link', actionId: 'link:1' }), 'You came in through “link:1” of the Link example.');
  assert.equal(openedMessage({ activityId: 'x', activityKey: 'mochi:link' }), 'You came in through the notification of the Link example.');
  assert.equal(openedMessage({ activityId: 'x' }), 'You came in through the notification of an activity.');
});

test('a tap on a switch is described with the state it asked for', () => {
  assert.equal(actionMessage({ actionId: 'purr', activityId: 'x', activityKey: 'mochi:switch', on: true }), 'Mochi felt “purr”, asked on, from the Switch example.');
  assert.equal(actionMessage({ actionId: 'purr', activityId: 'x', on: false }), 'Mochi felt “purr”, asked off, from an activity.');
});

test('a button tap is described with its action and example', () => {
  assert.equal(actionMessage({ actionId: 'pet', activityId: 'x', activityKey: 'mochi:buttons' }), 'Mochi felt “pet” from the Buttons example.');
  assert.equal(actionMessage({ actionId: 'wake', activityId: 'x' }), 'Mochi felt “wake” from an activity.');
  assert.equal(actionMessage({ actionId: 'wake', activityId: 'x', activityKey: 'other' }), 'Mochi felt “wake” from an activity.');
});
