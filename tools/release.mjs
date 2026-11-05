import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { checkCargoRegistry, checkNpmRegistry, requireFrozenArtifacts, requireSuccessfulCiRun, validateReleaseMetadata } from './release-guard.mjs';

const repository = '1eedaegon/tauri-plugin-live-activity';
const packageName = 'tauri-plugin-live-activity';
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const command = (name, args, cwd) => execFileSync(name, args, { cwd, encoding: 'utf8' }).trim();
const hash = (path, algorithm) => createHash(algorithm).update(readFileSync(path)).digest('hex');
const output = (name, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);

async function response(url, github = false) {
  const headers = { 'User-Agent': packageName, ...(github ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
  return fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
}

async function verifyCi(sourceCommit) {
  const url = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sourceCommit}&per_page=100`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await response(url, true);
    if (!result.ok) throw new Error(`CI lookup failed: HTTP ${result.status}`);
    const { workflow_runs: runs } = await result.json();
    try { return requireSuccessfulCiRun(runs, { repository, headSha: sourceCommit }); }
    catch (error) {
      const pending = runs.some((run) => run.head_sha === sourceCommit && run.head_branch === 'main' && run.status !== 'completed');
      if (!pending || attempt === 39) throw error;
      await new Promise((done) => setTimeout(done, 30_000));
    }
  }
}

async function prepare(source) {
  const tag = process.env.RELEASE_TAG;
  // Validate before using a ref in Git; real package versions are checked below.
  const identity = { name: packageName, version: tag?.slice(1) };
  validateReleaseMetadata({ tag, npmManifest: identity, cargoPackage: identity });
  const sha = command('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], source);
  command('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], source);
  command('git', ['checkout', '--detach', sha], source);
  const cargo = JSON.parse(command('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], source));
  const cargoPackage = cargo.packages.find((pkg) => pkg.name === packageName);
  const metadata = validateReleaseMetadata({ tag, npmManifest: json(resolve(source, 'package.json')), cargoPackage });
  const ci = await verifyCi(sha);
  const release = { ...metadata, tag, sourceCommit: sha, ciRun: ci.html_url };
  writeFileSync(resolve(process.env.RELEASE_DIR, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  output('source', sha);
  output('version', metadata.version);
  output('tag', metadata.distTag);
}

function archive(source) {
  const directory = process.env.RELEASE_DIR;
  const release = json(resolve(directory, 'release.json'));
  const [npm] = json(resolve(directory, 'npm-pack.json'));
  const filename = `${packageName}-${release.version}.crate`;
  const crate = resolve(source, 'target/package', filename);
  const cargo = { name: packageName, version: release.version, filename, checksum: hash(crate, 'sha256') };
  const packed = { ...release, npm: { name: npm.name, version: npm.version, filename: npm.filename, shasum: npm.shasum, integrity: npm.integrity }, cargo };
  copyFileSync(crate, resolve(directory, filename));
  writeFileSync(resolve(directory, 'release.json'), `${JSON.stringify(packed, null, 2)}\n`);
  if (release.version === '0.1.0-alpha.3') {
    const frozen = json(new URL('../tests/release/alpha3-artifacts.json', import.meta.url));
    const tar = gunzipSync(readFileSync(resolve(directory, npm.filename)), { maxOutputLength: 64 * 1024 * 1024 });
    const npmTarSha256 = createHash('sha256').update(tar).digest('hex');
    requireFrozenArtifacts({ release: packed, frozen, npmTarSha256 });
    writeFileSync(resolve(directory, 'release.json'), `${JSON.stringify({ ...packed, npmTarSha256 }, null, 2)}\n`);
  }
}

async function registryState(release, registry) {
  if (registry === 'npm') {
    const result = await response(`https://registry.npmjs.org/${packageName}/${release.version}`);
    const body = result.status === 200 ? await result.json() : undefined;
    return checkNpmRegistry({ status: result.status, body, expected: release.npm });
  }
  const result = await response(`https://index.crates.io/ta/ur/${packageName}`);
  const records = result.status === 200 ? (await result.text()).trim().split('\n').map((line) => JSON.parse(line)) : undefined;
  return checkCargoRegistry({ status: result.status, records, expected: release.cargo });
}

async function npmTagMatches(release) {
  const result = await response(`https://registry.npmjs.org/-/package/${packageName}/dist-tags`);
  if (!result.ok) throw new Error(`npm dist-tag lookup failed: HTTP ${result.status}`);
  return (await result.json())[release.distTag] === release.version;
}

async function inspect(registry, wait) {
  const release = json(resolve(process.env.RELEASE_DIR, 'release.json'));
  const expected = release[registry];
  const algorithm = registry === 'npm' ? 'sha1' : 'sha256';
  if (hash(resolve(process.env.RELEASE_DIR, expected.filename), algorithm) !== (expected.shasum ?? expected.checksum)) {
    throw new Error(`${registry} downloaded artifact checksum mismatch`);
  }
  if (registry === 'npm') {
    const digest = createHash('sha512').update(readFileSync(resolve(process.env.RELEASE_DIR, expected.filename))).digest('base64');
    if (`sha512-${digest}` !== expected.integrity) throw new Error('npm downloaded artifact integrity mismatch');
  }
  for (let attempt = 0; attempt < (wait ? 90 : 1); attempt += 1) {
    const state = await registryState(release, registry);
    const matched = state === 'matching' && (!wait || registry !== 'npm' || await npmTagMatches(release));
    if (matched || !wait) {
      output('missing', String(state === 'missing'));
      output('file', expected.filename);
      output('tag', release.distTag);
      output('source', release.sourceCommit);
      // npm provenance uses workflow GITHUB_SHA, so historical dispatch must disable it.
      output('provenance', String(release.sourceCommit === process.env.GITHUB_SHA));
      return;
    }
    await new Promise((done) => setTimeout(done, 10_000));
  }
  throw new Error(`${registry} publication is not visible; inspect the registry before retrying`);
}

const [mode, argument] = process.argv.slice(2);
if (mode === 'prepare') await prepare(resolve(argument));
else if (mode === 'archive') archive(resolve(argument));
else if (mode === 'inspect' || mode === 'verify') {
  if (!['npm', 'cargo'].includes(argument)) throw new Error('Unknown registry');
  await inspect(argument, mode === 'verify');
} else throw new Error('Expected prepare, archive, inspect or verify');
