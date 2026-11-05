import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateReleaseMetadata,
  requireSuccessfulCiRun,
  checkNpmRegistry,
  checkCargoRegistry,
  requireFrozenArtifacts,
} from '../../tools/release-guard.mjs';

const name = 'tauri-plugin-live-activity';
const version = '0.1.0-alpha.3';
const repository = '1eedaegon/tauri-plugin-live-activity';
const headSha = 'a'.repeat(40);
const metadata = (release = version) => ({
  tag: `v${release}`,
  npmManifest: { name, version: release },
  cargoPackage: { name, version: release },
});
const ciRun = (overrides = {}) => ({
  id: 123,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  head_branch: 'main',
  head_sha: headSha,
  path: '.github/workflows/ci.yml',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});
const npmExpected = {
  name, version, shasum: 'b'.repeat(40),
  integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
};
const npmBody = (overrides = {}) => ({
  name, version, dist: { shasum: npmExpected.shasum, integrity: npmExpected.integrity },
  ...overrides,
});
const cargoExpected = { name, version, checksum: 'c'.repeat(64) };
const cargoRecord = (overrides = {}) => ({
  name, vers: version, cksum: cargoExpected.checksum, yanked: false, ...overrides,
});
const frozenArtifacts = () => ({
  version, sourceCommit: headSha,
  npm: { ...npmExpected, tarSha256: 'd'.repeat(64) },
  cargo: { name, sha256: cargoExpected.checksum },
});
const rebuiltRelease = () => ({
  version, sourceCommit: headSha,
  npm: { ...npmExpected, shasum: 'e'.repeat(40), integrity: `sha512-${Buffer.alloc(64, 2).toString('base64')}` },
  cargo: { ...cargoExpected },
});

test('release metadata preserves SemVer and chooses the explicit npm channel', () => {
  for (const release of ['0.1.0-alpha.3', '1.2.3-0', '1.2.3-01a', '1.2.3-rc.1+build.05']) {
    assert.deepEqual(validateReleaseMetadata(metadata(release)), { version: release, distTag: 'next' });
  }
  for (const release of ['0.0.0', '1.2.3', '1.2.3+build.05']) {
    assert.deepEqual(validateReleaseMetadata(metadata(release)), { version: release, distTag: 'latest' });
  }
});

test('release metadata rejects malformed tags, controls, leading zeros and command text', () => {
  for (const tag of [undefined, null, 123, '', '0.1.0', 'refs/tags/v0.1.0', 'v01.2.3',
    'v1.02.3', 'v1.2.03', 'v1.2', 'v1.2.3-01', 'v1.2.3-alpha.01', 'v1.2.3-',
    'v1.2.3-alpha..1', 'v1.2.3+', 'v1.2.3+meta..x', 'v1.2.3\n', 'v1.2.3\r',
    ' v1.2.3', 'v1.2.3;echo unsafe', 'v1.2.3-한글']) {
    assert.throws(() => validateReleaseMetadata({ ...metadata(), tag }), /tag/i, String(tag));
  }
});

test('both package names and versions must match the release exactly', () => {
  for (const field of ['npmManifest', 'cargoPackage']) {
    for (const invalid of [undefined, null, {}, { name: 'other', version },
      { name, version: '0.1.0-alpha.2' }, { name, version: `v${version}` }]) {
      assert.throws(() => validateReleaseMetadata({ ...metadata(), [field]: invalid }), /package/i);
    }
  }
});

test('CI accepts a completed main push or manual run for the exact trusted source', () => {
  const run = ciRun();
  assert.equal(requireSuccessfulCiRun([ciRun({ conclusion: 'failure' }), run], { repository, headSha }), run);
  const dispatched = ciRun({ event: 'workflow_dispatch', path: '.github/workflows/ci.yml@refs/heads/main' });
  assert.equal(requireSuccessfulCiRun([dispatched], { repository, headSha }), dispatched);
  const qualified = ciRun({ path: '.github/workflows/ci.yml@main' });
  assert.equal(requireSuccessfulCiRun([qualified], { repository, headSha }), qualified);
});

