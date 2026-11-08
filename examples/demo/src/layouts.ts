// One layout example per feature of request contract v2, each a complete start request.
import type {
  ActionEvent, LayoutActivityRecord, LayoutColor, LayoutSnapshot, LayoutStartInput, LayoutStyle, LayoutValues,
} from '../../../guest-js/index.js';
import {
  bind, bound, button, divider, gauge, hstack, image, path, progress, spacer, symbol, text, timerText, vstack, zstack,
} from '../../../guest-js/layout.ts';
import { snackSteps } from './mochi.ts';

export type LayoutExampleId =
  | 'text' | 'symbols' | 'image' | 'paths' | 'gauge' | 'progress' | 'timer' | 'stacks' | 'buttons' | 'styles'
  | 'island' | 'android' | 'nowBar';

export interface LayoutExample {
  readonly id: LayoutExampleId;
  /** The picker label. */
  readonly name: string;
  /** What the example shows, in one sentence. */
  readonly feature: string;
  /** What an Android notification shows of it, in one sentence. */
  readonly android: string;
  readonly start: (now: number) => LayoutStartInput;
  /** The values of the next in-app update; absent when the app sends none. */
  readonly next?: (values: LayoutValues) => LayoutValues;
}

const minute = 60_000;
const fallback = 'notification';
const schemaVersion = 2;

// Mochi's colors. The system may draw the Lock Screen in either scheme; the Dynamic Island is always dark.
const background: LayoutColor = { light: '#FAF7EF', dark: '#2E3229' };
const coral: LayoutColor = '#C9654D';
const teal: LayoutColor = { light: '#286D60', dark: '#A3D9C2' };
const mint: LayoutColor = '#A3D9C2';

const card: LayoutStyle = { padding: 16, frame: { maxWidth: 'infinity', alignment: 'leading' } };
const title: LayoutStyle = { font: 'headline', design: 'rounded', lineLimit: 1 };
const status: LayoutStyle = { font: 'subheadline', color: 'secondary', lineLimit: 2 };
const meter: LayoutStyle = { tint: teal };

/** A title above a status line, beside other content. */
const heading = () => vstack([bound('title', { style: 'title' }), bound('status', { style: 'status' })], { alignment: 'leading', spacing: 2 });

/** The value after `current` in `list`, wrapping around. */
function after<T>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length]!;
}

/** Snack delivery stages: the status line, the share done and the time left. */
const snackStages = [
  { status: snackSteps[0], done: 0.15, eta: '9 min' },
  { status: snackSteps[1], done: 0.65, eta: '4 min' },
  { status: snackSteps[2], done: 1, eta: 'Here' },
] as const;

function nextSnack(values: LayoutValues): LayoutValues {
  const stage = after(snackStages, snackStages.find(item => item.status === values.status) ?? snackStages[2]);
  return { ...values, status: stage.status, done: stage.done, ...('eta' in values ? { eta: stage.eta } : {}) };
}

// Mochi's head and closed eyes in a 100×90 box, as in the demo's illustration.
const head = 'M14 40C12 32 11 22 14 14Q15 11 18 13L35 27Q50 23 65 27L82 13Q85 11 86 14C89 22 88 32 86 40C93 48 94 61 87 71C79 81 66 85 50 85C34 85 21 81 13 71C6 61 7 48 14 40Z';
const eyes = 'M28 54Q33 58 38 54M62 54Q67 58 72 54';
const nose = 'M48 64Q50 62 52 64Q50 66 48 64Z';

const textExample: LayoutExample = {
  id: 'text',
  name: 'Text',
  feature: 'Text shows a literal or a bound value in a named style. With if or unless, a node shows only while a value is truthy, or is not.',
  android: 'The first text is the title and the second the body. Styles are left out.',
  start: () => ({
    activityKey: 'mochi:text', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        bound('title', { style: 'title' }),
        bound('status', { style: 'status', unless: 'arrived' }),
        text('Snack time! Made it home', { style: 'done', if: 'arrived' }),
      ], { alignment: 'leading', spacing: 4, style: 'card' }),
      background,
    },
    styles: { card, title, status, done: { font: 'subheadline', weight: 'bold', color: coral } },
    snapshot: { revision: 0, values: { title: 'Mochi’s snack', status: snackSteps[0], arrived: false } },
  }),
  next: values => {
    if (values.arrived === true) return { ...values, status: snackSteps[0], arrived: false };
    return values.status === snackSteps[0] ? { ...values, status: snackSteps[1] } : { ...values, arrived: true };
  },
};

