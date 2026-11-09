// liveupdate's Android adapter belongs to the liveupdate crate: its Kotlin sources and resources are copied into the
// plugin's Android library, byte for byte, from the version that Cargo.lock holds, and its receivers and permissions
// are in the plugin's manifest. `node tools/sync-liveupdate.mjs` reports whether the copies match;
// `node tools/sync-liveupdate.mjs --write` copies them again after liveupdate changed.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
/** The folders that hold liveupdate's copied files, at the same path in the crate and in the plugin. */
export const FOLDERS = ['android/src/main/java/io/github/eedaegon/liveupdate', 'android/src/main/res/drawable'];
/** In the resource folder only liveupdate's own files are copies. */
const OWN = (folder, name) => folder.endsWith('/liveupdate') || name.startsWith('liveupdate_');
/**
 * The one change the copy makes: liveupdate's sources name their resources through their own package's `R`, which
 * this library, whose namespace is the plugin's, does not generate.
 */
export const adapt = (source) => source.replaceAll('R.drawable.', 'io.github.eedaegon.liveactivity.R.drawable.');
const MANIFEST = 'android/src/main/AndroidManifest.xml';
const NAMESPACE = 'io.github.eedaegon.liveupdate';

/** The folder of the liveupdate crate that the crate of `manifest` builds with, from `cargo metadata`. */
export function liveupdateDir({ cargo = process.env.CARGO || 'cargo', manifest = join(root, 'Cargo.toml') } = {}) {
  const result = spawnSync(cargo, ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest], {
    encoding: 'utf8', maxBuffer: 1024 ** 3,
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed: ${result.stderr || result.error?.message}`);
  const crate = JSON.parse(result.stdout).packages.find(item => item.name === 'liveupdate');
  if (!crate) throw new Error('liveupdate is not a dependency of this crate');
  return dirname(crate.manifest_path);
}

/** liveupdate's copied files, as paths relative to either root. */
export function copiedFiles(dir = liveupdateDir()) {
  return FOLDERS.flatMap(folder => readdirSync(join(dir, folder)).filter(name => OWN(folder, name)).map(name => `${folder}/${name}`)).sort();
}

/** The files here that differ from liveupdate's, are missing, or are liveupdate's names that it no longer has. */
export function differing(dir = liveupdateDir()) {
  const theirs = copiedFiles(dir);
  const ours = FOLDERS.flatMap(folder => (existsSync(join(root, folder)) ? readdirSync(join(root, folder)) : [])
    .filter(name => OWN(folder, name)).map(name => `${folder}/${name}`));
  const expected = file => (file.endsWith('.kt') ? adapt(readFileSync(join(dir, file), 'utf8')) : readFileSync(join(dir, file), 'utf8'));
  const changed = theirs.filter(file => !existsSync(join(root, file)) || readFileSync(join(root, file), 'utf8') !== expected(file));
  return [...changed, ...ours.filter(file => !theirs.includes(file))].sort();
}

/** The receivers and permissions of liveupdate's manifest that the plugin's manifest lacks, with full class names. */
export function missingManifestEntries(dir = liveupdateDir()) {
  const theirs = readFileSync(join(dir, MANIFEST), 'utf8');
  const ours = readFileSync(join(root, MANIFEST), 'utf8');
  const permissions = [...theirs.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(([, name]) => `permission ${name}`);
  const receivers = [...theirs.matchAll(/<receiver\s+android:name="([^"]+)"\s+android:exported="false"/g)]
    .map(([, name]) => `receiver ${name.startsWith('.') ? NAMESPACE + name : name}`);
  return [...permissions, ...receivers].filter(entry => {
    const [kind, name] = entry.split(' ');
    const pattern = kind === 'permission'
      ? `<uses-permission android:name="${name}"`
      : `<receiver android:name="${name}" android:exported="false"`;
    return !ours.includes(pattern);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = liveupdateDir();
  if (process.argv.includes('--write')) {
    for (const file of differing(dir)) rmSync(join(root, file), { force: true });
    for (const file of copiedFiles(dir)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      if (file.endsWith('.kt')) writeFileSync(join(root, file), adapt(readFileSync(join(dir, file), 'utf8')));
      else copyFileSync(join(dir, file), join(root, file));
    }
  }
  const left = [...differing(dir), ...missingManifestEntries(dir).map(entry => `${MANIFEST}: ${entry}`)];
  console.log(left.length === 0 ? `The Android adapter matches liveupdate at ${dir}.` : `Differs from liveupdate: ${left.join(', ')}`);
  process.exitCode = left.length === 0 ? 0 : 1;
}
