// Shared helpers of the setup steps. A step is `{ status, path, detail }` plus an optional `effect`
// that writes it; a dry run reports the steps without running their effects.
import { accessSync, constants, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';

/** A problem that stops setup, with a message for the person who ran it. */
export class SetupError extends Error {
  override name = 'SetupError';
}

/** What a step did, or would do in a dry run. `todo` is left to the person; `unchanged` needed nothing. */
export type StepStatus = 'created' | 'updated' | 'removed' | 'ran' | 'kept' | 'skipped' | 'todo' | 'unchanged';

/** A step as setup reports it: its status, the path or thing it is about, and a detail for the person. */
export interface StepReport {
  readonly status: StepStatus;
  readonly path: string;
  readonly detail: string;
}

/** Writes a planned step. It answers the step to report in its place when the plan did not hold. */
export type Effect = () => StepReport | undefined;

/** A step as planned, with the effect that writes it when there is something to write. */
export interface PlannedStep extends StepReport {
  readonly effect?: Effect;
}

/** Status: created, updated, removed, ran, kept, skipped, todo or unchanged. */
export function step(status: StepStatus, path: string, detail = '', effect?: Effect): PlannedStep {
  return effect ? { status, path, detail, effect } : { status, path, detail };
}

/** The `code` of an error, as the errors of Node's file system and of a process that could not start carry one. */
export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

/** The text of the file at `path`, or undefined when there is no such file. */
export function readText(path: string | URL): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    // ENOTDIR: a file stands where a folder of the path should be, so the file is not there either.
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw error;
  }
}

/** What `text` holds as JSON, or undefined when it is not JSON. The value is checked where it is read. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** True for a JSON object: a value with members by name. A list is none. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a JSON array. */
export function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** The member at `keys` of parsed JSON: undefined where a value on the way is no object, or has no such member. */
export function member(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

/** An effect that writes `text` to `path`, creating its folder. */
export function writeFile(path: string, text: string): Effect {
  return () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
}

/** JSON in the indent of the original text, with a final newline when it had one. */
export function jsonLike(original: string, value: unknown): string {
  const indent = /\n([ \t]+)"/.exec(original)?.[1] ?? '  ';
  return JSON.stringify(value, null, indent) + (original.endsWith('\n') ? '\n' : '');
}

/** The last lines of a tool's output, on one line. */
export function tail(text = ''): string {
  return text.split('\n').map(line => line.trim()).filter(Boolean).slice(-5).join(' ');
}

/** A path for messages: relative inside the folder setup runs in, otherwise absolute with `~` for home. */
export function display(cwd: string, path: string): string {
  const inside = relative(cwd, path);
  if (inside === '') return '.';
  if (!inside.startsWith('..') && !isAbsolute(inside)) return inside.split(sep).join('/');
  const home = homedir();
  return path.startsWith(home + sep) ? `~/${relative(home, path).split(sep).join('/')}` : path;
}

/** The executable `name` on the PATH of `env`, or undefined. */
export function which(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
  for (const folder of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(folder, name + extension);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false; // Missing or not executable: keep looking along PATH.
  }
}
