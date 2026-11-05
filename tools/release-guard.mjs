// Pure release checks; network access, git ancestry and publication stay in the workflow.
const PACKAGE_NAME = 'tauri-plugin-live-activity';
const CI_PATH = '.github/workflows/ci.yml';
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// Comparing the full match also rejects a trailing newline, which `$` alone allows.
function fullMatch(pattern, value) {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}

function validVersion(version) {
  if (!fullMatch(SEMVER, version)) return false;
  const prerelease = SEMVER.exec(version)[4];
  return !prerelease || prerelease.split('.').every(part => !/^0[0-9]+$/.test(part));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** cargoPackage is the root package object from parsed `cargo metadata` output. */
export function validateReleaseMetadata({ tag, npmManifest, cargoPackage }) {
  requireCondition(typeof tag === 'string' && tag.startsWith('v') && validVersion(tag.slice(1)),
    'Release tag must be an exact vSEMVER tag');
  const version = tag.slice(1);
  for (const manifest of [npmManifest, cargoPackage]) {
    requireCondition(manifest?.name === PACKAGE_NAME && manifest.version === version,
      'Release package name/version must match the tag in npm and Cargo');
  }
  return { version, distTag: SEMVER.exec(version)[4] ? 'next' : 'latest' };
}

/** Source must separately pass `git merge-base --is-ancestor <sha> origin/main`. */
export function requireSuccessfulCiRun(runs, { repository, headSha }) {
  requireCondition(Array.isArray(runs)
    && fullMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, repository)
    && fullMatch(/^[0-9a-f]{40}$/, headSha), 'CI lookup requires a repository and full source SHA');
  const run = runs.find(candidate => candidate?.repository?.full_name === repository
    && candidate.head_repository?.full_name === repository
    && candidate.head_branch === 'main'
    && candidate.head_sha === headSha
    && [CI_PATH, `${CI_PATH}@main`, `${CI_PATH}@refs/heads/main`].includes(candidate.path)
    && ['push', 'workflow_dispatch'].includes(candidate.event)
    && candidate.status === 'completed'
    && candidate.conclusion === 'success');
  requireCondition(run, 'No successful main CI run for the exact repository, workflow and source SHA');
  return run;
}

function registryStatus(status) {
  if (status === 404) return 'missing';
  requireCondition(status === 200, 'Registry HTTP response must be 200 or explicit 404');
  return 'present';
}

function expectedIdentity(expected) {
  return expected?.name === PACKAGE_NAME && validVersion(expected.version);
}

function validIntegrity(integrity) {
  if (!fullMatch(/^sha512-[A-Za-z0-9+/]{86}==$/, integrity)) return false;
  const encoded = integrity.slice('sha512-'.length);
  return Buffer.from(encoded, 'base64').toString('base64') === encoded;
}

/** Compression may differ; every byte of the decompressed tar must remain identical. */
export function requireFrozenArtifacts({ release, frozen, npmTarSha256 }) {
  requireCondition(validVersion(release?.version) && validVersion(frozen?.version)
    && release.version === frozen.version, 'Invalid or different frozen release version');
  requireCondition(fullMatch(/^[0-9a-f]{40}$/, release.sourceCommit)
    && fullMatch(/^[0-9a-f]{40}$/, frozen.sourceCommit)
    && release.sourceCommit === frozen.sourceCommit, 'Invalid or different frozen source commit');
  requireCondition(expectedIdentity(release.npm) && expectedIdentity(frozen.npm)
    && release.npm.version === release.version && frozen.npm.version === frozen.version,
  'Invalid or different frozen npm package identity');
  requireCondition(fullMatch(/^[0-9a-f]{64}$/, npmTarSha256)
    && fullMatch(/^[0-9a-f]{64}$/, frozen.npm.tarSha256)
    && npmTarSha256 === frozen.npm.tarSha256, 'Invalid or different frozen npm tar SHA256');
  requireCondition(expectedIdentity(release.cargo) && release.cargo.version === release.version
    && frozen.cargo?.name === PACKAGE_NAME, 'Invalid or different frozen Cargo package identity');
  requireCondition(fullMatch(/^[0-9a-f]{64}$/, release.cargo.checksum)
    && fullMatch(/^[0-9a-f]{64}$/, frozen.cargo.sha256)
    && release.cargo.checksum === frozen.cargo.sha256, 'Invalid or different frozen Cargo archive checksum');
  return release;
}

/** body is JSON from the npm package's exact version endpoint. */
export function checkNpmRegistry({ status, body, expected }) {
  requireCondition(expectedIdentity(expected)
    && fullMatch(/^[0-9a-f]{40}$/, expected.shasum)
    && validIntegrity(expected.integrity), 'Invalid expected npm package identity or digests');
  if (registryStatus(status) === 'missing') return 'missing';
  requireCondition(body?.name === expected.name && body.version === expected.version
    && body.dist?.shasum === expected.shasum && body.dist.integrity === expected.integrity,
  'Existing npm version does not match the frozen package identity and digests');
  return 'matching';
}

/** records is parsed JSONL from this package's Cargo sparse-index entry. */
export function checkCargoRegistry({ status, records, expected }) {
  requireCondition(expectedIdentity(expected)
    && fullMatch(/^[0-9a-f]{64}$/, expected.checksum), 'Invalid expected Cargo package identity or checksum');
  if (registryStatus(status) === 'missing') return 'missing';
  requireCondition(Array.isArray(records) && records.length > 0 && records.every(record =>
    record?.name === expected.name && validVersion(record.vers)
    && fullMatch(/^[0-9a-f]{64}$/, record.cksum) && typeof record.yanked === 'boolean'),
  'Malformed Cargo sparse-index response');
  const matches = records.filter(record => record.vers === expected.version);
  if (matches.length === 0) return 'missing';
  requireCondition(matches.length === 1 && matches[0].cksum === expected.checksum
    && !matches[0].yanked, 'Existing Cargo version is duplicated, yanked or has a different checksum');
  return 'matching';
}
