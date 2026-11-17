// Pure release checks; network access, git ancestry and publication stay in the workflow.
// What they are given comes from registries, from GitHub and from files: every member is `unknown` until it is checked.
import { field, isFields } from './json.ts';
import type { Fields } from './json.ts';

const PACKAGE_NAME = 'tauri-plugin-live-activity';
const CI_PATH = '.github/workflows/ci.yml';
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

declare const checkedVersion: unique symbol;
/** Text that has been checked to be a version: SemVer 2.0.0, with no leading zero in a numeric prerelease part. */
export type Version = string & { readonly [checkedVersion]: true };

/** The npm tag that a version is published under: a prerelease goes to `next`. */
export type DistTag = 'next' | 'latest';

/** The version of a release and the npm tag it is published under. */
export interface ReleaseMetadata {
  readonly version: Version;
  readonly distTag: DistTag;
}

/** Whether a registry has the version already, and as the same artifact. */
export type RegistryState = 'missing' | 'matching';

/** The order of two versions: the first is lower, the same or higher. */
export type Ordering = -1 | 0 | 1;

/** What a release is made from: its tag, and the package as npm's manifest and as cargo's metadata name it. */
export interface ReleaseCandidate {
  readonly tag: unknown;
  readonly npmManifest: unknown;
  /** The root package object from parsed `cargo metadata` output. */
  readonly cargoPackage: unknown;
}

/** The repository and the commit whose CI run is asked for. */
export interface CiSource {
  readonly repository: unknown;
  readonly headSha: unknown;
}

/** A release record, the artifacts that were frozen for its version, and the digest of the npm tar just packed. */
export interface FrozenCheck<Release> {
  readonly release: Release;
  readonly frozen: unknown;
  readonly npmTarSha256: unknown;
}

/** npm's answer for one version: the HTTP status, the JSON of its exact version endpoint, and what is to be published. */
export interface NpmRegistryAnswer {
  readonly status: unknown;
  readonly body: unknown;
  readonly expected: unknown;
}

/** The answer of cargo's sparse index: the HTTP status, its parsed JSONL records, and what is to be published. */
export interface CargoRegistryAnswer {
  readonly status: unknown;
  readonly records: unknown;
  readonly expected: unknown;
}

/** A version that was released, and the JSON of npm's dist-tags endpoint. */
export interface NextTagQuestion {
  readonly version: unknown;
  readonly distTags: unknown;
}

// Comparing the full match also rejects a trailing newline, which `$` alone allows.
function fullMatch(pattern: RegExp, value: unknown): boolean {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}

/** The prerelease part of a version, without its hyphen. */
const prereleaseOf = (version: Version): string | undefined => SEMVER.exec(version)?.[4];

function validVersion(version: unknown): version is Version {
  if (typeof version !== 'string' || !fullMatch(SEMVER, version)) return false;
  const prerelease = SEMVER.exec(version)?.[4];
  return !prerelease || prerelease.split('.').every(part => !/^0[0-9]+$/.test(part));
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateReleaseMetadata({ tag, npmManifest, cargoPackage }: ReleaseCandidate): ReleaseMetadata {
  requireCondition(typeof tag === 'string' && tag.startsWith('v'), 'Release tag must be an exact vSEMVER tag');
  const version = tag.slice(1);
  requireCondition(validVersion(version), 'Release tag must be an exact vSEMVER tag');
  for (const manifest of [npmManifest, cargoPackage]) {
    requireCondition(field(manifest, 'name') === PACKAGE_NAME && field(manifest, 'version') === version,
      'Release package name/version must match the tag in npm and Cargo');
  }
  return { version, distTag: prereleaseOf(version) ? 'next' : 'latest' };
}

/** Source must separately pass `git merge-base --is-ancestor <sha> origin/main`. */
export function requireSuccessfulCiRun(runs: unknown, { repository, headSha }: CiSource): Fields {
  requireCondition(Array.isArray(runs)
    && fullMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, repository)
    && fullMatch(/^[0-9a-f]{40}$/, headSha), 'CI lookup requires a repository and full source SHA');
  const candidates: readonly unknown[] = runs;
  const paths: readonly unknown[] = [CI_PATH, `${CI_PATH}@main`, `${CI_PATH}@refs/heads/main`];
  const events: readonly unknown[] = ['push', 'workflow_dispatch'];
  const run = candidates.find(candidate => field(candidate, 'repository', 'full_name') === repository
    && field(candidate, 'head_repository', 'full_name') === repository
    && field(candidate, 'head_branch') === 'main'
    && field(candidate, 'head_sha') === headSha
    && paths.includes(field(candidate, 'path'))
    && events.includes(field(candidate, 'event'))
    && field(candidate, 'status') === 'completed'
    && field(candidate, 'conclusion') === 'success');
  requireCondition(isFields(run), 'No successful main CI run for the exact repository, workflow and source SHA');
  return run;
}

