// The request contract belongs to the activitykit crate. The plugin keeps no copy of its fixtures, nor of its schema,
// which nothing here runs: the tests read the fixtures from the activitykit that Cargo.lock names, in the folder
// where cargo has it, and the demo links that folder for the crate's Swift package. `node tools/activitykit.ts`
// prints the folder.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crateDir } from './cargo.ts';
import type { CargoOptions } from './cargo.ts';

/** The layout fixtures of the contract, by their path in the activitykit crate. */
export const LAYOUT_FIXTURES = 'tests/fixtures/layout-requests.json';

let ofThePlugin: string | undefined;
/**
 * The folder of the activitykit crate that a crate builds with. Asked without options it is the plugin's own, which
 * cargo is asked for once.
 */
export function activitykitDir(options?: CargoOptions): string {
  if (options) return crateDir('activitykit', options);
  ofThePlugin ??= crateDir('activitykit');
  return ofThePlugin;
}

/** Where `file` of the contract is, in the activitykit crate that the plugin builds with. */
export const contractPath = (file: string, dir = activitykitDir()): string => join(dir, file);

/** That file, read as JSON. It is activitykit's file: what reads it checks the members it takes. */
export const contract = (file: string, dir?: string): unknown => JSON.parse(readFileSync(contractPath(file, dir), 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(activitykitDir());
