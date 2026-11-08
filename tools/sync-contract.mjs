// The request contract belongs to the activitykit crate: its schema and its fixtures are copied here, byte for byte,
// from the version that Cargo.lock holds. `node tools/sync-contract.mjs` reports whether the copies match;
// `node tools/sync-contract.mjs --write` copies them again after activitykit changed.
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
/** The files of the contract, at the same path in both crates. */
export const CONTRACT_FILES = ['contracts/request.schema.json', 'tests/fixtures/layout-requests.json'];

/** The folder of the activitykit crate that the crate of `manifest` builds with, from `cargo metadata`. */
export function activitykitDir({ cargo = process.env.CARGO || 'cargo', manifest = join(root, 'Cargo.toml') } = {}) {
  const result = spawnSync(cargo, ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest], {
    encoding: 'utf8', maxBuffer: 1024 ** 3,
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed: ${result.stderr || result.error?.message}`);
  const kit = JSON.parse(result.stdout).packages.find(item => item.name === 'activitykit');
  if (!kit) throw new Error('activitykit is not a dependency of this crate');
  return dirname(kit.manifest_path);
}

/** The contract files whose copy here differs from activitykit's. */
export function differing(dir = activitykitDir()) {
  return CONTRACT_FILES.filter(file => !readFileSync(join(root, file)).equals(readFileSync(join(dir, file))));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = activitykitDir();
  if (process.argv.includes('--write')) for (const file of CONTRACT_FILES) copyFileSync(join(dir, file), join(root, file));
  const left = differing(dir);
  console.log(left.length === 0 ? `The contract matches activitykit at ${dir}.` : `Differs from activitykit: ${left.join(', ')}`);
  process.exitCode = left.length === 0 ? 0 : 1;
}