function registryStatus(status: unknown): 'missing' | 'present' {
  if (status === 404) return 'missing';
  requireCondition(status === 200, 'Registry HTTP response must be 200 or explicit 404');
  return 'present';
}

function expectedIdentity(expected: unknown): boolean {
  return field(expected, 'name') === PACKAGE_NAME && validVersion(field(expected, 'version'));
}

function validIntegrity(integrity: unknown): boolean {
  if (typeof integrity !== 'string' || !fullMatch(/^sha512-[A-Za-z0-9+/]{86}==$/, integrity)) return false;
  const encoded = integrity.slice('sha512-'.length);
  return Buffer.from(encoded, 'base64').toString('base64') === encoded;
}

/** Compression may differ; every byte of the decompressed tar must remain identical. */
export function requireFrozenArtifacts<Release>({ release, frozen, npmTarSha256 }: FrozenCheck<Release>): Release {
  const version = field(release, 'version');
  requireCondition(validVersion(version) && validVersion(field(frozen, 'version'))
    && version === field(frozen, 'version'), 'Invalid or different frozen release version');
  const sourceCommit = field(release, 'sourceCommit');
  requireCondition(fullMatch(/^[0-9a-f]{40}$/, sourceCommit)
    && fullMatch(/^[0-9a-f]{40}$/, field(frozen, 'sourceCommit'))
    && sourceCommit === field(frozen, 'sourceCommit'), 'Invalid or different frozen source commit');
  requireCondition(expectedIdentity(field(release, 'npm')) && expectedIdentity(field(frozen, 'npm'))
    && field(release, 'npm', 'version') === version && field(frozen, 'npm', 'version') === field(frozen, 'version'),
  'Invalid or different frozen npm package identity');
  requireCondition(fullMatch(/^[0-9a-f]{64}$/, npmTarSha256)
    && fullMatch(/^[0-9a-f]{64}$/, field(frozen, 'npm', 'tarSha256'))
    && npmTarSha256 === field(frozen, 'npm', 'tarSha256'), 'Invalid or different frozen npm tar SHA256');
  requireCondition(expectedIdentity(field(release, 'cargo')) && field(release, 'cargo', 'version') === version
    && field(frozen, 'cargo', 'name') === PACKAGE_NAME, 'Invalid or different frozen Cargo package identity');
  requireCondition(fullMatch(/^[0-9a-f]{64}$/, field(release, 'cargo', 'checksum'))
    && fullMatch(/^[0-9a-f]{64}$/, field(frozen, 'cargo', 'sha256'))
    && field(release, 'cargo', 'checksum') === field(frozen, 'cargo', 'sha256'), 'Invalid or different frozen Cargo archive checksum');
  return release;
}

