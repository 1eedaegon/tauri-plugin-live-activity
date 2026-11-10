import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as layout from '../dist-js/layout.js';
import {
  Button, Custom, Divider, Gauge, HStack, Image, Path, Progress, SFSymbol, Spacer, Text, TimerText, VStack, ZStack,
} from '../dist-js/jsx/index.js';
import { jsx, jsxs } from '../dist-js/jsx/jsx-runtime.js';
import { jsxDEV } from '../dist-js/jsx/jsx-dev-runtime.js';
import { validateRequest } from '../tools/validate-request.mjs';
import { layoutExamples } from '../examples/demo/src/layouts.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests/jsx');
const tsc = join(root, 'node_modules/.bin/tsc');
after(() => rmSync(join(fixtures, 'out'), { recursive: true, force: true }));

const { bound, button, custom, divider, gauge, hstack, image, path, progress, spacer, symbol, text, timerText, vstack, zstack } = layout;
const mochi = text('Mochi');

/** The nodes that tests/jsx/elements.tsx writes, made with the builders. */
const expected = {
  vstack: vstack([mochi], { spacing: 4, alignment: 'leading', style: 'card' }),
  hstack: hstack([text('one'), text('two')], { spacing: 8 }),
  zstack: zstack([divider()], { alignment: 'topLeading', if: 'shown' }),
  spacer: spacer({ minLength: 8 }),
  divider: divider({ unless: 'hidden' }),
  text: text('3 of 5', { style: 'title' }),
  bound: bound('status', { style: 'status' }),
  symbol: symbol('cat.fill', { rendering: 'hierarchical' }),
  asset: image('badge', { resizable: true }),
  file: image({ file: 'badge.png' }, { contentMode: 'fit' }),
  path: path('M0 0 L10 10', [10, 10], { stroke: 2 }),
  progress: progress('done', { kind: 'circular' }),
  gauge: gauge('level', { min: 0, max: 10 }),
  timer: timerText('from', 'to', { countsDown: false }),
  button: button('pet', text('Pet Mochi'), { style: 'action' }),
  custom: custom('Paw', { props: { size: 3 } }),
};

// TP-JSX-1
test('each component returns the node of its layout builder', () => {
  const made = {
    vstack: VStack({ spacing: 4, alignment: 'leading', style: 'card', children: mochi }),
    hstack: HStack({ spacing: 8, children: [[text('one'), text('two')], false] }),
    zstack: ZStack({ alignment: 'topLeading', if: 'shown', children: divider() }),
    spacer: Spacer({ minLength: 8 }),
    divider: Divider({ unless: 'hidden' }),
    text: Text({ style: 'title', children: [3, ' of ', 5] }),
    bound: Text({ bind: 'status', style: 'status' }),
    symbol: SFSymbol({ name: 'cat.fill', rendering: 'hierarchical' }),
    asset: Image({ asset: 'badge', resizable: true }),
    file: Image({ file: 'badge.png', contentMode: 'fit' }),
    path: Path({ d: 'M0 0 L10 10', box: [10, 10], stroke: 2 }),
    progress: Progress({ bind: 'done', kind: 'circular' }),
    gauge: Gauge({ bind: 'level', min: 0, max: 10 }),
    timer: TimerText({ start: 'from', end: 'to', countsDown: false }),
    button: Button({ actionId: 'pet', style: 'action', children: text('Pet Mochi') }),
    custom: Custom({ name: 'Paw', props: { size: 3 } }),
  };
  assert.deepEqual(made, expected);
  // No member is undefined, as with the builders (TP-JS-6).
  assert.deepEqual(Text({ children: 'a', style: undefined }), { type: 'text', value: 'a' });
  // The runtime calls the component with the props; the key is not part of a node.
  assert.deepEqual(jsx(Text, { children: 'a' }, 'k'), text('a'));
  assert.deepEqual(jsxs(VStack, { children: [mochi, mochi] }), vstack([mochi, mochi]));
  assert.deepEqual(jsxDEV(Spacer, {}, undefined, false, {}, undefined), spacer());
});

