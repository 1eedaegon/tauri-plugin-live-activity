// The release controller that .github/workflows/publish.yml runs: `node tools/release.ts <mode> [argument]`. It reads
// the tag, the packed artifacts and the registries; what it decides with them is in release-guard.ts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { field, isFields } from './json.ts';
import type { Fields } from './json.ts';
import {
  checkCargoRegistry, checkNpmRegistry, nextTagNeedsUpdate, requireFrozenArtifacts, requireSuccessfulCiRun,
  validateReleaseMetadata,
} from './release-guard.ts';
import type { DistTag, RegistryState } from './release-guard.ts';

const repository = '1eedaegon/tauri-plugin-live-activity';
const packageName = 'tauri-plugin-live-activity';
const RECORD = 'release.json';
const PACK_LIST = 'npm-pack.json';

/** A registry that a release is published to. */
type Registry = 'npm' | 'cargo';

/** What the steps after `archive` read of the release record. The identity of each artifact is checked by the guards. */
interface StoredRelease {
  readonly version: string;
  readonly distTag: DistTag;
  readonly sourceCommit: string;
  readonly npm: unknown;
  readonly cargo: unknown;
}

const json = (path: string | URL): unknown => JSON.parse(readFileSync(path, 'utf8'));
const command = (name: string, args: readonly string[], cwd: string): string => execFileSync(name, args, { cwd, encoding: 'utf8' }).trim();
const hash = (path: string, algorithm: string): string => createHash(algorithm).update(readFileSync(path)).digest('hex');

/** A variable that the workflow sets for the step. */
function environment(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

const output = (name: string, value: string): void => appendFileSync(environment('GITHUB_OUTPUT'), `${name}=${value}\n`);

/** A member of `file`, parsed as `record`, that a step before wrote as text. */
function text(file: string, record: unknown, ...keys: readonly string[]): string {
  const value = field(record, ...keys);
  if (typeof value !== 'string') throw new Error(`${file} has no ${keys.join('.')}`);
  return value;
}

/** The npm tag of the release record: a step before wrote the one that the tag's version takes. */
function distTagOf(record: unknown): DistTag {
  const value = field(record, 'distTag');
  if (value !== 'latest' && value !== 'next') throw new Error(`${RECORD} has no distTag of latest or next`);
  return value;
}

async function response(url: string, github = false): Promise<Response> {
  const headers: Record<string, string> = github
    ? { 'User-Agent': packageName, Authorization: `Bearer ${environment('GH_TOKEN')}` }
    : { 'User-Agent': packageName };
  return fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
}

async function verifyCi(sourceCommit: string): Promise<Fields> {
  const url = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sourceCommit}&per_page=100`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await response(url, true);
    if (!result.ok) throw new Error(`CI lookup failed: HTTP ${result.status}`);
    const runs = field(await result.json(), 'workflow_runs');
    try { return requireSuccessfulCiRun(runs, { repository, headSha: sourceCommit }); }
    catch (error) {
      const listed: readonly unknown[] = Array.isArray(runs) ? runs : [];
      const pending = listed.some(run => field(run, 'head_sha') === sourceCommit
        && field(run, 'head_branch') === 'main' && field(run, 'status') !== 'completed');
      if (!pending || attempt === 39) throw error;
      await new Promise((done) => setTimeout(done, 30_000));
    }
  }
  throw new Error('CI lookup ended without an answer');
}

async function prepare(source: string): Promise<void> {
  const tag = process.env.RELEASE_TAG;
  // Validate before using a ref in Git; real package versions are checked below.
  const identity = { name: packageName, version: tag?.slice(1) };
  validateReleaseMetadata({ tag, npmManifest: identity, cargoPackage: identity });
  const sha = command('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], source);
  command('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], source);
  command('git', ['checkout', '--detach', sha], source);
  const packages = field(JSON.parse(command('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], source)), 'packages');
  const listed: readonly unknown[] = Array.isArray(packages) ? packages : [];
  const cargoPackage = listed.find(pkg => field(pkg, 'name') === packageName);
  const metadata = validateReleaseMetadata({ tag, npmManifest: json(resolve(source, 'package.json')), cargoPackage });
  const ci = await verifyCi(sha);
  const release = { ...metadata, tag, sourceCommit: sha, ciRun: ci.html_url };
  writeFileSync(resolve(environment('RELEASE_DIR'), RECORD), `${JSON.stringify(release, null, 2)}\n`);
  output('source', sha);
  output('version', metadata.version);
  output('tag', metadata.distTag);
}

function archive(source: string): void {
  const directory = environment('RELEASE_DIR');
  const release = json(resolve(directory, RECORD));
  if (!isFields(release)) throw new Error(`${RECORD} is not a release record`);
  const version = text(RECORD, release, 'version');
  const packs = json(resolve(directory, PACK_LIST));
  const packed: unknown = Array.isArray(packs) ? packs[0] : undefined;
  const npm = {
    name: text(PACK_LIST, packed, 'name'), version: text(PACK_LIST, packed, 'version'), filename: text(PACK_LIST, packed, 'filename'),
    shasum: text(PACK_LIST, packed, 'shasum'), integrity: text(PACK_LIST, packed, 'integrity'),
  };
  const filename = `${packageName}-${version}.crate`;
  const crate = resolve(source, 'target/package', filename);
  const cargo = { name: packageName, version, filename, checksum: hash(crate, 'sha256') };
  const archived = { ...release, npm, cargo };
  copyFileSync(crate, resolve(directory, filename));
  writeFileSync(resolve(directory, RECORD), `${JSON.stringify(archived, null, 2)}\n`);
  if (version === '0.1.0-alpha.3') {
    const frozen = json(new URL('../tests/release/alpha3-artifacts.json', import.meta.url));
    const tar = gunzipSync(readFileSync(resolve(directory, npm.filename)), { maxOutputLength: 64 * 1024 * 1024 });
    const npmTarSha256 = createHash('sha256').update(tar).digest('hex');
    requireFrozenArtifacts({ release: archived, frozen, npmTarSha256 });
    writeFileSync(resolve(directory, RECORD), `${JSON.stringify({ ...archived, npmTarSha256 }, null, 2)}\n`);
  }
}

async function registryState(release: StoredRelease, registry: Registry): Promise<RegistryState> {
  if (registry === 'npm') {
    const result = await response(`https://registry.npmjs.org/${packageName}/${release.version}`);
    const body: unknown = result.status === 200 ? await result.json() : undefined;
    return checkNpmRegistry({ status: result.status, body, expected: release.npm });
  }
  const result = await response(`https://index.crates.io/ta/ur/${packageName}`);
  const records = result.status === 200 ? (await result.text()).trim().split('\n').map((line): unknown => JSON.parse(line)) : undefined;
  return checkCargoRegistry({ status: result.status, records, expected: release.cargo });
}