const purrs = [
  { status: 'A soft purr', purr: 0.35 },
  { status: 'Purring nicely', purr: 0.7 },
  { status: 'Full purr engine', purr: 1 },
] as const;

const symbolsExample: LayoutExample = {
  id: 'symbols',
  name: 'SF Symbols',
  feature: 'A symbol names an SF Symbol. It can use multicolor rendering, and variableBind fills a variable symbol from a number.',
  android: 'A notification has no symbols. They are listed in degradedFeatures as layout.symbol.',
  start: () => ({
    activityKey: 'mochi:symbols', schemaVersion, fallback,
    layout: {
      lockScreen: hstack([
        symbol('cat.fill', { style: 'icon' }),
        symbol('heart.fill', { rendering: 'multicolor', style: 'icon' }),
        symbol('speaker.wave.3.fill', { rendering: 'hierarchical', variableBind: 'purr', style: 'level' }),
        heading(),
      ], { spacing: 12, style: 'card' }),
      background,
    },
    styles: { card, title, status, icon: { size: 26, color: coral }, level: { size: 26, color: teal } },
    snapshot: { revision: 0, values: { title: 'Purr meter', status: purrs[0].status, purr: purrs[0].purr } },
  }),
  next: values => ({ ...values, ...after(purrs, purrs.find(item => item.purr === values.purr) ?? purrs[2]) }),
};

const imageExample: LayoutExample = {
  id: 'image',
  name: 'Image',
  feature: 'An image names a picture in the asset catalog of the widget extension.',
  android: 'A notification has no images. They are listed as layout.image.',
  start: () => ({
    activityKey: 'mochi:image', schemaVersion, fallback,
    layout: {
      lockScreen: hstack([
        image('mochi', { resizable: true, contentMode: 'fit', style: 'portrait' }),
        heading(),
      ], { spacing: 12, style: 'card' }),
      background,
    },
    styles: { card, title, status, portrait: { frame: { width: 56, height: 56 } } },
    snapshot: { revision: 0, values: { title: 'Mochi’s portrait', status: 'Hello from the asset catalog' } },
  }),
};

const pathsExample: LayoutExample = {
  id: 'paths',
  name: 'Paths',
  feature: 'A path draws SVG path data in a box. It is filled, or stroked when it has a stroke width.',
  android: 'A notification has no paths. They are listed as layout.path.',
  start: () => ({
    activityKey: 'mochi:paths', schemaVersion, fallback,
    layout: {
      lockScreen: hstack([
        zstack([
          path(head, [100, 90], { style: 'fur' }),
          path(head, [100, 90], { stroke: 1.5, style: 'ink' }),
          path(eyes, [100, 90], { stroke: 2, style: 'ink' }),
          path(nose, [100, 90], { style: 'nose' }),
        ], { style: 'face' }),
        heading(),
      ], { spacing: 12, style: 'card' }),
      background,
    },
    styles: {
      card, title, status,
      face: { frame: { width: 60, height: 54 } },
      fur: { color: '#F6E9CD' },
      ink: { color: '#3F4438' },
      nose: { color: coral },
    },
    snapshot: { revision: 0, values: { title: 'Mochi, drawn from paths', status: 'Fast asleep in four shapes' } },
  }),
};

const bowls = [
  { status: '80 g of kibble left', bowl: 80 },
  { status: 'Half a bowl to go', bowl: 45 },
  { status: 'Time for a refill', bowl: 10 },
] as const;

