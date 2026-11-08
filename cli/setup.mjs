// `npx tauri-plugin-live-activity setup`: what the README's install steps need, done in an app's folder.
// Every step first works out what to change; a dry run stops there.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { iosSteps } from './ios.mjs';
import { SetupError, display, jsonLike, parseJson, readText, step, tail, writeFile } from './steps.mjs';
import { widgetFiles } from './widget-files.mjs';

export { SetupError } from './steps.mjs';

export const CRATE = 'tauri-plugin-live-activity';
/** The crate whose Swift package the widget extension and the app target link. */
export const ACTIVITYKIT = 'activitykit';
/** `default` reads; the others allow the commands that change activities. */
export const PERMISSIONS = [
  'live-activity:default',
  ...['request-permissions', 'start', 'update', 'end', 'start-layout', 'update-layout', 'end-layout', 'write-image']
    .map(command => `live-activity:allow-${command}`),
];
// The plugin's Android library needs API 26: Tauri's Jackson runtime fails below it.
const MIN_SDK = 26;
const NPM_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * Sets up the app in `cwd` (its folder or its src-tauri folder) and returns the steps with their
 * status, and notes for the person who runs it. `fonts` and `assets` are files for the widget
 * extension; `appGroup` is true or the name of an App Group. Throws SetupError when it cannot start.
 */
export function setup({
  cwd = process.cwd(), env = process.env, dryRun = false, iosOnly = false, platform = process.platform,
  fonts = [], assets = [], appGroup = undefined,
} = {}) {
  const files = widgetFiles(cwd, { fonts, assets });
  const app = findApp(cwd);
  const { plugin, activitykit } = findCrates(app, env);
  const context = { ...app, plugin, activitykit, env, platform, files, appGroup, show: path => display(cwd, path) };
  const planned = [...(iosOnly ? [] : [capabilitiesStep(context), ...androidSteps(context)]), ...iosSteps(context)];
  const steps = dryRun ? planned : planned.map(apply);
  return { dryRun, version: plugin.version, steps: steps.map(({ effect, ...rest }) => rest), notes: notes(context) };
}

function apply(planned) {
  if (!planned.effect) return planned;
  try {
    return planned.effect() ?? planned;
  } catch (error) {
    return step('todo', planned.path, `could not write it: ${error.message}`);
  }
}

function findApp(cwd) {
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
  if (typeof config !== 'object' || config === null) throw new SetupError(`${display(cwd, configPath)} is not valid JSON.`);
  if (!existsSync(join(srcTauri, 'Cargo.toml'))) throw new SetupError('No src-tauri/Cargo.toml next to tauri.conf.json.');
  return { srcTauri, configPath, configText, config };
}

/**
 * The plugin crate's version and the folder of the activitykit crate it depends on, from `cargo metadata`: the widget
 * extension and the app target link activitykit's Swift package, which lies in that folder.
 */
export function findCrates({ srcTauri }, env) {
  const args = ['metadata', '--format-version', '1', '--manifest-path', join(srcTauri, 'Cargo.toml')];
  const result = spawnSync(env.CARGO || 'cargo', args, { env, encoding: 'utf8', maxBuffer: 1024 ** 3 });
  if (result.error?.code === 'ENOENT') throw new SetupError('cargo was not found. Install Rust from https://rustup.rs, then run this again.');
  if (result.error) throw new SetupError(`cargo metadata could not run: ${result.error.message}`);
  if (result.status !== 0) throw new SetupError(`cargo metadata failed: ${tail(result.stderr)}`);
  const metadata = parseJson(result.stdout);
  if (!Array.isArray(metadata?.packages)) throw new SetupError('cargo metadata printed something that is not its JSON.');
  const crate = metadata.packages.find(item => item.name === CRATE);
  if (!crate) {
    throw new SetupError(`${CRATE} is not a dependency of src-tauri/Cargo.toml yet. Add it first:\n  cargo add ${CRATE} --manifest-path src-tauri/Cargo.toml`);
  }
  const kitId = metadata.resolve?.nodes?.find(node => node.id === crate.id)?.deps?.find(dep => dep.name === ACTIVITYKIT)?.pkg;
  const kit = metadata.packages.find(item => (kitId ? item.id === kitId : item.name === ACTIVITYKIT));
  if (!kit) {
    throw new SetupError(`${CRATE} ${crate.version} does not depend on ${ACTIVITYKIT}, whose Swift package the widget extension links: use the crate of the npm package's version, ${NPM_VERSION}.`);
  }
  return {
    plugin: { version: crate.version, dir: dirname(crate.manifest_path) },
    activitykit: { version: kit.version, dir: dirname(kit.manifest_path) },
  };
}

