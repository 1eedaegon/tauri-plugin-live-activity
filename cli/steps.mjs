// Shared helpers of the setup steps. A step is `{ status, path, detail }` plus an optional `effect`
// that writes it; a dry run reports the steps without running their effects.
import { accessSync, constants, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';

/** A problem that stops setup, with a message for the person who ran it. */
export class SetupError extends Error {
  name = 'SetupError';
}

/** Status: created, updated, ran, kept, skipped, todo or unchanged. */
export function step(status, path, detail = '', effect = undefined) {
  return effect ? { status, path, detail, effect } : { status, path, detail };
}

export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    // ENOTDIR: a file stands where a folder of the path should be, so the file is not there either.
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
    throw error;
  }
}

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** An effect that writes `text` to `path`, creating its folder. */
export function writeFile(path, text) {
  return () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
}

/** JSON in the indent of the original text, with a final newline when it had one. */
export function jsonLike(original, value) {
  const indent = /\n([ \t]+)"/.exec(original)?.[1] ?? '  ';
  return JSON.stringify(value, null, indent) + (original.endsWith('\n') ? '\n' : '');
}

/** The last lines of a tool's output, on one line. */
export function tail(text = '') {
  return text.split('\n').map(line => line.trim()).filter(Boolean).slice(-5).join(' ');
}

/** A path for messages: relative inside the folder setup runs in, otherwise absolute with `~` for home. */
export function display(cwd, path) {
  const inside = relative(cwd, path);
  if (inside === '') return '.';
  if (!inside.startsWith('..') && !isAbsolute(inside)) return inside.split(sep).join('/');
  const home = homedir();
  return path.startsWith(home + sep) ? `~/${relative(home, path).split(sep).join('/')}` : path;
}

/** The executable `name` on the PATH of `env`, or undefined. */
export function which(name, env) {
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
  for (const folder of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(folder, name + extension);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false; // Missing or not executable: keep looking along PATH.
  }
}