const gaugeExample: LayoutExample = {
  id: 'gauge',
  name: 'Gauge',
  feature: 'A gauge shows a number between min and max, as a ring or a bar.',
  android: 'A notification has no gauges. They are listed as layout.gauge.',
  start: () => ({
    activityKey: 'mochi:gauge', schemaVersion, fallback,
    layout: {
      lockScreen: hstack([
        gauge('bowl', { max: 100, kind: 'circular', style: 'meter' }),
        vstack([
          bound('title', { style: 'title' }),
          bound('status', { style: 'status' }),
          gauge('bowl', { max: 100, style: 'meter' }),
        ], { alignment: 'leading', spacing: 4 }),
      ], { spacing: 12, style: 'card' }),
      background,
    },
    styles: { card, title, status, meter },
    snapshot: { revision: 0, values: { title: 'Snack bowl', status: bowls[0].status, bowl: bowls[0].bowl } },
  }),
  next: values => ({ ...values, ...after(bowls, bowls.find(item => item.bowl === values.bowl) ?? bowls[2]) }),
};

const progressExample: LayoutExample = {
  id: 'progress',
  name: 'Progress',
  feature: 'A progress view shows a number from 0 to 1 as a bar or a ring.',
  android: 'The first progress view is the progress bar, and the status chip shows its percentage.',
  start: () => ({
    activityKey: 'mochi:progress', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        hstack([bound('title', { style: 'title' }), spacer(), progress('done', { kind: 'circular', style: 'meter' })]),
        bound('status', { style: 'status' }),
        progress('done', { style: 'meter' }),
      ], { alignment: 'leading', spacing: 6, style: 'card' }),
      background,
    },
    styles: { card, title, status, meter },
    snapshot: { revision: 0, values: { title: 'Mochi’s snack delivery', status: snackStages[0].status, done: snackStages[0].done } },
  }),
  next: nextSnack,
};

const timerExample: LayoutExample = {
  id: 'timer',
  name: 'Timer',
  feature: 'A timer text counts down to its end value, or up from its start with countsDown false. The system redraws it every second.',
  android: 'The first timer is the notification’s chronometer, and the status chip shows it.',
  start: now => ({
    activityKey: 'mochi:timer', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        hstack([symbol('moon.zzz.fill', { style: 'moon' }), bound('title', { style: 'title' })], { spacing: 8 }),
        timerText('start', 'end', { style: 'clock' }),
        bound('status', { style: 'status' }),
      ], { alignment: 'leading', spacing: 4, style: 'card' }),
      background,
    },
    styles: {
      card, title, status,
      moon: { color: teal },
      clock: { size: 34, weight: 'semibold', design: 'rounded', monospacedDigit: true, color: teal, frame: { maxWidth: 'infinity', alignment: 'leading' } },
    },
    snapshot: { revision: 0, values: { title: 'Mochi’s nap', status: 'A little snooze', start: now, end: now + 5 * minute } },
  }),
  next: values => ({ ...values, status: 'Just one more minute…', end: Number(values.end) + minute }),
};

const etas = ['4 min', '2 min', 'Here'] as const;

const stacksExample: LayoutExample = {
  id: 'stacks',
  name: 'Stacks',
  feature: 'Stacks place nodes in a column, a row or on top of each other. A spacer takes the free space and a divider draws a line.',
  android: 'Only the first two texts appear, as the title and the body; the other nodes are listed.',
  start: () => ({
    activityKey: 'mochi:stacks', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        hstack([
          zstack([symbol('circle.fill', { style: 'badge' }), symbol('pawprint.fill', { style: 'mark' })]),
          bound('title', { style: 'title' }),
          spacer(),
          bound('eta', { style: 'eta' }),
        ], { spacing: 8 }),
        divider(),
        hstack([
          vstack([text('From', { style: 'label' }), bound('from')], { alignment: 'leading' }),
          spacer({ minLength: 16 }),
          vstack([text('To', { style: 'label' }), bound('to')], { alignment: 'trailing' }),
        ]),
      ], { spacing: 10, style: 'card' }),
      background,
    },
    styles: {
      card, title,
      badge: { size: 28, color: coral },
      mark: { size: 13, color: '#FFFAF3' },
      eta: { font: 'headline', monospacedDigit: true, color: teal },
      label: { font: 'caption', color: 'secondary' },
    },
    snapshot: { revision: 0, values: { title: 'Snack route', eta: etas[0], from: 'Kitchen', to: 'Mochi’s bowl' } },
  }),
  next: values => ({ ...values, eta: after(etas, values.eta as typeof etas[number]) }),
};

