// The contract's schema and fixtures are activitykit's own files, read from the crate that Cargo.lock names: the
// plugin keeps no copy of them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LAYOUT_FIXTURES, SCHEMA, activitykitDir, contract, contractPath } from '../tools/activitykit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');

// TP-CONTRACT-1
test("the schema and the fixtures are those of the activitykit crate that Cargo.lock names, and no copy is kept", () => {
  const dir = activitykitDir();
  const [, locked] = /\nname = "activitykit"\nversion = "([^"]+)"\n/.exec(read('Cargo.lock'));
  const manifest = readFileSync(join(dir, 'Cargo.toml'), 'utf8');
  assert.match(manifest, /^name = "activitykit"$/m);
  assert.ok(manifest.includes(`\nversion = "${locked}"\n`), locked);
  // The two files, where the crate has them.
  assert.equal(contractPath(SCHEMA), join(dir, 'contracts/request.schema.json'));
  assert.equal(contractPath(LAYOUT_FIXTURES), join(dir, 'tests/fixtures/layout-requests.json'));
  assert.equal(typeof contract(SCHEMA).$id, 'string');
  const fixtures = contract(LAYOUT_FIXTURES);
  assert.ok(fixtures.valid.length >= 100 && fixtures.invalid.length >= 100 && fixtures.updates.length >= 4 && fixtures.ends.length >= 4);
  // No copy here: the repository tracks neither file, and what reads them takes them from the crate.
  const tracked = execFileSync('git', ['ls-files', '--', 'contracts', 'tests/fixtures/layout-requests.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(tracked, '');
  assert.match(read('tools/validate-request.mjs'), /^const schema = contract\(SCHEMA\);$/m);
  for (const file of ['tests/layout-requests.test.mjs', 'tests/api.test.mjs']) {
    assert.match(read(file), /^const fixtures = contract\(LAYOUT_FIXTURES\);$/m, file);
  }
  assert.match(read('tests/contract.rs'), /\.join\("tests\/fixtures\/layout-requests\.json"\)/);
  assert.doesNotMatch(read('tests/contract.rs'), /include_str!\("fixtures\/layout-requests\.json"\)/);
  assert.throws(() => activitykitDir({ cargo: join(dir, 'no-such-cargo') }), /cargo metadata failed/);
});