// TP-JSX-1
test("TSX compiled with the package as its JSX import source gives the builders' nodes", async () => {
  const compiled = spawnSync(tsc, ['-p', join(fixtures, 'tsconfig.json')], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const { elements } = await import(join(fixtures, 'out/elements.js'));
  assert.deepEqual(elements, expected);
  // The output imports the runtime by the package's own name.
  assert.match(readFileSync(join(fixtures, 'out/elements.js'), 'utf8'), /from "tauri-plugin-live-activity\/jsx\/jsx-runtime"/);
});

// TP-JSX-2
test('the JSX entry imports nothing but its own files and the layout builders', () => {
  const dist = join(root, 'dist-js');
  // The package's own exports lead to the built files.
  for (const [entry, file] of [
    ['tauri-plugin-live-activity/jsx', 'jsx/index.js'],
    ['tauri-plugin-live-activity/jsx/jsx-runtime', 'jsx/jsx-runtime.js'],
    ['tauri-plugin-live-activity/jsx/jsx-dev-runtime', 'jsx/jsx-dev-runtime.js'],
    ['tauri-plugin-live-activity/react', 'react/index.js'],
  ]) {
    assert.equal(fileURLToPath(import.meta.resolve(entry)), join(dist, file), entry);
  }
  const imports = /(?:^|[;\s])(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
  const seen = new Set();
  const pending = ['jsx/index.js', 'jsx/jsx-runtime.js', 'jsx/jsx-dev-runtime.js'];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const built of [file, file.replace(/\.js$/, '.d.ts')]) {
      const source = readFileSync(join(dist, built), 'utf8');
      for (const [, written, dynamic] of source.matchAll(imports)) {
        const specifier = written ?? dynamic;
        assert.ok(specifier.startsWith('.'), `${built} imports ${specifier}`);
        const target = relative(dist, resolve(dirname(join(dist, built)), specifier)).replace(/\.d\.ts$/, '.js');
        if (built.endsWith('.js')) pending.push(target);
        else assert.ok(['jsx/index.js', 'jsx/jsx-runtime.js', 'jsx/jsx-dev-runtime.js', 'layout.js', 'types.js'].includes(target), `${built} imports ${specifier}`);
      }
      assert.doesNotMatch(source, /@tauri-apps|['"]react['"]/, built);
    }
  }
  assert.deepEqual([...seen].sort(), ['jsx/index.js', 'jsx/jsx-dev-runtime.js', 'jsx/jsx-runtime.js', 'layout.js']);
  // The scan sees a bare import too.
  assert.deepEqual([...`import 'x';\nimport y from "./y.js";`.matchAll(imports)].map(([, a, b]) => a ?? b), ['x', './y.js']);
});

// TP-JSX-3
test('stacks flatten arrays and leave out booleans, null and undefined', () => {
  const a = text('a');
  const b = text('b');
  for (const Stack of [VStack, HStack, ZStack]) {
    const node = Stack({ children: [[a, [b]], false, true, null, undefined] });
    assert.deepEqual(node.children, [a, b]);
  }
  assert.deepEqual(HStack({ children: a }).children, [a]);
  // A button's one child may come as an array of one, as JSX passes a lone expression in some compilers.
  assert.deepEqual(Button({ actionId: 'pet', children: [a] }), button('pet', a));
});

// TP-JSX-3
test('Text joins strings and numbers and takes bind instead', () => {
  assert.deepEqual(Text({ children: ['Pet ', 'Mochi'] }), text('Pet Mochi'));
  assert.deepEqual(Text({ children: [2, '/', 3] }), text('2/3'));
  assert.deepEqual(Text({ children: 0 }), text('0'));
  assert.deepEqual(Text({ children: '' }), text(''));
  assert.deepEqual(Text({ children: ['a', false, null, true, 'b'] }), text('ab'));
  assert.deepEqual(Text({ bind: 'title' }), bound('title'));
});

// TP-JSX-3
test('wrong children are a TypeError that names the component', () => {
  const a = text('a');
  for (const [make, name] of [
    [() => VStack({}), 'VStack'],
    [() => HStack({ children: [false, null] }), 'HStack'],
    [() => ZStack({ children: [] }), 'ZStack'],
    [() => Button({ actionId: 'pet' }), 'Button'],
    [() => Button({ actionId: 'pet', children: [a, a] }), 'Button'],
    [() => Text({}), 'Text'],
    [() => Text({ bind: 'title', children: 'a' }), 'Text'],
    [() => Text({ children: [a] }), 'Text'],
    [() => Button({ actionId: 'pet', children: [] }), 'Button'],
    [() => Button({ actionId: 'pet', children: 'Pet' }), 'Button'],
    [() => Image({}), 'Image'],
    [() => Image({ asset: 'badge', file: 'badge.png' }), 'Image'],
    [() => VStack({ children: ['loose text'] }), 'VStack'],
  ]) {
    assert.throws(make, (error) => error instanceof TypeError && error.message.startsWith(`${name}:`), name);
  }
});

// TP-JSX-4
test('the runtime refuses a tag that is not a component', () => {
  for (const tag of ['div', 'text', undefined, null, 3]) {
    assert.throws(() => jsx(tag, {}), TypeError, String(tag));
    assert.throws(() => jsxs(tag, { children: [] }), TypeError, String(tag));
  }
});

// TP-JSX-4
test('a lowercase tag does not compile', () => {
  const compiled = spawnSync(tsc, ['-p', join(fixtures, 'refused.tsconfig.json')], { encoding: 'utf8' });
  assert.notEqual(compiled.status, 0);
  assert.match(compiled.stdout + compiled.stderr, /refused\.tsx\(4,\d+\): error TS2339: Property 'div' does not exist on type 'JSX\.IntrinsicElements'/);
});

// TP-JSX-4
test('a fragment neither loads nor bundles', async () => {
  const compiled = spawnSync(tsc, ['-p', join(fixtures, 'tsconfig.json')], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  await assert.rejects(import(join(fixtures, 'out/fragment.js')), (error) => error instanceof SyntaxError && /Fragment/.test(error.message));
  const bundled = spawnSync(join(root, 'node_modules/.bin/esbuild'), [
    join(fixtures, 'fragment.tsx'), '--bundle', '--format=esm', '--jsx=automatic',
    '--jsx-import-source=tauri-plugin-live-activity/jsx', '--log-level=error',
  ], { encoding: 'utf8' });
  assert.notEqual(bundled.status, 0);
  assert.match(bundled.stderr, /No matching export in "dist-js\/jsx\/jsx-runtime\.js" for import "Fragment"/);
});

// TP-JSX-5
test("the demo's buttons example in TSX is the builders' request and passes the reference validator", async () => {
  const compiled = spawnSync(tsc, ['-p', join(fixtures, 'tsconfig.json')], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const { lockScreen } = await import(join(fixtures, 'out/buttons.js'));
  const example = layoutExamples.find(({ id }) => id === 'buttons');
  const built = example.start(0);
  const written = { ...built, layout: { ...built.layout, lockScreen } };
  assert.deepEqual(written, built);
  assert.deepEqual(validateRequest({ command: 'start_layout', input: JSON.parse(JSON.stringify(written)) }), { valid: true, issues: [] });
});