test('CI blocks wrong repositories, branches, workflows, SHAs, triggers and incomplete runs', () => {
  for (const changes of [
    { repository: { full_name: 'attacker/fork' } }, { repository: null },
    { head_repository: { full_name: 'attacker/fork' } }, { head_repository: null },
    { head_branch: 'release' }, { head_sha: 'd'.repeat(40) }, { head_sha: `${headSha}\n` },
    { path: '.github/workflows/publish.yml' }, { path: '.github/workflows/ci.yml.evil' },
    { path: '.github/workflows/ci.yml@attacker' },
    { path: '.github/workflows/ci.yml@' }, { path: '.github/workflows/ci.yml\n' },
    { event: 'pull_request' }, { event: 'pull_request_target' }, { event: 'workflow_run' },
    { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' },
    { conclusion: 'skipped' }, { conclusion: null },
  ]) {
    assert.throws(() => requireSuccessfulCiRun([ciRun(changes)], { repository, headSha }), /CI/);
  }
  for (const runs of [[], null, {}, [null, {}]]) {
    assert.throws(() => requireSuccessfulCiRun(runs, { repository, headSha }), /CI/);
  }
  for (const options of [{ repository, headSha: 'abc' }, { repository, headSha: `${headSha}\n` },
    { repository: '', headSha }, { repository: 'owner/repo/extra', headSha }]) {
    assert.throws(() => requireSuccessfulCiRun([ciRun()], options), /CI/);
  }
});

test('only explicit HTTP 404 permits a missing registry resource', () => {
  assert.equal(checkNpmRegistry({ status: 404, expected: npmExpected }), 'missing');
  assert.equal(checkCargoRegistry({ status: 404, expected: cargoExpected }), 'missing');
  for (const status of [undefined, '404', 0, 201, 204, 301, 400, 401, 403, 408, 429, 500, 502, 503]) {
    assert.throws(() => checkNpmRegistry({ status, body: npmBody(), expected: npmExpected }), /HTTP/);
    assert.throws(() => checkCargoRegistry({ status, records: [cargoRecord()], expected: cargoExpected }), /HTTP/);
  }
});

test('existing npm publication must match both digests and identity', () => {
  assert.equal(checkNpmRegistry({ status: 200, body: npmBody(), expected: npmExpected }), 'matching');
  for (const body of [null, {}, npmBody({ name: 'other' }), npmBody({ version: '0.1.0' }),
    npmBody({ dist: null }), npmBody({ dist: { ...npmBody().dist, shasum: 'd'.repeat(40) } }),
    npmBody({ dist: { ...npmBody().dist, integrity: `sha512-${Buffer.alloc(64, 2).toString('base64')}` } })]) {
    assert.throws(() => checkNpmRegistry({ status: 200, body, expected: npmExpected }), /npm/);
  }
});

test('Cargo sparse index distinguishes a new version from matching and unsafe existing versions', () => {
  assert.equal(checkCargoRegistry({ status: 200, records: [cargoRecord()], expected: cargoExpected }), 'matching');
  assert.equal(checkCargoRegistry({ status: 200, records: [cargoRecord({ vers: '0.1.0-alpha.2' })], expected: cargoExpected }), 'missing');
  assert.equal(checkCargoRegistry({ status: 200, records: [cargoRecord({ vers: '0.1.0-alpha.2', yanked: true })], expected: cargoExpected }), 'missing');
  for (const records of [null, {}, [], [null], [cargoRecord({ name: 'other' })],
    [cargoRecord({ vers: 'invalid' })], [cargoRecord({ yanked: true })], [cargoRecord({ yanked: undefined })],
    [cargoRecord({ cksum: 'd'.repeat(64) })], [cargoRecord({ cksum: 'invalid' })],
    [cargoRecord(), cargoRecord()]]) {
    assert.throws(() => checkCargoRegistry({ status: 200, records, expected: cargoExpected }), /Cargo/);
  }
});

test('bad expected metadata fails even when the registry returns 404', () => {
  for (const expected of [null, {}, { ...npmExpected, name: 'other' },
    { ...npmExpected, version: 'bad' }, { ...npmExpected, shasum: 'z'.repeat(40) },
    { ...npmExpected, shasum: `${npmExpected.shasum}\n` },
    { ...npmExpected, integrity: 'sha512-invalid' }, { ...npmExpected, integrity: `${npmExpected.integrity}\n` }]) {
    assert.throws(() => checkNpmRegistry({ status: 404, expected }), /npm/);
  }
  for (const expected of [null, {}, { ...cargoExpected, name: 'other' },
    { ...cargoExpected, version: 'bad' }, { ...cargoExpected, checksum: 'z'.repeat(64) },
    { ...cargoExpected, checksum: `${cargoExpected.checksum}\n` }]) {
    assert.throws(() => checkCargoRegistry({ status: 404, expected }), /Cargo/);
  }
});

test('guards leave frozen caller inputs unchanged', () => {
  const inputs = [metadata(), [ciRun()], npmBody(), [cargoRecord()]];
  const before = JSON.stringify(inputs);
  validateReleaseMetadata(Object.freeze(inputs[0]));
  requireSuccessfulCiRun(Object.freeze(inputs[1]), { repository, headSha });
  checkNpmRegistry({ status: 200, body: Object.freeze(inputs[2]), expected: Object.freeze(npmExpected) });
  checkCargoRegistry({ status: 200, records: Object.freeze(inputs[3]), expected: Object.freeze(cargoExpected) });
  assert.equal(JSON.stringify(inputs), before);
});

test('frozen release accepts compression-only differences after full tar and Cargo identity checks', () => {
  const release = rebuiltRelease();
  const frozen = frozenArtifacts();
  const before = JSON.stringify({ release, frozen });
  assert.notEqual(release.npm.shasum, frozen.npm.shasum);
  assert.notEqual(release.npm.integrity, frozen.npm.integrity);
  assert.equal(requireFrozenArtifacts({ release: Object.freeze(release), frozen: Object.freeze(frozen), npmTarSha256: frozen.npm.tarSha256 }), release);
  assert.equal(JSON.stringify({ release, frozen }), before);
});

test('frozen release rejects missing or malformed source commits and release versions', () => {
  const check = (release, frozen) => requireFrozenArtifacts({ release, frozen, npmTarSha256: 'd'.repeat(64) });
  for (const invalid of [undefined, null, {}]) {
    assert.throws(() => check(invalid, frozenArtifacts()), /frozen/i);
    assert.throws(() => check(rebuiltRelease(), invalid), /frozen/i);
  }
  for (const field of ['sourceCommit', 'version']) {
    const invalidValues = field === 'sourceCommit'
      ? [undefined, null, '', 'g'.repeat(40), 'a'.repeat(39), `${headSha}\n`, 'f'.repeat(40)]
      : [undefined, null, '', 'v0.1.0-alpha.3', '0.1.0-alpha.03', `${version}\n`, '0.1.0-alpha.4'];
    for (const invalid of invalidValues) {
      assert.throws(() => check({ ...rebuiltRelease(), [field]: invalid }, frozenArtifacts()), /frozen/i);
      assert.throws(() => check(rebuiltRelease(), { ...frozenArtifacts(), [field]: invalid }), /frozen/i);
    }
  }
});

test('frozen release rejects different npm names or versions even with an identical tar digest', () => {
  for (const npm of [undefined, null, {}, { ...npmExpected, name: 'other' },
    { ...npmExpected, version: '0.1.0-alpha.2' }, { ...npmExpected, version: `${version}\n` }]) {
    assert.throws(() => requireFrozenArtifacts({ release: { ...rebuiltRelease(), npm }, frozen: frozenArtifacts(), npmTarSha256: 'd'.repeat(64) }), /frozen/i);
    assert.throws(() => requireFrozenArtifacts({ release: rebuiltRelease(), frozen: { ...frozenArtifacts(), npm }, npmTarSha256: 'd'.repeat(64) }), /frozen/i);
  }
});

test('frozen release requires an exact SHA256 of the entire decompressed npm tar', () => {
  for (const digest of [undefined, null, '', 'd'.repeat(63), 'z'.repeat(64), `${'d'.repeat(64)}\n`, 'e'.repeat(64)]) {
    assert.throws(() => requireFrozenArtifacts({ release: rebuiltRelease(), frozen: frozenArtifacts(), npmTarSha256: digest }), /frozen/i);
    const frozen = { ...frozenArtifacts(), npm: { ...frozenArtifacts().npm, tarSha256: digest } };
    assert.throws(() => requireFrozenArtifacts({ release: rebuiltRelease(), frozen, npmTarSha256: 'd'.repeat(64) }), /frozen/i);
  }
});

test('frozen release rejects missing, malformed or different Cargo archive identity', () => {
  for (const cargo of [undefined, null, {}, { ...cargoExpected, name: 'other' }, { ...cargoExpected, version: '0.1.0-alpha.2' }]) {
    assert.throws(() => requireFrozenArtifacts({ release: { ...rebuiltRelease(), cargo }, frozen: frozenArtifacts(), npmTarSha256: 'd'.repeat(64) }), /frozen/i);
  }
  assert.throws(() => requireFrozenArtifacts({ release: rebuiltRelease(), frozen: { ...frozenArtifacts(), cargo: { name: 'other', sha256: cargoExpected.checksum } }, npmTarSha256: 'd'.repeat(64) }), /frozen/i);
  for (const cargo of [undefined, null, {}]) {
    assert.throws(() => requireFrozenArtifacts({ release: rebuiltRelease(), frozen: { ...frozenArtifacts(), cargo }, npmTarSha256: 'd'.repeat(64) }), /frozen/i);
  }
  for (const checksum of [undefined, null, '', 'c'.repeat(63), 'z'.repeat(64), `${cargoExpected.checksum}\n`, 'e'.repeat(64)]) {
    assert.throws(() => requireFrozenArtifacts({ release: { ...rebuiltRelease(), cargo: { ...cargoExpected, checksum } }, frozen: frozenArtifacts(), npmTarSha256: 'd'.repeat(64) }), /frozen/i);
    assert.throws(() => requireFrozenArtifacts({ release: rebuiltRelease(), frozen: { ...frozenArtifacts(), cargo: { name, sha256: checksum } }, npmTarSha256: 'd'.repeat(64) }), /frozen/i);
  }
});
