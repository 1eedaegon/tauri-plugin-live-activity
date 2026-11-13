// The Android contents of tests/fixtures/android/contents.json on the JavaScript side. The same contents go through
// the Rust models (tests/android_contents.rs) and to liveupdate's Android side (NativeBridgeTest.kt, on a device).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateRequest } from '../tools/validate-request.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const tsc = join(root, 'node_modules/.bin/tsc');
const FIXTURES = 'tests/fixtures/android';
const cases = JSON.parse(read(`${FIXTURES}/contents.json`));
const contents = cases.map((entry) => entry.content);
// The modules that the compiler checks are written outside the checkout, so two runs do not meet.
const written = mkdtempSync(join(tmpdir(), 'android-contents-'));
after(() => rmSync(written, { recursive: true, force: true }));

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The path of what `value` holds, after the path `at` that leads to it: a variant of a union adds its `kind`. */
const inside = (value, at) => (typeof value.kind === 'string' ? `${at}<${value.kind}>` : at);

/** The paths of the members that `value` holds, written as tests/declarations/members.ts writes those of a type. */
function held(value, at = '') {
  if (Array.isArray(value)) return value.flatMap((item) => held(item, `${at}[]`));
  if (!isObject(value)) return [`${at}:${typeof value}`];
  return Object.entries(value).flatMap(([name, member]) => held(member, `${inside(value, at)}/${name}`));
}

/** Every object in `value`: its path and the names of its members. */
function objects(value, at = '') {
  if (Array.isArray(value)) return value.flatMap((item) => objects(item, `${at}[]`));
  if (!isObject(value)) return [];
  const here = inside(value, at);
  return [[here, Object.keys(value)], ...Object.entries(value).flatMap(([name, member]) => objects(member, `${here}/${name}`))];
}

/** The paths of the members that one object of `values` has and another, at the same place, lacks. */
function leftOut(values) {
  const places = Map.groupBy(values.flatMap((value) => objects(value)), ([at]) => at);
  return [...places].flatMap(([at, found]) => {
    const names = [...new Set(found.flatMap(([, members]) => members))];
    return names.filter((name) => found.some(([, members]) => !members.includes(name))).map((name) => `${at}/${name}`);
  });
}

const union = (paths) => [...new Set(paths)].sort().map((path) => JSON.stringify(path)).join(' | ') || 'never';
const from = (path) => JSON.stringify(join(root, path));

/** A module in which `values` are Android contents, and their members those that `AndroidContent` declares. */
const source = (values) => `import type { AndroidContent, AndroidSemanticStyle } from ${from('guest-js/types.js')};
import type { Called, Matched, Same, Unmatched } from ${from('tests/declarations/members.js')};

export const contents: readonly AndroidContent[] = ${JSON.stringify(values, null, 2)};

type Held = ${union(values.flatMap((value) => held(value)))};
type LeftOut = ${union(leftOut(values))};
declare const unmatched: Unmatched<AndroidContent, Held, LeftOut>;
export const matched: Matched = unmatched;

// The fixture has each semantic style somewhere, not at every place: the places are tied to the one union, which
// src/types_tests.rs compares with Rust's.
type Semantic = Same<Called<AndroidContent, 'semanticStyle'>, [AndroidSemanticStyle]>;
export const semantic: Semantic extends true ? true : 'a semanticStyle is not AndroidSemanticStyle' = true;
`;

/** What the compiler says of a module, as strict about a declaration as the plugin's own tsconfig. */
const compile = (file) => spawnSync(tsc, [
  '--ignoreConfig', '--noEmit', '--pretty', 'false', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck',
  '--target', 'ES2021', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file,
], { encoding: 'utf8' });

/** What the compiler says of `values` as Android contents. */
function compileContents(name, values) {
  const file = join(written, `${name}.mts`);
  writeFileSync(file, source(values));
  return compile(file);
}

const style = (content) => content.presentation.style;
const SUMMARY = '/presentation/style<bigText>/value/summary';

