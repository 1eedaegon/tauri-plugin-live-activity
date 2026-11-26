// `npx tauri-plugin-live-activity setup`: what the README's install steps need, done in an app's folder.
// Every step first works out what to change; a dry run stops there.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { iosSteps } from './ios.mjs';
import {
  SetupError, display, errorCode, isList, isRecord, jsonLike, member, parseJson, readText, step, tail, writeFile,
} from './steps.mjs';
import type { PlannedStep, StepReport } from './steps.mjs';
import { widgetFiles } from './widget-files.mjs';
import type { WidgetFiles } from './widget-files.mjs';

export { SetupError } from './steps.mjs';

export const CRATE = 'tauri-plugin-live-activity';
/** The crate whose Swift package the widget extension and the app target link. */
export const ACTIVITYKIT = 'activitykit';
/**
 * `default` reads; the others allow the commands that change activities, and the three that ask the person: with
 * Android's dialog, in its setting for exact alarms, and in its screen of Live Updates.
 */
export const PERMISSIONS: readonly string[] = [
  'live-activity:default',
  ...['request-permissions', 'open-exact-alarm-settings', 'open-promotion-settings', 'start', 'update', 'end', 'start-layout',
    'update-layout', 'end-layout', 'write-image']
    .map(command => `live-activity:allow-${command}`),
];
// The plugin's Android library needs API 26: Tauri's Jackson runtime fails below it.
const MIN_SDK = 26;
const NPM_MANIFEST: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const NPM_VERSION = String(member(NPM_MANIFEST, 'version'));

/**
 * tauri.conf.json as parsed. The file is the app's: the members that setup reads are named here, and each is checked
 * where it is read.
 */
export interface TauriConfig {
  readonly identifier?: unknown;
  readonly version?: unknown;
  readonly bundle?: unknown;
  readonly [member: string]: unknown;
}

/** The app that setup works on: its src-tauri folder, and its tauri.conf.json as text and as parsed. */
export interface App {
  readonly srcTauri: string;
  readonly configPath: string;
  readonly configText: string;
  readonly config: TauriConfig;
}

/** A crate of the app's dependency graph: its version and the folder of its Cargo.toml. */
export interface Crate {
  readonly version: string;
  readonly dir: string;
}

/** The plugin's crate, and the activitykit crate it depends on. */
export interface Crates {
  readonly plugin: Crate;
  readonly activitykit: Crate;
}

/**
 * What `setup` takes. Each member has a default, which a member left out or undefined takes: the folder, environment
 * and platform of the process, and nothing asked for.
 */
export interface SetupOptions {
  /** The app's folder or its src-tauri folder. */
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Reports the steps and writes nothing. */
  readonly dryRun?: boolean | undefined;
  /** Leaves the capabilities and tauri.conf.json alone. */
  readonly iosOnly?: boolean | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  /** Font files for the widget extension. */
  readonly fonts?: readonly string[] | undefined;
  /** Image files for the widget's asset catalog. */
  readonly assets?: readonly string[] | undefined;
  /** True for `group.<app identifier>`, or the name of the App Group. */
  readonly appGroup?: boolean | string | undefined;
  /** Has the widget draw a layout's small region. */
  readonly smallFamily?: boolean | undefined;
}

/** What every step is given: the app, the crates, and what the person asked for. */
export interface SetupContext extends App, Crates {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly files: WidgetFiles;
  readonly appGroup: boolean | string | undefined;
  readonly smallFamily: boolean;
  /** A path as the report shows it. */
  readonly show: (path: string) => string;
}

/** A line for the person after the steps: `register` is something left to do, `version` a mismatch to know of. */
export interface Note {
  readonly kind: 'register' | 'version';
  readonly text: string;
}

/** What `setup` answers: the steps with their status, and notes for the person who runs it. */
export interface SetupResult {
  readonly dryRun: boolean;
  /** The version of the plugin's crate. */
  readonly version: string;
  readonly steps: readonly StepReport[];
  readonly notes: readonly Note[];
}

/** A package as `cargo metadata` lists it, with the members setup reads. */
interface CargoPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
}

/**
 * Sets up the app in `cwd` (its folder or its src-tauri folder) and returns the steps with their
 * status, and notes for the person who runs it. `fonts` and `assets` are files for the widget
 * extension; `appGroup` is true or the name of an App Group; with `smallFamily` the widget draws a layout's small
 * region. Throws SetupError when it cannot start.
 */
