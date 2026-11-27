import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type {
  Layout, LayoutActivityRecord, LayoutEndInput, LayoutIsland, LayoutIslandExpanded, LayoutNode, LayoutStartInput,
  LayoutUpdateInput, LayoutValues,
} from '../../../guest-js/index.js';
import { list, member, present, text } from '../../../tests/support.ts';
import { keep } from '../../../tests/typescript-requests.ts';
import type { KeptRequest } from '../../../tests/typescript-requests.ts';
import {
  actionMessage, coordinate, findLayoutExample, freshFor, layoutExamples, layoutRecordFor, nextLayoutSnapshot, openedMessage,
  placeOf, placeSnapshot, placeValues, runningLayoutExamples, startsIn, walkStart,
} from '../src/layouts.ts';
import type { LayoutExample } from '../src/layouts.ts';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const widget = new URL('../widget/', import.meta.url);

/** The nodes of a layout whose `type` is `T`. */
type NodeOf<T extends LayoutNode['type']> = Extract<LayoutNode, { readonly type: T }>;

/** Every node of the lock screen, of each island region and of the small region, depth first. */
function nodes(layout: Layout): LayoutNode[] {
  const island: LayoutIsland = layout.island ?? {};
  // The regions of the expanded part by name: it has options beside them, which are no nodes.
  const expanded: LayoutIslandExpanded = island.expanded ?? {};
  const roots = [layout.lockScreen, expanded.leading, expanded.trailing, expanded.center, expanded.bottom,
    island.compactLeading, island.compactTrailing, island.minimal, layout.small]
    .filter(root => root !== undefined);
  const walk = (node: LayoutNode): LayoutNode[] =>
    [node, ...('children' in node ? node.children : []).flatMap(walk), ...('child' in node ? walk(node.child) : [])];
  return roots.flatMap(walk);
}

const startOf = (id: string): LayoutStartInput => present(findLayoutExample(id), `the ${id} example`).start(NOW);
/** How many updates of an example the tests follow. */
const UPDATES = 4;
/** The values of the first updates of `example`, each made from the one before it; none when it has no update. */
function updatesOf(example: LayoutExample): LayoutValues[] {
  const chain: LayoutValues[] = [];
  let { values } = example.start(NOW).snapshot;
  for (let step = 0; example.next !== undefined && step < UPDATES; step += 1) {
    values = example.next(values);
    chain.push(values);
  }
  return chain;
}
const nodesOf = (id: string): LayoutNode[] => nodes(startOf(id).layout);
const ofType = <T extends LayoutNode['type']>(id: string, type: T): NodeOf<T>[] =>
  nodesOf(id).filter((node): node is NodeOf<T> => node.type === type);

test('offers one example per layout feature, each under its own key', () => {
  assert.deepEqual(layoutExamples.map(example => example.id), [
    'text', 'symbols', 'image', 'paths', 'gauge', 'progress', 'timer', 'stacks', 'buttons', 'switch', 'link', 'styles',
    'staleness', 'later', 'island', 'small', 'android', 'nowBar', 'location',
  ]);
  const keys = layoutExamples.map(example => example.start(NOW).activityKey);
  assert.deepEqual(keys, layoutExamples.map(example => `mochi:${example.id}`));
  for (const example of layoutExamples) {
    assert.ok(example.name.length > 0 && example.name.length <= 16, example.id);
    assert.ok(example.feature.length > 0 && example.feature.length <= 160, example.id);
    assert.ok(example.android.length > 0 && example.android.length <= 160, example.id);
  }
});

test('every example starts with a contract v2 request that asks for the notification fallback', () => {
  for (const example of layoutExamples) {
    const input = example.start(NOW);
    assert.equal(input.schemaVersion, 2);
    assert.equal(input.fallback, 'notification');
    assert.equal(input.snapshot.revision, 0);
  }
});

test('updates keep the keys and value types of the start and change what is shown', () => {
  for (const example of layoutExamples.filter(item => item.next !== undefined)) {
    const first = example.start(NOW).snapshot.values;
    let values = first;
    assert.equal(updatesOf(example).length, UPDATES, example.id);
    for (const next of updatesOf(example)) {
      assert.deepEqual(Object.keys(next).sort(), Object.keys(first).sort(), example.id);
      for (const key of Object.keys(first)) assert.equal(typeof next[key], typeof first[key], `${example.id}.${key}`);
      assert.notDeepEqual(next, values, example.id);
      values = next;
    }
  }
});

