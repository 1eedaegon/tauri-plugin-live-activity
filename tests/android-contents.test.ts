// The Android contents of tests/fixtures/android/contents.json on the JavaScript side. The same contents go through
// the Rust models (tests/android_contents.rs) and to liveupdate's Android side (NativeBridgeTest.kt, on a device).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
// `member` is a name of this file's own: a member of an object on the way through a content.
import { isRecord, list, member as memberOf, present, record, text } from './support.ts';
import type { JsonObject } from './support.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const tsc = join(root, 'node_modules/.bin/tsc');
const FIXTURES = 'tests/fixtures/android';
const cases = list(JSON.parse(read(`${FIXTURES}/contents.json`)), 'contents.json').map((entry) => record(entry, 'a case of contents.json'));
const contents = cases.map((entry) => record(entry.content, 'the content of a case'));
// The modules that the compiler checks are written outside the checkout, so two runs do not meet.
const written = mkdtempSync(join(tmpdir(), 'android-contents-'));
after(() => rmSync(written, { recursive: true, force: true }));

/** The path of what `value` holds, after the path `at` that leads to it: a variant of a union adds its `kind`. */
const inside = (value: JsonObject, at: string): string => (typeof value.kind === 'string' ? `${at}<${value.kind}>` : at);

/** The paths of the members that `value` holds, written as tests/declarations/members.ts writes those of a type. */
function held(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => held(item, `${at}[]`));
  if (!isRecord(value)) return [`${at}:${typeof value}`];
  return Object.entries(value).flatMap(([name, member]) => held(member, `${inside(value, at)}/${name}`));
}

/** An object that a value holds: its path and the names of its members. */
type Found = readonly [at: string, members: readonly string[]];

/** Every object in `value`: its path and the names of its members. */
function objects(value: unknown, at = ''): Found[] {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => objects(item, `${at}[]`));
  if (!isRecord(value)) return [];
  const here = inside(value, at);
  return [[here, Object.keys(value)], ...Object.entries(value).flatMap(([name, member]) => objects(member, `${here}/${name}`))];
}

/** The paths of the members that one object of `values` has and another, at the same place, lacks. */
function leftOut(values: readonly unknown[]): string[] {
  const places = Map.groupBy(values.flatMap((value) => objects(value)), ([at]) => at);
  return [...places].flatMap(([at, found]) => {
    const names = [...new Set(found.flatMap(([, members]) => members))];
    return names.filter((name) => found.some(([, members]) => !members.includes(name))).map((name) => `${at}/${name}`);
  });
}

const union = (paths: readonly string[]): string => [...new Set(paths)].sort().map((path) => JSON.stringify(path)).join(' | ') || 'never';
const from = (path: string): string => JSON.stringify(join(root, path));

