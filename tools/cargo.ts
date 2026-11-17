// What the tools ask of cargo: where a crate that the plugin builds with lies on this machine.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { field, isFields } from './json.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Which cargo to ask, and about which crate's dependencies. */
export interface CargoOptions {
  /** The cargo executable. Left out: `$CARGO`, or the `cargo` of the PATH. */
  readonly cargo?: string;
  /** The Cargo.toml whose dependencies are asked for. Left out: the plugin's own. */
  readonly manifest?: string;
}

/** The folder of the crate `name` that the crate of `manifest` builds with, from `cargo metadata`. */
export function crateDir(
  name: string, { cargo = process.env.CARGO || 'cargo', manifest = join(root, 'Cargo.toml') }: CargoOptions = {},
): string {
  const result = spawnSync(cargo, ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest], {
    encoding: 'utf8', maxBuffer: 1024 ** 3,
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed: ${result.stderr || result.error?.message}`);
  const listed = field(JSON.parse(result.stdout), 'packages');
  const packages: readonly unknown[] = Array.isArray(listed) ? listed : [];
  for (const item of packages) {
    if (isFields(item) && item.name === name && typeof item.manifest_path === 'string') return dirname(item.manifest_path);
  }
  throw new Error(`${name} is not a dependency of this crate`);
}
