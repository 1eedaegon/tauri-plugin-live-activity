// The contract's layout fixtures are activitykit's own file, read from the crate that Cargo.lock names: the plugin
// keeps no copy of it, nor of activitykit's schema, which nothing here runs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LAYOUT_FIXTURES, activitykitDir, contract, contractPath } from '../tools/activitykit.ts';
import { list, record } from './support.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

// TP-CONTRACT-1
test('the layout fixtures are those of the activitykit crate that Cargo.lock names, and no copy of them or of the schema is kept', () => {
  const dir = activitykitDir();
  const match = /\nname = "activitykit"\nversion = "([^"]+)"\n/.exec(read('Cargo.lock'));
  assert.ok(match, 'Cargo.lock names no activitykit');
  const [, locked] = match;
  const manifest = readFileSync(join(dir, 'Cargo.toml'), 'utf8');
  assert.match(manifest, /^name = "activitykit"$/m);
  assert.ok(manifest.includes(`\nversion = "${locked}"\n`), locked);
  // The file, where the crate has it.
  assert.equal(contractPath(LAYOUT_FIXTURES), join(dir, 'tests/fixtures/layout-requests.json'));
  const fixtures = record(contract(LAYOUT_FIXTURES), 'the layout fixtures');
  assert.ok(list(fixtures.valid, 'valid').length >= 100 && list(fixtures.invalid, 'invalid').length >= 100
    && list(fixtures.updates, 'updates').length >= 4 && list(fixtures.ends, 'ends').length >= 4);
  // No copy here: the repository tracks neither the fixtures nor the schema (`contracts`), and the two tests that
  // read the fixtures take them from the crate.
  const tracked = execFileSync('git', ['ls-files', '--', 'contracts', 'tests/fixtures/layout-requests.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(tracked, '');
  assert.match(read('tests/api.test.ts'), /^const fixtures = contract\(LAYOUT_FIXTURES\);$/m);
  assert.match(read('tests/contract.rs'), /\.join\("tests\/fixtures\/layout-requests\.json"\)/);
  assert.throws(() => activitykitDir({ cargo: join(dir, 'no-such-cargo') }), /cargo metadata failed/);
});

// TP-IOS-19
test('the documents give buttons and toggles the iOS from which the activitykit in Cargo.lock runs them', () => {
  // activitykit says `buttons` from the iOS where the system runs its intent, and its widget draws a control there.
  const system = readFileSync(join(activitykitDir(), 'swift/Sources/ActivityKitBridge/ActivityKitSystem.swift'), 'utf8');
  const from = /if #available\(iOS (\d+(?:\.\d+)?), \*\) \{ buttons = true \}/.exec(system)?.[1];
  assert.ok(from, 'activitykit says from which iOS buttons run');
  const wanted = `iOS ${from.replace(/\.0$/, '')}`;
  // Every line of the documents and declarations that gives a button, a toggle or its switch an iOS of 17 gives that
  // one; the records of earlier runs keep what was true then.
  const files = ['README.md', 'README.ko.md', 'docs/usage.md', 'docs/ios-integration.md', 'docs/compatibility.md',
    'docs/platform-coverage.md', 'docs/request-contract.md', 'docs/spec.md', 'guest-js/types.ts'];
  const control = /button|toggle|switch|actions|버튼|토글/i;
  let lines = 0;
  for (const file of files) {
    for (const [index, line] of read(file).split('\n').entries()) {
      if (!control.test(line)) continue;
      for (const [said] of line.matchAll(/\biOS 17(?:\.\d+)?(?!\d|\.\d)/g)) {
        lines += 1;
        assert.equal(said, wanted, `${file}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  assert.ok(lines >= 10, `the documents name the iOS of buttons on ${lines} lines`);
});