export function setup({
  cwd = process.cwd(), env = process.env, dryRun = false, iosOnly = false, platform = process.platform,
  fonts = [], assets = [], appGroup = undefined, smallFamily = false,
}: SetupOptions = {}): SetupResult {
  const files = widgetFiles(cwd, { fonts, assets });
  const app = findApp(cwd);
  const { plugin, activitykit } = findCrates(app, env);
  const context: SetupContext = { ...app, plugin, activitykit, env, platform, files, appGroup, smallFamily, show: path => display(cwd, path) };
  const planned = [...(iosOnly ? [] : [capabilitiesStep(context), ...androidSteps(context)]), ...iosSteps(context)];
  const steps = dryRun ? planned : planned.map(apply);
  return { dryRun, version: plugin.version, steps: steps.map(({ effect, ...rest }) => rest), notes: notes(context) };
}

function apply(planned: PlannedStep): PlannedStep {
  if (!planned.effect) return planned;
  try {
    return planned.effect() ?? planned;
  } catch (error) {
    return step('todo', planned.path, `could not write it: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function findApp(cwd: string): App {
  const srcTauri = [join(cwd, 'src-tauri'), cwd].find(folder => existsSync(join(folder, 'tauri.conf.json')));
  if (!srcTauri) {
    const other = [join(cwd, 'src-tauri'), cwd].flatMap(folder => ['tauri.conf.json5', 'Tauri.toml'].map(name => join(folder, name)))
      .find(existsSync);
    if (other) throw new SetupError(`Setup reads tauri.conf.json, and this app has ${display(cwd, other)}. docs/usage.md has the steps by hand.`);
    throw new SetupError('No src-tauri/tauri.conf.json here. Run this in the folder of a Tauri 2 app.');
  }
  const configPath = join(srcTauri, 'tauri.conf.json');
  const configText = readFileSync(configPath, 'utf8');
  const config = parseJson(configText);
  if (!isRecord(config)) throw new SetupError(`${display(cwd, configPath)} is not valid JSON.`);
  if (!existsSync(join(srcTauri, 'Cargo.toml'))) throw new SetupError('No src-tauri/Cargo.toml next to tauri.conf.json.');
  return { srcTauri, configPath, configText, config };
}

/** A package of cargo's metadata, or undefined for an entry that lacks a member setup reads. */
function cargoPackage(item: unknown): CargoPackage | undefined {
  const id = member(item, 'id');
  const name = member(item, 'name');
  const version = member(item, 'version');
  const manifestPath = member(item, 'manifest_path');
  return typeof id === 'string' && typeof name === 'string' && typeof version === 'string' && typeof manifestPath === 'string'
    ? { id, name, version, manifestPath } : undefined;
}

/** The packages of cargo's metadata, or undefined when the text is not what `cargo metadata` prints. */
function cargoPackages(metadata: unknown): readonly CargoPackage[] | undefined {
  const listed = member(metadata, 'packages');
  if (!isList(listed)) return undefined;
  const packages = listed.map(cargoPackage).filter(item => item !== undefined);
  return packages.length === listed.length ? packages : undefined;
}

/** The id of the package that `crate` takes its dependency `name` from, where cargo's resolve graph says. */
function dependencyId(metadata: unknown, crate: CargoPackage, name: string): string | undefined {
  const nodes = member(metadata, 'resolve', 'nodes');
  const deps = member(isList(nodes) ? nodes.find(node => member(node, 'id') === crate.id) : undefined, 'deps');
  const id = member(isList(deps) ? deps.find(dep => member(dep, 'name') === name) : undefined, 'pkg');
  return typeof id === 'string' ? id : undefined;
}

/**
 * The plugin crate's version and the folder of the activitykit crate it depends on, from `cargo metadata`: the widget
 * extension and the app target link activitykit's Swift package, which lies in that folder.
 */
export function findCrates({ srcTauri }: Pick<App, 'srcTauri'>, env: NodeJS.ProcessEnv): Crates {
  const args = ['metadata', '--format-version', '1', '--manifest-path', join(srcTauri, 'Cargo.toml')];
  const result = spawnSync(env.CARGO || 'cargo', args, { env, encoding: 'utf8', maxBuffer: 1024 ** 3 });
  if (errorCode(result.error) === 'ENOENT') throw new SetupError('cargo was not found. Install Rust from https://rustup.rs, then run this again.');
  if (result.error) throw new SetupError(`cargo metadata could not run: ${result.error.message}`);
  if (result.status !== 0) throw new SetupError(`cargo metadata failed: ${tail(result.stderr)}`);
  const metadata = parseJson(result.stdout);
  const packages = cargoPackages(metadata);
  if (!packages) throw new SetupError('cargo metadata printed something that is not its JSON.');
  const crate = packages.find(item => item.name === CRATE);
  if (!crate) {
    throw new SetupError(`${CRATE} is not a dependency of src-tauri/Cargo.toml yet. Add it first:\n  cargo add ${CRATE} --manifest-path src-tauri/Cargo.toml`);
  }
  const kitId = dependencyId(metadata, crate, ACTIVITYKIT);
  const kit = packages.find(item => (kitId ? item.id === kitId : item.name === ACTIVITYKIT));
  if (!kit) {
    throw new SetupError(`${CRATE} ${crate.version} does not depend on ${ACTIVITYKIT}, whose Swift package the widget extension links: use the crate of the npm package's version, ${NPM_VERSION}.`);
  }
  return {
    plugin: { version: crate.version, dir: dirname(crate.manifestPath) },
    activitykit: { version: kit.version, dir: dirname(kit.manifestPath) },
  };
}

/** Adds the plugin's permissions to the app's capability: default.json, or the only capability file. */
function capabilitiesStep({ srcTauri, show }: SetupContext): PlannedStep {
  const folder = join(srcTauri, 'capabilities');
  const files = existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.json')) : [];
  const name = files.includes('default.json') ? 'default.json' : files.length === 1 ? files[0] : undefined;
  const list = PERMISSIONS.join(', ');
  if (!name) return step('todo', show(folder), `add these permissions to the capability of your window: ${list}`);
  const path = join(folder, name);
  const text = readFileSync(path, 'utf8');
  const capability = parseJson(text);
  const permissions = member(capability, 'permissions') ?? [];
  if (!isRecord(capability) || !isList(permissions)) return step('todo', show(path), `not valid JSON with a permissions list; add these permissions to it: ${list}`);
  const present = new Set(permissions.map(item => (typeof item === 'string' ? item : member(item, 'identifier'))));
  const missing = PERMISSIONS.filter(permission => !present.has(permission));
  if (missing.length === 0) return step('unchanged', show(path));
  const next = { ...capability, permissions: [...permissions, ...missing] };
  return step('updated', show(path), `${missing.length} permissions added`, writeFile(path, jsonLike(text, next)));
}

/** Tauri writes minSdk into gen/android when it creates it, from bundle.android.minSdkVersion (24 by default). */
function androidSteps(context: SetupContext): PlannedStep[] {
  const gradle = gradleStep(context);
  return [minSdkConfigStep(context), ...(gradle ? [gradle] : [])];
}

/** The members of a JSON object, to spread into its next form; a value that is no object has none. */
const members = (value: unknown): Readonly<Record<string, unknown>> => (isRecord(value) ? value : {});

function minSdkConfigStep({ configPath, configText, config, show }: SetupContext): PlannedStep {
  const current = member(config.bundle, 'android', 'minSdkVersion');
  if (typeof current === 'number' && Number.isInteger(current) && current >= MIN_SDK) return step('unchanged', show(configPath));
  const android = { ...members(member(config.bundle, 'android')), minSdkVersion: MIN_SDK };
  const text = jsonLike(configText, { ...config, bundle: { ...members(config.bundle), android } });
  return step('updated', show(configPath), `bundle.android.minSdkVersion = ${MIN_SDK}, as the plugin needs Android 8`, writeFile(configPath, text));
}

function gradleStep({ srcTauri, show }: SetupContext): PlannedStep | undefined {
  const path = join(srcTauri, 'gen', 'android', 'app', 'build.gradle.kts');
  const gradle = readText(path);
  if (gradle === undefined) return undefined;
  const match = /^([ \t]*minSdk[ \t]*=[ \t]*)(\d+)[ \t]*$/m.exec(gradle);
  if (!match) return step('todo', show(path), `set minSdk to ${MIN_SDK}`);
  const [, before = '', value = ''] = match;
  if (Number(value) >= MIN_SDK) return step('unchanged', show(path));
  const at = match.index + before.length;
  return step('updated', show(path), `minSdk = ${MIN_SDK}`, writeFile(path, `${gradle.slice(0, at)}${MIN_SDK}${gradle.slice(at + value.length)}`));
}

const minor = (version: string): string | undefined => /^\d+\.\d+/.exec(version)?.[0];

function notes({ srcTauri, plugin }: SetupContext): Note[] {
  const sources = join(srcTauri, 'src');
  const registered = existsSync(sources) && readdirSync(sources, { recursive: true })
    .filter(name => String(name).endsWith('.rs'))
    .some(name => readFileSync(join(sources, String(name)), 'utf8').includes('tauri_plugin_live_activity::init'));
  return [
    ...(registered ? [] : [{ kind: 'register', text: 'add .plugin(tauri_plugin_live_activity::init()) to tauri::Builder in src-tauri/src/lib.rs.' } satisfies Note]),
    ...(minor(plugin.version) === minor(NPM_VERSION) ? [] : [{
      kind: 'version',
      text: `The npm package ${NPM_VERSION} and the crate ${plugin.version} differ: use the same minor version of both.`,
    } satisfies Note]),
  ];
}