// TP-JS-7
test('the TypeScript declarations take every Android content of the fixture and declare no member beside theirs', () => {
  const compiled = compileContents('contents', contents);
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);

  // Each difference between the declarations and the contents stops the compiler, which names its path.
  const refused = (name, values, said) => {
    const result = compileContents(name, values);
    assert.notEqual(result.status, 0, name);
    assert.ok(said.every((part) => result.stdout.includes(part)), `${name}: ${result.stdout}`);
  };
  const [plain] = contents;
  // A member that TypeScript does not declare, which Rust would have written.
  refused('undeclared', [...contents, { ...plain, presentation: { ...plain.presentation, category: 'Zzz' } }],
    ["does not exist in type 'AndroidPresentation'", "'heldOnly'", '"/presentation/category:string"']);
  // A declared member that no content holds, so that nothing shows that Rust reads it.
  const summarized = (content) => style(content).kind === 'bigText' && 'summary' in style(content).value;
  refused('unread', contents.filter((content) => !summarized(content)), ["'declaredOnly'", `"${SUMMARY}:string"`]);
  // A member that TypeScript declares optional and that every content gives, so that Rust may well require it.
  const unsummarized = (content) => style(content).kind === 'bigText' && !('summary' in style(content).value);
  refused('always-given', contents.filter((content) => !unsummarized(content)), ["'alwaysGiven'", `"${SUMMARY}"`]);
  // A member that a content leaves out, as Rust does when it writes one, and that TypeScript requires.
  const timer = contents.find((content) => style(content).kind === 'timer');
  const { countsDown, ...uncounted } = style(timer).value;
  assert.equal(typeof countsDown, 'boolean');
  const without = { ...timer, presentation: { style: { kind: 'timer', value: uncounted } } };
  refused('required', [...contents, without], ["'countsDown'", "'wronglyRequired'", '"/presentation/style<timer>/value/countsDown"']);
  // A value of another kind than the declared one: the title as a number.
  refused('another-kind', [...contents, { ...plain, title: 7 }], ["'heldOnly'", '"/title:number"']);
});

// TP-JS-7
test('the types that compare a declaration with a fixture give what members.check.ts says of a small type', () => {
  const compiled = compile(join(root, 'tests/declarations/members.check.ts'));
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});

// TP-CONTRACT-8
test('the reference validator takes every Android content of the fixture in a snapshot', () => {
  for (const { name, content } of cases) {
    const request = { command: 'update_layout', input: { id: 'opaque-handle-1', snapshot: { revision: 1, values: { title: 'Mochi' }, android: content } } };
    assert.deepEqual(validateRequest(request), { valid: true, issues: [] }, name);
  }
});

// TP-ANDROID-14
test("the Android library's device tests read the fixture, and every content says what liveupdate's Android side answers", () => {
  const [, assets] = /getByName\("androidTest"\)\.assets\.srcDir\("([^"]+)"\)/.exec(read('android/build.gradle.kts')) ?? [];
  assert.ok(assets, 'android/build.gradle.kts names no assets for its device tests');
  assert.equal(join(root, 'android', assets), join(root, FIXTURES));
  assert.ok(existsSync(join(root, 'android', assets, 'contents.json')));
  const deviceTest = read('android/src/androidTest/java/io/github/eedaegon/liveactivity/NativeBridgeTest.kt');
  assert.match(deviceTest, /assets\.open\("contents\.json"\)/);
  // The icons from files are one picture in the folder of `writeImage`, which the device test writes there.
  const [, folder] = /const val IMAGE_FOLDER = "([^"]+)"/.exec(read('android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt'));
  const files = (value) => {
    if (typeof value !== 'object' || value === null) return [];
    return value.kind === 'appFile' ? [value.value] : Object.values(value).flatMap(files);
  };
  assert.deepEqual([...new Set(contents.flatMap(files))], [`${folder}/badge.png`]);
  assert.ok(deviceTest.includes(`File(context.filesDir, "${folder}/badge.png")`));
  // liveupdate's Android side refuses what the app does not have: an icon that is no resource of it, and a URL that
  // none of its activities opens. The icons from the resources are drawables of the library, and the URLs are of the
  // schemes that the activity of the device tests declares.
  const named = (member) => (value) => {
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([name, held]) => [...member(name, held, value), ...named(member)(held)]);
  };
  const resources = named((name, held, holder) => (name === 'value' && holder.kind === 'resource' ? [held] : []));
  for (const resource of new Set(contents.flatMap(resources))) {
    assert.ok(existsSync(join(root, 'android/src/main/res/drawable', `${resource}.xml`)), resource);
  }
  const urls = named((name, held) => (name === 'openUrl' ? [held] : []));
  const schemes = [...new Set(contents.flatMap(urls).map((url) => url.slice(0, url.indexOf(':'))))];
  const manifest = read('android/src/androidTest/AndroidManifest.xml');
  assert.ok(schemes.length > 0);
  assert.deepEqual(schemes, Array.from(manifest.matchAll(/<data android:scheme="([^"]+)"/g), ([, scheme]) => scheme));

  for (const { name, android, android16, why } of cases) {
    assert.ok(['ok', 'INVALID_INPUT'].includes(android), name);
    assert.ok([undefined, 'NATIVE_ERROR'].includes(android16), name);
    // A content that the Android side refuses, on every Android or on Android 16, is a known difference and says why.
    assert.equal(typeof why === 'string', android !== 'ok' || android16 !== undefined, name);
  }
  assert.equal(new Set(cases.map((entry) => entry.name)).size, cases.length);
});