const buttonsExample: LayoutExample = {
  id: 'buttons',
  name: 'Buttons',
  feature: 'A button reports its action ID to the app. Here Rust takes a second to count each pet, and the tap waits for it; “All done” ends the activity.',
  android: 'Up to three buttons become notification actions, labelled with their text.',
  start: () => ({
    activityKey: 'mochi:buttons', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        hstack([symbol('cat.fill', { style: 'icon' }), bound('title', { style: 'title' })], { spacing: 8 }),
        bound('status', { style: 'status' }),
        hstack([
          button('pet', text('Pet Mochi'), { style: 'action' }),
          button('done', text('All done'), { style: 'quiet' }),
        ], { spacing: 8 }),
      ], { alignment: 'leading', spacing: 8, style: 'card' }),
      background,
    },
    styles: {
      card, title, status,
      icon: { size: 20, color: coral },
      action: { buttonStyle: 'borderedProminent', tint: coral },
      quiet: { buttonStyle: 'bordered', tint: teal },
    },
    snapshot: { revision: 0, values: { title: 'Mochi wants attention', status: 'No pets yet', pets: 0 } },
  }),
};

/**
 * Delivery states and the colors they show. A bound color is a name or one hex color for both appearances,
 * never a light and dark pair.
 */
const deliveries = [
  { status: 'On time', tone: 'green', weight: 'regular', done: 0.3 },
  { status: 'Running 5 min late', tone: 'red', weight: 'bold', done: 0.5 },
  { status: 'Home at last', tone: '#2E8B7A', weight: 'semibold', done: 1 },
] as const;

const stylesExample: LayoutExample = {
  id: 'styles',
  name: 'Changing styles',
  feature: 'A style member can name a value with bind, so an update changes it. Here the status turns red and bold when the snack runs late.',
  android: 'A notification has no styles: the status text changes, its color does not.',
  start: () => ({
    activityKey: 'mochi:styles', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        hstack([symbol('clock.fill', { style: 'badge' }), bound('title', { style: 'title' })], { spacing: 8 }),
        bound('status', { style: 'status' }),
        progress('done', { style: 'meter' }),
      ], { alignment: 'leading', spacing: 6, style: 'card' }),
      background,
    },
    styles: {
      card, title,
      badge: { color: bind('tone') },
      status: { font: 'subheadline', weight: bind('weight'), color: bind('tone'), lineLimit: 1 },
      meter: { tint: bind('tone') },
    },
    snapshot: { revision: 0, values: { title: 'Mochi’s snack', ...deliveries[0] } },
  }),
  next: values => ({ ...values, ...after(deliveries, deliveries.find(item => item.status === values.status) ?? deliveries[2]) }),
};

const islandExample: LayoutExample = {
  id: 'island',
  name: 'Dynamic Island',
  feature: 'The island member gives the expanded regions, the compact sides and the minimal view their own nodes. The keyline color tints its edge.',
  android: 'Android has no Dynamic Island. It shows the lock screen tree and lists layout.island.',
  start: () => ({
    activityKey: 'mochi:island', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        bound('title', { style: 'title' }),
        bound('status', { style: 'status' }),
        progress('done', { style: 'meter' }),
      ], { alignment: 'leading', spacing: 6, style: 'card' }),
      island: {
        expanded: {
          leading: image('mochi', { resizable: true, contentMode: 'fit', style: 'portrait' }),
          center: bound('title', { style: 'islandTitle' }),
          trailing: bound('eta', { style: 'islandValue' }),
          bottom: vstack([
            bound('status', { style: 'islandStatus' }),
            progress('done', { style: 'islandMeter' }),
          ], { alignment: 'leading', spacing: 4 }),
        },
        compactLeading: symbol('pawprint.fill', { style: 'mint' }),
        compactTrailing: bound('eta', { style: 'islandValue' }),
        minimal: progress('done', { kind: 'circular', style: 'islandMeter' }),
      },
      background,
      keyline: mint,
    },
    styles: {
      card, title, status, meter,
      portrait: { frame: { width: 44, height: 44 } },
      islandTitle: { font: 'headline', design: 'rounded', color: 'white', lineLimit: 1 },
      islandStatus: { font: 'caption', color: '#FFFFFFBF', lineLimit: 1 },
      islandValue: { font: 'caption', weight: 'semibold', monospacedDigit: true, color: mint },
      islandMeter: { tint: mint },
      mint: { color: mint },
    },
    snapshot: {
      revision: 0,
      values: { title: 'Mochi’s snack', status: snackStages[0].status, done: snackStages[0].done, eta: snackStages[0].eta },
    },
  }),
  next: nextSnack,
};

