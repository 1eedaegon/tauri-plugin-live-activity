// liveupdate's Android adapter belongs to the liveupdate crate: its Kotlin sources and resources are copied into the
// plugin's Android library, byte for byte, from the version that Cargo.lock holds, and its receivers and permissions
// are in the plugin's manifest. `node tools/sync-liveupdate.ts` reports whether the copies match;
// `node tools/sync-liveupdate.ts --write` copies them again after liveupdate changed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crateDir } from './cargo.ts';
import type { CargoOptions } from './cargo.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
/** The folders that hold liveupdate's copied files, at the same path in the crate and in the plugin. */
export const FOLDERS: readonly string[] = ['android/src/main/java/io/github/eedaegon/liveupdate', 'android/src/main/res/drawable'];
/** In the resource folder only liveupdate's own files are copies. */
const OWN = (folder: string, name: string): boolean => folder.endsWith('/liveupdate') || name.startsWith('liveupdate_');
/**
 * The one change the copy makes: liveupdate's sources name their resources through their own package's `R`, which
 * this library, whose namespace is the plugin's, does not generate.
 */
export const adapt = (source: string): string => source.replaceAll('R.drawable.', 'io.github.eedaegon.liveactivity.R.drawable.');
const MANIFEST = 'android/src/main/AndroidManifest.xml';
const NAMESPACE = 'io.github.eedaegon.liveupdate';

/** The folder of the liveupdate crate that the crate of `manifest` builds with, from `cargo metadata`. */
export function liveupdateDir(options?: CargoOptions): string {
  return crateDir('liveupdate', options);
}

/** liveupdate's copied files, as paths relative to either root. */
export function copiedFiles(dir = liveupdateDir()): string[] {
  return FOLDERS.flatMap(folder => readdirSync(join(dir, folder)).filter(name => OWN(folder, name)).map(name => `${folder}/${name}`)).sort();
}

/** The files here that differ from liveupdate's, are missing, or are liveupdate's names that it no longer has. */
export function differing(dir = liveupdateDir()): string[] {
  const theirs = copiedFiles(dir);
  const ours = FOLDERS.flatMap(folder => (existsSync(join(root, folder)) ? readdirSync(join(root, folder)) : [])
    .filter(name => OWN(folder, name)).map(name => `${folder}/${name}`));
  const expected = (file: string): string => (file.endsWith('.kt') ? adapt(readFileSync(join(dir, file), 'utf8')) : readFileSync(join(dir, file), 'utf8'));
  const changed = theirs.filter(file => !existsSync(join(root, file)) || readFileSync(join(root, file), 'utf8') !== expected(file));
  return [...changed, ...ours.filter(file => !theirs.includes(file))].sort();
}

/** An entry of liveupdate's manifest: a permission, or a receiver by its full class name. */
interface ManifestEntry {
  readonly kind: 'permission' | 'receiver';
  readonly name: string;
}

/** The receivers and permissions of liveupdate's manifest that the plugin's manifest lacks, with full class names. */
export function missingManifestEntries(dir = liveupdateDir()): string[] {
  const theirs = readFileSync(join(dir, MANIFEST), 'utf8');
  const ours = readFileSync(join(root, MANIFEST), 'utf8');
  const names = (pattern: RegExp): string[] => [...theirs.matchAll(pattern)].flatMap(([, name]) => (name === undefined ? [] : [name]));
  const permissions = names(/<uses-permission android:name="([^"]+)"/g).map((name): ManifestEntry => ({ kind: 'permission', name }));
  const receivers = names(/<receiver\s+android:name="([^"]+)"\s+android:exported="false"/g)
    .map((name): ManifestEntry => ({ kind: 'receiver', name: name.startsWith('.') ? NAMESPACE + name : name }));
  return [...permissions, ...receivers].flatMap(({ kind, name }) => {
    const pattern = kind === 'permission'
      ? `<uses-permission android:name="${name}"`
      : `<receiver android:name="${name}" android:exported="false"`;
    return ours.includes(pattern) ? [] : [`${kind} ${name}`];
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
