// The request contract belongs to the activitykit crate. The plugin keeps no copy of its fixtures, nor of its schema,
// which nothing here runs: the tests read the fixtures from the activitykit that Cargo.lock names, in the folder
// where cargo has it, and the demo links that folder for the crate's Swift package. `node tools/activitykit.mjs`
// prints the folder.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
/** The layout fixtures of the contract, by their path in the activitykit crate. */
export const LAYOUT_FIXTURES = 'tests/fixtures/layout-requests.json';

/** The folder of the activitykit crate that the crate of `manifest` builds with, from `cargo metadata`. */
function locate({ cargo = process.env.CARGO || 'cargo', manifest = join(root, 'Cargo.toml') } = {}) {
  const result = spawnSync(cargo, ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest], {
    encoding: 'utf8', maxBuffer: 1024 ** 3,
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed: ${result.stderr || result.error?.message}`);
  const kit = JSON.parse(result.stdout).packages.find(item => item.name === 'activitykit');
  if (!kit) throw new Error('activitykit is not a dependency of this crate');
  return dirname(kit.manifest_path);
}

let ofThePlugin;
/** That folder. Asked without options it is the plugin's own, which cargo is asked for once. */
export function activitykitDir(options) {
  if (options) return locate(options);
  ofThePlugin ??= locate();
  return ofThePlugin;
}

/** Where `file` of the contract is, in the activitykit crate that the plugin builds with. */
export const contractPath = (file, dir = activitykitDir()) => join(dir, file);

/** That file, read as JSON. */
export const contract = (file, dir) => JSON.parse(readFileSync(contractPath(file, dir), 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(activitykitDir());