/** Adds the plugin's permissions to the app's capability: default.json, or the only capability file. */
function capabilitiesStep({ srcTauri, show }) {
  const folder = join(srcTauri, 'capabilities');
  const files = existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.json')) : [];
  const name = files.includes('default.json') ? 'default.json' : files.length === 1 ? files[0] : undefined;
  const list = PERMISSIONS.join(', ');
  if (!name) return step('todo', show(folder), `add these permissions to the capability of your window: ${list}`);
  const path = join(folder, name);
  const text = readFileSync(path, 'utf8');
  const capability = parseJson(text);
  const valid = typeof capability === 'object' && capability !== null && Array.isArray(capability.permissions ?? []);
  if (!valid) return step('todo', show(path), `not valid JSON with a permissions list; add these permissions to it: ${list}`);
  const present = new Set((capability.permissions ?? []).map(item => (typeof item === 'string' ? item : item?.identifier)));
  const missing = PERMISSIONS.filter(permission => !present.has(permission));
  if (missing.length === 0) return step('unchanged', show(path));
  const next = { ...capability, permissions: [...(capability.permissions ?? []), ...missing] };
  return step('updated', show(path), `${missing.length} permissions added`, writeFile(path, jsonLike(text, next)));
}

/** Tauri writes minSdk into gen/android when it creates it, from bundle.android.minSdkVersion (24 by default). */
function androidSteps(context) {
  const gradle = gradleStep(context);
  return [minSdkConfigStep(context), ...(gradle ? [gradle] : [])];
}

function minSdkConfigStep({ configPath, configText, config, show }) {
  const current = config.bundle?.android?.minSdkVersion;
  if (Number.isInteger(current) && current >= MIN_SDK) return step('unchanged', show(configPath));
  const android = { ...config.bundle?.android, minSdkVersion: MIN_SDK };
  const text = jsonLike(configText, { ...config, bundle: { ...config.bundle, android } });
  return step('updated', show(configPath), `bundle.android.minSdkVersion = ${MIN_SDK}, as the plugin needs Android 8`, writeFile(configPath, text));
}

function gradleStep({ srcTauri, show }) {
  const path = join(srcTauri, 'gen', 'android', 'app', 'build.gradle.kts');
  const gradle = readText(path);
  if (gradle === undefined) return undefined;
  const match = /^([ \t]*minSdk[ \t]*=[ \t]*)(\d+)[ \t]*$/m.exec(gradle);
  if (!match) return step('todo', show(path), `set minSdk to ${MIN_SDK}`);
  if (Number(match[2]) >= MIN_SDK) return step('unchanged', show(path));
  const at = match.index + match[1].length;
  return step('updated', show(path), `minSdk = ${MIN_SDK}`, writeFile(path, `${gradle.slice(0, at)}${MIN_SDK}${gradle.slice(at + match[2].length)}`));
}

const minor = version => /^\d+\.\d+/.exec(version)?.[0];

function notes({ srcTauri, plugin }) {
  const sources = join(srcTauri, 'src');
  const registered = existsSync(sources) && readdirSync(sources, { recursive: true })
    .filter(name => String(name).endsWith('.rs'))
    .some(name => readFileSync(join(sources, String(name)), 'utf8').includes('tauri_plugin_live_activity::init'));
  return [
    ...(registered ? [] : [{ kind: 'register', text: 'add .plugin(tauri_plugin_live_activity::init()) to tauri::Builder in src-tauri/src/lib.rs.' }]),
    ...(minor(plugin.version) === minor(NPM_VERSION) ? [] : [{
      kind: 'version',
      text: `The npm package ${NPM_VERSION} and the crate ${plugin.version} differ: use the same minor version of both.`,
    }]),
  ];
}