export function checkNpmRegistry({ status, body, expected }: NpmRegistryAnswer): RegistryState {
  requireCondition(expectedIdentity(expected)
    && fullMatch(/^[0-9a-f]{40}$/, field(expected, 'shasum'))
    && validIntegrity(field(expected, 'integrity')), 'Invalid expected npm package identity or digests');
  if (registryStatus(status) === 'missing') return 'missing';
  requireCondition(field(body, 'name') === field(expected, 'name') && field(body, 'version') === field(expected, 'version')
    && field(body, 'dist', 'shasum') === field(expected, 'shasum') && field(body, 'dist', 'integrity') === field(expected, 'integrity'),
  'Existing npm version does not match the frozen package identity and digests');
  return 'matching';
}

function compareText(left: string, right: string): Ordering {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// Validated numeric identifiers have no leading zeros, so a longer one is larger.
function compareNumeric(left: string, right: string): Ordering {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return compareText(left, right);
}

function compareIdentifier(left: string, right: string): Ordering {
  const leftNumeric = /^[0-9]+$/.test(left);
  const rightNumeric = /^[0-9]+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumeric(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return compareText(left, right);
}

function comparePrerelease(left: string | undefined, right: string | undefined): Ordering {
  if (left === undefined || right === undefined) {
    if (left === right) return 0;
    return left === undefined ? 1 : -1;
  }
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  for (const [index, leftPart] of leftParts.entries()) {
    const rightPart = rightParts[index];
    if (rightPart === undefined) break;
    const order = compareIdentifier(leftPart, rightPart);
    if (order !== 0) return order;
  }
  if (leftParts.length === rightParts.length) return 0;
  return leftParts.length < rightParts.length ? -1 : 1;
}

/** SemVer 2.0.0 precedence: -1, 0 or 1. Build metadata does not count. */
export function compareVersions(left: unknown, right: unknown): Ordering {
  requireCondition(validVersion(left) && validVersion(right), 'Version comparison requires two SemVer versions');
  const [, ...leftParts] = SEMVER.exec(left) ?? [];
  const [, ...rightParts] = SEMVER.exec(right) ?? [];
  for (const index of [0, 1, 2]) {
    const order = compareNumeric(leftParts[index] ?? '', rightParts[index] ?? '');
    if (order !== 0) return order;
  }
  return comparePrerelease(leftParts[3], rightParts[3]);
}

/** True when a stable version should also become `next`: `next` is missing or lower. A prerelease is published to `next`. */
export function nextTagNeedsUpdate({ version, distTags }: NextTagQuestion): boolean {
  requireCondition(validVersion(version), 'Invalid npm release version');
  requireCondition(isFields(distTags)
    && (!Object.hasOwn(distTags, 'next') || validVersion(distTags.next)), 'Malformed npm dist-tags response');
  if (prereleaseOf(version)) return false;
  return !Object.hasOwn(distTags, 'next') || compareVersions(distTags.next, version) < 0;
}

export function checkCargoRegistry({ status, records, expected }: CargoRegistryAnswer): RegistryState {
  requireCondition(expectedIdentity(expected)
    && fullMatch(/^[0-9a-f]{64}$/, field(expected, 'checksum')), 'Invalid expected Cargo package identity or checksum');
  if (registryStatus(status) === 'missing') return 'missing';
  requireCondition(Array.isArray(records), 'Malformed Cargo sparse-index response');
  const entries: readonly unknown[] = records;
  requireCondition(entries.length > 0 && entries.every(record =>
    field(record, 'name') === field(expected, 'name') && validVersion(field(record, 'vers'))
    && fullMatch(/^[0-9a-f]{64}$/, field(record, 'cksum')) && typeof field(record, 'yanked') === 'boolean'),
  'Malformed Cargo sparse-index response');
  const matches = entries.filter(record => field(record, 'vers') === field(expected, 'version'));
  if (matches.length === 0) return 'missing';
  const [match] = matches;
  requireCondition(matches.length === 1 && field(match, 'cksum') === field(expected, 'checksum')
    && !field(match, 'yanked'), 'Existing Cargo version is duplicated, yanked or has a different checksum');
  return 'matching';
}
