// Links src-tauri/gen/apple/activitykit to the folder of the activitykit crate that the plugin builds with, so that the
// demo's project.yml names activitykit's Swift package by a path inside the project: `activitykit/swift`. The link is
// local (gen/apple/.gitignore); build.ts makes it before each build, and so may you: node link-activitykit.ts.
import { lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { activitykitDir } from '../../tools/activitykit.ts';

const link = fileURLToPath(new URL('src-tauri/gen/apple/activitykit', import.meta.url));
const manifest = fileURLToPath(new URL('src-tauri/Cargo.toml', import.meta.url));

/** Points the link at activitykit's folder; returns that folder. */
export function linkActivitykit(dir = activitykitDir({ manifest })): string {
  let current: string | undefined;
  try {
    current = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : undefined;
  } catch {
    current = undefined; // No link yet.
  }
  if (current === dir) return dir;
  rmSync(link, { force: true });
  symlinkSync(dir, link);
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`gen/apple/activitykit -> ${linkActivitykit()}`);
