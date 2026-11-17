// The files of tests/fixtures/typescript are those that the tests keep (tests/typescript-requests.ts), which Rust
// judges (tests/typescript_requests.rs), and the script that writes them again runs each of those tests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { member, present, record, text } from './support.ts';
import { keep } from './typescript-requests.ts';
import type { FileSnapshotContext } from './typescript-requests.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const folder = new URL('./fixtures/typescript/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// TP-CONTRACT-9
test('the folder holds the files that the tests keep and no other, and write:requests runs each of those tests', () => {
  const scripts = record(member(JSON.parse(read('package.json')), 'scripts'), 'the scripts of package.json');
  const match = / --test-update-snapshots (.+)$/.exec(text(scripts['write:requests'], 'write:requests'));
  assert.ok(match, 'write:requests updates no snapshots');
  const written = present(match[1]).split(' ');
  // Every test file that keeps requests is one that the script runs: its file would not be written again otherwise.
  const keeping = execFileSync('git', ['grep', '-l', "typescript-requests.ts'", '--', '*.test.ts'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((file) => file !== '' && file !== 'tests/typescript-requests.test.ts');
  assert.deepEqual(keeping.sort(), [...written].sort());
  // Each keeps one file, and those are the files of the folder: one that no test keeps would be judged by Rust
  // though nothing builds it any more.
  const files = written.map((file) => {
    // A call at the start of a line: one in a comment keeps nothing.
    const names = Array.from(read(file).matchAll(/^\s*keep\(t, '([^']+)',/gm), ([, name]) => name);
    assert.equal(names.length, 1, file);
    return `${names[0]}.json`;
  });
  const held = readdirSync(folder).filter((file) => file.endsWith('.json'));
  assert.deepEqual(held.sort(), files.sort());
  // And `npm test` runs each of those tests, so a request that changes is seen.
  const suites = Object.keys(scripts).filter((name) => name.startsWith('test:'));
  for (const name of suites) assert.ok(text(scripts.test, 'test').includes(`npm run ${name}`), name);
  const run = suites.flatMap((name) => text(scripts[name], name).split(' '));
  for (const file of written) assert.ok(run.includes(file), file);
});

// TP-CONTRACT-9
test('keep compares the cases with its file as JSON, and a difference says how to write the files again', () => {
  const calls: Parameters<FileSnapshotContext['assert']['fileSnapshot']>[] = [];
  const cases = [{ name: 'a start', command: 'start_layout', input: { styles: undefined, values: { done: 0.5 } } }];
  keep({ assert: { fileSnapshot: (...given) => calls.push(given) } }, 'some', cases);
  const [kept, file, { serializers: [written] }] = present(calls[0]);
  assert.equal(kept, cases);
  assert.equal(file, fileURLToPath(new URL('some.json', folder)));
  // The JSON that crosses the IPC, where a member without a value is left out, with a last newline.
  assert.equal(written(cases), `${JSON.stringify([{ name: 'a start', command: 'start_layout', input: { values: { done: 0.5 } } }], null, 2)}\n`);
  assert.equal(written([]), '[]\n');
  const differs = new Error('differs');
  assert.throws(() => keep({ assert: { fileSnapshot() { throw differs; } } }, 'some', cases), (error) => {
    assert.equal(member(error, 'message'), 'tests/fixtures/typescript/some.json is not what this test builds. '
      + 'Write it again and let Rust judge it: npm run write:requests && cargo test --test typescript_requests');
    assert.equal(member(error, 'cause'), differs);
    return true;
  });
});