// TP-CONTRACT-9
test('the start of every example and the updates that follow it are kept for Rust to judge', (t) => {
  const cases = layoutExamples.flatMap((example): KeptRequest[] => {
    const start = { name: `the ${example.id} example starts`, command: 'start_layout', input: example.start(NOW) };
    // Rust judges each update against the layout and the styles of its start, as the native layer does.
    const updates = updatesOf(example).map((values, index) => ({
      name: `the ${example.id} example, update ${index + 1}`, command: 'update_layout',
      input: { id: 'handle', snapshot: { revision: index + 1, values } } satisfies LayoutUpdateInput, after: start.name,
    }));
    return [start, ...updates];
  });
  // A value that a bound member cannot take: a request on its own, and none after the start that binds it, as an
  // update and as the final content of an end.
  const { values } = startOf('styles').snapshot;
  const snapshot = { revision: 1, values: { ...values, tone: 'crimson' } };
  const refused: Pick<KeptRequest, 'after' | 'code'> = { after: 'the styles example starts', code: 'INVALID_INPUT' };
  keep(t, 'demo-layouts', [
    ...cases,
    { name: 'the styles example, an update with a color that is none', command: 'update_layout', input: { id: 'handle', snapshot } satisfies LayoutUpdateInput, ...refused },
    { name: 'the styles example, an end with a color that is none', command: 'end_layout', input: { id: 'handle', policy: { kind: 'default' }, snapshot } satisfies LayoutEndInput, ...refused },
  ]);
});

test('text binds values, names styles and hides nodes with if and unless', () => {
  const texts = ofType('text', 'text');
  assert.ok(texts.some(node => node.bind === 'title' && node.style === 'title'));
  assert.ok(texts.some(node => node.unless === 'arrived'));
  assert.ok(texts.some(node => node.value !== undefined && node.if === 'arrived'));
  const example = present(findLayoutExample('text'));
  let values = example.start(NOW).snapshot.values;
  const seen = [values.arrived];
  for (let step = 0; step < 3; step += 1) { values = present(example.next)(values); seen.push(values.arrived); }
  assert.deepEqual(seen, [false, false, true, false]);
});

test('symbols show a plain, a multicolor and a variable SF Symbol', () => {
  const symbols = ofType('symbols', 'symbol');
  assert.ok(symbols.some(node => node.rendering === undefined && node.variableBind === undefined));
  assert.ok(symbols.some(node => node.rendering === 'multicolor'));
  const variable = symbols.find(node => node.variableBind !== undefined);
  assert.equal(typeof startOf('symbols').snapshot.values[present(variable?.variableBind)], 'number');
});

test('the image example names a PNG in the widget extension asset catalog', () => {
  const image = present(ofType('image', 'image')[0], 'the image');
  const set = new URL(`Assets.xcassets/${image.source.asset}.imageset/`, widget);
  const contents: unknown = JSON.parse(readFileSync(new URL('Contents.json', set), 'utf8'));
  const files = list(member(contents, 'images'), 'the images').map(entry => member(entry, 'filename')).filter(Boolean)
    .map(file => text(file, 'a file name'));
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
  const timer = present(ofType('timer', 'timerText')[0], 'the timer');
  const { values } = startOf('timer').snapshot;
  assert.equal(values[timer.start], NOW);
  assert.equal(values[timer.end], NOW + 5 * MINUTE);
  const next = present(present(findLayoutExample('timer')).next)(values);
  assert.equal(next[timer.start], NOW);
  assert.equal(next[timer.end], NOW + 6 * MINUTE);
});

test('stacks use every container, a spacer and a divider', () => {
  const types = new Set(nodesOf('stacks').map(node => node.type));
  for (const type of ['vstack', 'hstack', 'zstack', 'spacer', 'divider'] as const) assert.ok(types.has(type), type);
});

test('buttons report pet and done, and have no in-app update', () => {
  assert.deepEqual(ofType('buttons', 'button').map(node => node.actionId), ['pet', 'done']);
  assert.equal(startOf('buttons').snapshot.values.pets, 0);
  assert.equal(present(findLayoutExample('buttons')).next, undefined);
});