/** A module in which `values` are Android contents, and their members those that `AndroidContent` declares. */
const source = (values: readonly unknown[]): string => `import type { AndroidContent, AndroidSemanticStyle } from ${from('guest-js/types.js')};
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
const compile = (file: string): SpawnSyncReturns<string> => spawnSync(tsc, [
  '--ignoreConfig', '--noEmit', '--pretty', 'false', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck',
  '--target', 'ES2021', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file,
], { encoding: 'utf8' });

/** What the compiler says of `values` as Android contents. */
function compileContents(name: string, values: readonly unknown[]): SpawnSyncReturns<string> {
  const file = join(written, `${name}.mts`);
  writeFileSync(file, source(values));
  return compile(file);
}

const style = (content: JsonObject): JsonObject => record(memberOf(content, 'presentation', 'style'), 'the style of a content');
const SUMMARY = '/presentation/style<bigText>/value/summary';

// TP-JS-7
test('the TypeScript declarations take every Android content of the fixture and declare no member beside theirs', () => {
  const compiled = compileContents('contents', contents);
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);

  // Each difference between the declarations and the contents stops the compiler, which names its path.
  const refused = (name: string, values: readonly unknown[], said: readonly string[]): void => {
    const result = compileContents(name, values);
    assert.notEqual(result.status, 0, name);
    assert.ok(said.every((part) => result.stdout.includes(part)), `${name}: ${result.stdout}`);
  };
  const plain = present(contents[0], 'the first content');
  // A member that TypeScript does not declare, which Rust would have written.
  refused('undeclared', [...contents, { ...plain, presentation: { ...record(plain.presentation), category: 'Zzz' } }],
    ["does not exist in type 'AndroidPresentation'", "'heldOnly'", '"/presentation/category:string"']);
  // A declared member that no content holds, so that nothing shows that Rust reads it.
  const summarized = (content: JsonObject): boolean => style(content).kind === 'bigText' && 'summary' in record(style(content).value);
  refused('unread', contents.filter((content) => !summarized(content)), ["'declaredOnly'", `"${SUMMARY}:string"`]);
  // A member that TypeScript declares optional and that every content gives, so that Rust may well require it.
  const unsummarized = (content: JsonObject): boolean => style(content).kind === 'bigText' && !('summary' in record(style(content).value));
  refused('always-given', contents.filter((content) => !unsummarized(content)), ["'alwaysGiven'", `"${SUMMARY}"`]);
  // A member that a content leaves out, as Rust does when it writes one, and that TypeScript requires.
  const timer = present(contents.find((content) => style(content).kind === 'timer'), 'a content with a timer');
  const { countsDown, ...uncounted } = record(style(timer).value);
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

// TP-ANDROID-14
test("the Android library's device tests read the fixture, and every content says what liveupdate's Android side answers", () => {
  const [, assets] = /getByName\("androidTest"\)\.assets\.srcDir\("([^"]+)"\)/.exec(read('android/build.gradle.kts')) ?? [];
  assert.ok(assets, 'android/build.gradle.kts names no assets for its device tests');
  assert.equal(join(root, 'android', assets), join(root, FIXTURES));
  assert.ok(existsSync(join(root, 'android', assets, 'contents.json')));
  const deviceTest = read('android/src/androidTest/java/io/github/eedaegon/liveactivity/NativeBridgeTest.kt');
  assert.match(deviceTest, /assets\.open\("contents\.json"\)/);
  // The icons from files are one picture in the folder of `writeImage`, which the device test writes there.
  const folder = present(/const IMAGE_FOLDER: &str = "([^"]+)";/.exec(read('src/files.rs'))?.[1], 'the IMAGE_FOLDER of src/files.rs');
  const files = (value: unknown): unknown[] => {
    if (typeof value !== 'object' || value === null) return [];
    return memberOf(value, 'kind') === 'appFile' ? [memberOf(value, 'value')] : Object.values(value).flatMap(files);
  };
  assert.deepEqual([...new Set(contents.flatMap(files))], [`${folder}/badge.png`]);
  assert.ok(deviceTest.includes(`File(context.filesDir, "${folder}/badge.png")`));
  // liveupdate's Android side refuses what the app does not have: an icon that is no resource of it, and a URL that
  // none of its activities opens. The icons from the resources are drawables of the library, and the URLs are of the
  // schemes that the activity of the device tests declares.
  const named = (member: (name: string, held: unknown, holder: object) => string[]) => (value: unknown): string[] => {
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([name, held]: [string, unknown]) => [...member(name, held, value), ...named(member)(held)]);
  };
  const resources = named((name, held, holder) => (name === 'value' && memberOf(holder, 'kind') === 'resource' ? [text(held)] : []));
  for (const resource of new Set(contents.flatMap(resources))) {
    assert.ok(existsSync(join(root, 'android/src/main/res/drawable', `${resource}.xml`)), resource);
  }
  const urls = named((name, held) => (name === 'openUrl' ? [text(held)] : []));
  const schemes = [...new Set(contents.flatMap(urls).map((url) => url.slice(0, url.indexOf(':'))))];
  // What the test app's activities take, inside `application`: above it the manifest names an intent that the app
  // asks the system about, which is no scheme of its own.
  const manifest = read('android/src/androidTest/AndroidManifest.xml');
  const application = manifest.slice(manifest.indexOf('<application'));
  assert.ok(schemes.length > 0);
  assert.deepEqual(schemes, Array.from(application.matchAll(/<data android:scheme="([^"]+)"/g), ([, scheme]) => scheme));

  for (const { name, android, why } of cases) {
    assert.ok(['ok', 'INVALID_INPUT'].includes(text(android, `android of ${name}`)), text(name));
    // A content that the Android side refuses is a known difference and says why.
    assert.equal(typeof why === 'string', android !== 'ok', text(name));
  }
  assert.equal(new Set(cases.map((entry) => entry.name)).size, cases.length);
});