/** npm's tags of the package, by name. */
async function npmDistTags(): Promise<Fields> {
  const result = await response(`https://registry.npmjs.org/-/package/${packageName}/dist-tags`);
  if (!result.ok) throw new Error(`npm dist-tag lookup failed: HTTP ${result.status}`);
  const tags: unknown = await result.json();
  if (!isFields(tags)) throw new Error('npm dist-tag lookup answered something that is not its tags');
  return tags;
}

async function npmTagMatches(release: StoredRelease): Promise<boolean> {
  return (await npmDistTags())[release.distTag] === release.version;
}

async function inspectNext(): Promise<void> {
  const version = text(RECORD, json(resolve(environment('RELEASE_DIR'), RECORD)), 'version');
  const update = nextTagNeedsUpdate({ version, distTags: await npmDistTags() });
  output('update', String(update));
  output('version', version);
}

/** distTag replaces the release's own npm tag when verifying a tag the workflow moved. */
async function inspect(registry: Registry, wait: boolean, distTag?: DistTag): Promise<void> {
  const directory = environment('RELEASE_DIR');
  const stored = json(resolve(directory, RECORD));
  const release: StoredRelease = {
    version: text(RECORD, stored, 'version'),
    distTag: distTag ?? distTagOf(stored),
    sourceCommit: text(RECORD, stored, 'sourceCommit'),
    npm: field(stored, 'npm'),
    cargo: field(stored, 'cargo'),
  };
  const expected = release[registry];
  const filename = text(RECORD, stored, registry, 'filename');
  const algorithm = registry === 'npm' ? 'sha1' : 'sha256';
  if (hash(resolve(directory, filename), algorithm) !== (field(expected, 'shasum') ?? field(expected, 'checksum'))) {
    throw new Error(`${registry} downloaded artifact checksum mismatch`);
  }
  if (registry === 'npm') {
    const digest = createHash('sha512').update(readFileSync(resolve(directory, filename))).digest('base64');
    if (`sha512-${digest}` !== field(expected, 'integrity')) throw new Error('npm downloaded artifact integrity mismatch');
  }
  for (let attempt = 0; attempt < (wait ? 90 : 1); attempt += 1) {
    const state = await registryState(release, registry);
    const matched = state === 'matching' && (!wait || registry !== 'npm' || await npmTagMatches(release));
    if (matched || !wait) {
      output('missing', String(state === 'missing'));
      output('file', filename);
      output('tag', release.distTag);
      output('version', release.version);
      output('source', release.sourceCommit);
      // npm provenance uses workflow GITHUB_SHA, so historical dispatch must disable it.
      output('provenance', String(release.sourceCommit === process.env.GITHUB_SHA));
      return;
    }
    await new Promise((done) => setTimeout(done, 10_000));
  }
  throw new Error(`${registry} publication is not visible; inspect the registry before retrying`);
}

/** The folder that `prepare` and `archive` work in. */
function sourceFolder(argument: string | undefined): string {
  if (argument === undefined) throw new Error('Expected the folder of the source after the mode');
  return resolve(argument);
}

const [mode, argument] = process.argv.slice(2);
if (mode === 'prepare') await prepare(sourceFolder(argument));
else if (mode === 'archive') archive(sourceFolder(argument));
else if (mode === 'verify-default') await inspect('npm', true, 'latest');
else if (mode === 'inspect-next') await inspectNext();
else if (mode === 'verify-next') await inspect('npm', true, 'next');
else if (mode === 'inspect' || mode === 'verify') {
  if (argument !== 'npm' && argument !== 'cargo') throw new Error('Unknown registry');
  await inspect(argument, mode === 'verify');
} else throw new Error('Expected prepare, archive, inspect, verify, verify-default, inspect-next or verify-next');