test('the switch shows a flag that is off and reports purr, with the lines Rust sets', () => {
  const [purr] = ofType('switch', 'toggle');
  assert.equal(ofType('switch', 'toggle').length, 1);
  assert.deepEqual([purr?.actionId, purr?.bind, member(purr?.child, 'value')], ['purr', 'purring', 'Purr alerts']);
  const values = startOf('switch').snapshot.values;
  assert.equal(values.purring, false);
  // Rust's handler writes the same two lines (src-tauri/src/actions.rs).
  const rust = readFileSync(new URL('../src-tauri/src/actions.rs', import.meta.url), 'utf8');
  assert.ok(rust.includes(`pub const QUIET: &str = "${values.status}";`));
  assert.ok(rust.includes('pub const PURRING: &str = "Purring out loud";'));
  assert.equal(present(findLayoutExample('switch')).next, undefined);
});

test('the link opens a URL of a scheme that the Android app declares', () => {
  const [jar] = ofType('link', 'link');
  assert.equal(ofType('link', 'link').length, 1);
  assert.equal(jar?.url, 'mochi://treats');
  assert.equal(member(jar?.child, 'value'), 'Open the treat jar');
  // Android opens a link only in an activity of the app that takes its scheme; without one the link is left out.
  const manifest = readFileSync(new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /<action android:name="android\.intent\.action\.VIEW" \/>[\s\S]*<data android:scheme="mochi" \/>/);
});

test('the staleness example is stale 45 seconds after its start and draws one line for each condition', () => {
  const input = startOf('staleness');
  assert.equal(freshFor, 45_000);
  assert.equal(input.snapshot.staleAt, NOW + freshFor);
  const conditional = nodesOf('staleness').filter(node => node.ifStale !== undefined);
  assert.deepEqual(conditional.map(node => [node.ifStale, member(node, 'bind') ?? member(node, 'value')]), [
    [false, 'news'], [true, 'Waiting for news of the snack'],
  ]);
  // An update carries no stale time: its content is fresh for good.
  const record = { id: 's', activityKey: input.activityKey, snapshot: input.snapshot };
  assert.equal(nextLayoutSnapshot(record, present(findLayoutExample('staleness'))).staleAt, undefined);
});

test('the scheduled start begins 30 seconds after it is asked for, with an alert, and has no update', () => {
  const input = startOf('later');
  assert.equal(startsIn, 30_000);
  assert.deepEqual(input.scheduled, { at: NOW + startsIn, alert: { title: 'Dinner time', body: 'Mochi’s bowl is full.' } });
  assert.equal(present(findLayoutExample('later')).next, undefined);
  // The alert says other words than the activity, so that what shows at the time can be told apart.
  const values = Object.values(input.snapshot.values);
  assert.ok(!values.includes(input.scheduled.alert.title) && !values.includes(input.scheduled.alert.body));
});

