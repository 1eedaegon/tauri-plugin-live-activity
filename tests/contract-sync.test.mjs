// The contract's schema and fixtures here are activitykit's, from the version that Cargo.lock holds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CONTRACT_FILES, activitykitDir, differing } from '../tools/sync-contract.mjs';

// TP-CONTRACT-1
test("the schema and the fixtures are activitykit's, byte for byte", () => {
  const dir = activitykitDir();
  assert.match(readFileSync(join(dir, 'Cargo.toml'), 'utf8'), /^name = "activitykit"$/m);
  assert.deepEqual(differing(dir), []);
  assert.deepEqual(CONTRACT_FILES, ['contracts/request.schema.json', 'tests/fixtures/layout-requests.json']);
  const fixtures = JSON.parse(readFileSync(join(dir, CONTRACT_FILES[1]), 'utf8'));
  assert.ok(fixtures.ends.length >= 4);
  assert.throws(() => activitykitDir({ cargo: join(dir, 'no-such-cargo') }), /cargo metadata failed/);
});
