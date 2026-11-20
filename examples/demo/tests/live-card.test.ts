import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import type { ComponentType, ReactElement } from 'react';
import type { Layout, LayoutStyle, LayoutUpdateInput, LayoutValues } from '../../../guest-js/index.js';
import { member, record, unchecked } from '../../../tests/support.ts';
import { keep } from '../../../tests/typescript-requests.ts';
import { pluginSource } from '../plugin-source.ts';
import { liveKey } from '../src/live-page.ts';

/** The page as the app runs it, with what the test drives it by: one React, shared by the page and the renderer. */
interface PageModule {
  readonly LiveCard: ComponentType<{ readonly leftovers: string | undefined }>;
  readonly layout: Layout;
  readonly styles: { readonly [token: string]: LayoutStyle };
  readonly values: LayoutValues;
  readonly act: (work: () => Promise<void>) => Promise<void>;
  readonly createElement: (type: ComponentType<{ readonly leftovers: string | undefined }>, props: { readonly leftovers: string | undefined }) => ReactElement;
  readonly TestRenderer: { readonly create: (element: ReactElement) => { readonly unmount: () => void; readonly toJSON: () => unknown } };
  readonly mockIPC: (handler: (command: string, payload: unknown) => unknown, options: { readonly shouldMockEvents: boolean }) => void;
  readonly clearMocks: () => void;
}

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string): unknown => JSON.parse(readFileSync(at(path), 'utf8'));

const asSource: Plugin = {
  name: 'the plugin as source',
  setup: (plugin) => plugin.onResolve({ filter: /^tauri-plugin-live-activity(\/|$)/ }, ({ path }) => {
    const file = pluginSource[path];
    return file === undefined ? { errors: [{ text: `${path} is no entry point of the plugin` }] } : { path: file };
  }),
};

const out = at('out');
after(() => rmSync(out, { recursive: true, force: true }));

/**
 * The page's modules as Vite gives them to the app in a dev run: the card's JSX through the plugin's dev runtime, the
 * page's through React's, and the plugin as source (vite.config.ts). React, its test renderer and Tauri's API stay
 * outside the bundle, so that the page and the test share them: React bundled into an ES module would schedule its
 * act() through a MessageChannel, whose ports keep Node from ending.
 */
async function page(): Promise<PageModule> {
  const entry = [
    "export { LiveCard } from './src/live/LiveCard.tsx';",
    "export { layout, styles, values } from './src/live/card.tsx';",
    "export { act, createElement } from 'react';",
    "export { default as TestRenderer } from 'react-test-renderer';",
    "export { clearMocks, mockIPC } from '@tauri-apps/api/mocks';",
  ].join('\n');
  const outfile = join(out, 'page.mjs');
  await build({
    stdin: { contents: entry, resolveDir: at('..'), loader: 'ts', sourcefile: 'page.ts' },
    plugins: [asSource], bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', jsxDev: true,
    external: ['react', 'react/*', 'react-test-renderer', '@tauri-apps/api', '@tauri-apps/api/*'],
    outfile, logLevel: 'silent',
  });
  return unchecked<PageModule>(await import(pathToFileURL(outfile).href));
}

test('the card compiles to a layout that shows every one of its values, and only those', async () => {
  const { layout, values } = await page();
  const bound = new Set([...JSON.stringify(layout).matchAll(/"bind":"(\w+)"/g)].map((match) => match[1]));
  assert.deepEqual([...bound].sort(), Object.keys(values).sort());
});

test('the page starts the card under its key, and that start and an update of it are what Rust judges', async (t) => {
  const live = await page();
  // The event mock draws its listener ids from window.crypto; React's act wants to know it runs in a test.
  Reflect.set(globalThis, 'window', { crypto: globalThis.crypto });
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const sent: { readonly name: string; readonly input: unknown }[] = [];
  live.mockIPC((command, payload) => {
    if (!command.startsWith('plugin:live-activity|')) return undefined;
    const name = command.slice('plugin:live-activity|'.length);
    const input = member(payload, 'input');
    sent.push({ name, input });
    return {
      id: 'handle', activityKey: member(input, 'activityKey') ?? 'live:x', schemaVersion: 2,
      snapshot: member(input, 'snapshot') ?? { revision: 0, values: {} }, backend: 'activityKit',
      state: name === 'end_layout' ? 'ended' : 'active', visibility: 'unknown', degradedFeatures: [],
      promotionRequested: false, promotionState: 'notApplicable',
    };
  }, { shouldMockEvents: true });
  let view: ReturnType<PageModule['TestRenderer']['create']> | undefined;
  await live.act(async () => {
    view = live.TestRenderer.create(live.createElement(live.LiveCard, { leftovers: undefined }));
  });
  const start = sent.find(({ name }) => name === 'start_layout')?.input;
  const key = liveKey(live.layout, live.styles, live.values);
  assert.equal(member(start, 'activityKey'), key);
  assert.deepEqual(member(start, 'snapshot'), { revision: 0, values: live.values });
  assert.match(JSON.stringify(view?.toJSON()), new RegExp(`"${key}".*"active"`));
  await live.act(async () => view?.unmount());
  assert.deepEqual(sent.map(({ name }) => name), ['start_layout', 'end_layout']);
  live.clearMocks();

  const update: LayoutUpdateInput = {
    id: 'handle', snapshot: { revision: 1, values: { ...live.values, status: 'On the way', eta: '4 min', done: 0.7 } },
  };
  keep(t, 'demo-live', [
    { name: 'the live card, a start', command: 'start_layout', input: start },
    { name: 'the live card, a save of other values', command: 'update_layout', input: update, after: 'the live card, a start' },
  ]);
});

test('Vite, the type check and the package name the same files of the plugin', () => {
  const exported = record(member(read('../../../package.json'), 'exports'), 'the exports of package.json');
  const paths = record(member(member(read('../tsconfig.live.json'), 'compilerOptions'), 'paths'), 'the paths of tsconfig.live.json');
  const specifiers = Object.keys(exported).filter((path) => path !== './package.json')
    .map((path) => `tauri-plugin-live-activity${path.slice(1)}`).sort();
  assert.deepEqual(Object.keys(pluginSource).sort(), specifiers);
  assert.deepEqual(Object.keys(paths).sort(), specifiers);
  for (const specifier of specifiers) {
    const shipped = String(member(exported[`.${specifier.slice('tauri-plugin-live-activity'.length)}`], 'import'));
    const source = shipped.replace('./dist-js/', 'guest-js/').replace(/\.js$/, '.ts');
    assert.equal(pluginSource[specifier], fileURLToPath(new URL(`../../../${source}`, import.meta.url)), specifier);
    assert.deepEqual(paths[specifier], [`../../${source}`], specifier);
  }
});

test('the app loads the page from the port that Vite serves, and Vite serves only the page\'s folders', async () => {
  const { default: config } = unchecked<{ default: { server: { port: number; fs: { allow: string[] } } } }>(
    await import('../vite.config.ts'));
  const live = record(member(read('../src-tauri/tauri.live.conf.json'), 'build'), 'the build of tauri.live.conf.json');
  assert.equal(new URL(String(live['devUrl'])).port, String(config.server.port));
  const repository = fileURLToPath(new URL('../../../', import.meta.url));
  assert.ok(!config.server.fs.allow.some((folder) => repository.startsWith(`${folder}/`) || `${folder}/` === repository),
    'Vite may serve the whole repository');
});