const naps = [
  { status: 'Dozing off', sleep: 0.2 },
  { status: 'Fast asleep', sleep: 0.6 },
  { status: 'Dreaming of snacks', sleep: 1 },
] as const;

const androidExample: LayoutExample = {
  id: 'android',
  name: 'Android',
  feature: 'Android draws no layout. It turns the lock screen tree into a notification and promotes it to a Live Update where it can.',
  android: 'Title, body, progress bar with a percentage chip, and a “Wake Mochi” action. The symbol and the styles are left out.',
  start: () => ({
    activityKey: 'mochi:android', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        hstack([symbol('moon.zzz.fill'), bound('title', { style: 'title' })], { spacing: 8 }),
        bound('status'),
        progress('sleep'),
        button('wake', text('Wake Mochi')),
      ], { alignment: 'leading', spacing: 6, style: 'card' }),
    },
    styles: { card, title },
    snapshot: { revision: 0, values: { title: 'Mochi’s nap', status: naps[0].status, sleep: naps[0].sleep } },
    android: { visibility: 'public' },
  }),
  next: values => ({ ...values, ...after(naps, naps.find(item => item.sleep === values.sleep) ?? naps[2]) }),
};

const nowBarExample: LayoutExample = {
  id: 'nowBar',
  name: 'Now Bar',
  feature: 'With android.samsungNowBar on, One UI’s Now Bar shows the title and the body as its two lines.',
  android: 'This app turns the option on in tauri.conf.json. The Now Bar needs Samsung’s allow list or the developer option.',
  start: () => ({
    activityKey: 'mochi:nowBar', schemaVersion, fallback,
    layout: {
      lockScreen: vstack([
        bound('title', { style: 'title' }),
        bound('status', { style: 'status' }),
        progress('done', { style: 'meter' }),
      ], { alignment: 'leading', spacing: 6, style: 'card' }),
      background,
    },
    styles: { card, title, status, meter },
    snapshot: { revision: 0, values: { title: 'Mochi’s snack delivery', status: snackStages[0].status, done: snackStages[0].done } },
    android: { visibility: 'public' },
  }),
  next: nextSnack,
};

export const layoutExamples: readonly LayoutExample[] = [
  textExample, symbolsExample, imageExample, pathsExample, gaugeExample, progressExample, timerExample,
  stacksExample, buttonsExample, stylesExample, islandExample, androidExample, nowBarExample,
];

export function findLayoutExample(id: string): LayoutExample | undefined {
  return layoutExamples.find(example => example.id === id);
}

const exampleKeys = new Map(layoutExamples.map(example => [`mochi:${example.id}`, example]));
const running = (record: Pick<LayoutActivityRecord, 'state'>) => record.state !== 'ended' && record.state !== 'dismissed';

/** The demo's layout activities that have not ended, to end before another example starts. */
export function runningLayoutExamples<R extends Pick<LayoutActivityRecord, 'activityKey' | 'state'>>(records: readonly R[]): R[] {
  return records.filter(record => exampleKeys.has(record.activityKey) && running(record));
}

export function layoutRecordFor<R extends Pick<LayoutActivityRecord, 'activityKey' | 'state'>>(records: readonly R[], id: LayoutExampleId): R | undefined {
  return records.find(record => record.activityKey === `mochi:${id}` && running(record));
}

/** The complete snapshot of the example's next in-app update. */
export function nextLayoutSnapshot(record: Pick<LayoutActivityRecord, 'snapshot'>, example: LayoutExample): LayoutSnapshot {
  if (example.next === undefined) throw new Error(`The ${example.name} example has no update.`);
  return { revision: record.snapshot.revision + 1, values: example.next(record.snapshot.values) };
}

export function actionMessage(event: ActionEvent): string {
  const example = event.activityKey === undefined ? undefined : exampleKeys.get(event.activityKey);
  return `Mochi felt “${event.actionId}” from ${example === undefined ? 'an activity' : `the ${example.name} example`}.`;
}