test('the changing styles example binds a color, and an update turns the status red', () => {
  const { styles, snapshot: { values } } = startOf('styles');
  const status = nodesOf('styles').find(node => node.type === 'text' && node.bind === 'status');
  assert.deepEqual(present(styles)[present(status?.style)]?.color, { bind: 'tone' });
  assert.deepEqual(present(styles)[present(status?.style)]?.weight, { bind: 'weight' });
  const bound = Object.values(present(styles)).flatMap((style): unknown[] => Object.values(style)).filter(entry => member(entry, 'bind') === 'tone');
  assert.ok(bound.length >= 3, 'the badge, the status and the bar follow one color');
  assert.equal(values.tone, 'green');
  const example = present(findLayoutExample('styles'));
  const late = present(example.next)(values);
  assert.equal(late.tone, 'red');
  assert.equal(late.weight, 'bold');
  assert.notEqual(late.status, values.status);
  const home = present(example.next)(late);
  assert.match(text(home.tone), /^#[0-9A-F]{6}$/);
  assert.deepEqual(present(example.next)(home), values);
});

test('the Dynamic Island example fills every region and tints the keyline', () => {
  const { island, keyline } = startOf('island').layout;
  assert.deepEqual(Object.keys(present(island?.expanded)).sort(), ['bottom', 'center', 'leading', 'trailing']);
  for (const region of ['compactLeading', 'compactTrailing', 'minimal'] as const) assert.ok(island?.[region], region);
  assert.ok(keyline);
});

test('the watch and car example has a glance for the small family beside its compact parts', () => {
  const { small, island } = startOf('small').layout;
  // Where the widget extension does not draw the small family, a watch and a car show the compact parts.
  for (const region of ['compactLeading', 'compactTrailing'] as const) assert.ok(island?.[region], region);
  const glance = nodes({ lockScreen: present(small) });
  // What the contract takes of the region, which Rust judges with the start (demo-layouts.json): few nodes, and
  // nothing to tap.
  assert.ok(glance.length <= 12, String(glance.length));
  for (const node of glance) assert.equal(['button', 'link', 'toggle'].includes(node.type), false, node.type);
  // It shows what the updates of the example change.
  assert.deepEqual(glance.map(node => member(node, 'bind')).filter(Boolean).sort(), ['done', 'eta', 'title']);
});

test('the Android and Now Bar examples are public and lead with a title and a body', () => {
  for (const id of ['android', 'nowBar']) {
    const input = startOf(id);
    assert.deepEqual(input.android, { visibility: 'public' });
    const [title, body] = nodes(input.layout).filter(node => node.type === 'text' && node.bind !== undefined);
    assert.equal(title?.bind, 'title');
    assert.equal(body?.bind, 'status');
    assert.equal(ofType(id, 'progress').length, 1);
  }
  assert.deepEqual(ofType('android', 'button').map(node => node.actionId), ['wake']);
});

test('the location example shows a place to four decimals with its hemisphere, and reads it back', () => {
  assert.equal(coordinate(37.56634, 'N', 'S'), '37.5663° N');
  assert.equal(coordinate(-33.8688, 'N', 'S'), '33.8688° S');
  assert.equal(coordinate(-0.12756, 'E', 'W'), '0.1276° W');
  const london = { latitude: 51.5072, longitude: -0.1276 };
  assert.deepEqual(placeValues(london), { latitude: '51.5072° N', longitude: '0.1276° W' });
  assert.deepEqual(placeOf(placeValues(london)), london);
  assert.equal(placeOf({ latitude: 'here', longitude: '0.1276° W' }), undefined);
  assert.equal(placeOf({ latitude: 51.5, longitude: '0.1276° W' }), undefined);
  assert.equal(placeOf({}), undefined);
  // It starts at its own place before the device says where it is, and a step of the walk moves it north and east.
  const { values } = startOf('location').snapshot;
  assert.deepEqual(placeOf(values), walkStart);
  const step = present(placeOf(present(present(findLayoutExample('location')).next)(values)));
  assert.ok(step.latitude > walkStart.latitude && step.longitude > walkStart.longitude);
  // A value of the start the walk does not know of stays; one it cannot read starts the walk over.
  assert.deepEqual(present(findLayoutExample('location')).next?.({ title: 'Walk', latitude: '?', longitude: '?' }).title, 'Walk');
});

test('a new position updates the location example in place, and one the card would show the same sends nothing', () => {
  const input = startOf('location');
  const record = Object.freeze({ snapshot: Object.freeze({ ...input.snapshot, revision: 3 }) });
  const moved = present(placeSnapshot(record, { latitude: 37.5701, longitude: 126.9822 }));
  assert.equal(moved.revision, 4);
  assert.deepEqual(moved.values, { ...input.snapshot.values, latitude: '37.5701° N', longitude: '126.9822° E' });
  assert.equal(record.snapshot.revision, 3);
  // Less than the card's precision away.
  assert.equal(placeSnapshot(record, { latitude: walkStart.latitude + 0.00001, longitude: walkStart.longitude }), undefined);
  // The lock screen shows both coordinates, the compact island the latitude, as an activity of a place does.
  assert.deepEqual(ofType('location', 'text').map(node => node.bind), ['title', 'latitude', 'longitude', 'title', 'latitude', 'longitude', 'latitude']);
  assert.equal(input.layout.island?.compactTrailing?.type, 'text');
});

test('only the demo examples that are still running are ended before another starts', () => {
  const records: readonly Pick<LayoutActivityRecord, 'id' | 'activityKey' | 'state'>[] = [
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
  const example = present(findLayoutExample('progress'));
  const input = example.start(NOW);
  const record = Object.freeze({ id: 'p', activityKey: input.activityKey, snapshot: Object.freeze({ ...input.snapshot, staleAt: NOW }) });
  const next = nextLayoutSnapshot(record, example);
  assert.equal(next.revision, 1);
  assert.equal(next.staleAt, undefined);
  assert.deepEqual(next.values, present(example.next)(input.snapshot.values));
  assert.equal(record.snapshot.revision, 0);
  assert.throws(() => nextLayoutSnapshot(record, present(findLayoutExample('image'))), /no update/);
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
