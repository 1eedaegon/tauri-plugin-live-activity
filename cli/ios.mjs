// The iOS part of setup: Info.ios.plist, the widget files in gen/apple with the fonts and images it bundles, the
// XcodeGen spec that adds the widget extension on activitykit's Swift package, the App Group, and the regenerated
// Xcode project. An app that 0.2 or 0.3 set up loses the plugin's old Swift files on the way (migration.mjs).
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OLD_MODULES, RETIRED, released, renameCustomViews } from './migration.mjs';
import { newPlist, setTrueKey } from './plist.mjs';
import { SetupError, parseJson, readText, step, tail, which, writeFile } from './steps.mjs';
import { assetSteps, bundledFonts, fontSteps } from './widget-files.mjs';
import { SPEC_FILE, WIDGET, addInclude, appGroupOf, readProject, widgetSpec, writtenBySetup } from './xcodegen.mjs';

/** The widget bundle: activitykit's template, under the name 0.2 and 0.3 gave the plugin's. */
const WIDGET_FILE = 'LiveActivityWidget.swift';
const WIDGET_TEMPLATE = join('templates', 'ios', 'Widget.swift');
/** The app's own file: created once from the template and never written again, but for the names of activitykit. */
const CUSTOM_VIEWS = 'LiveActivityCustomViews.swift';
const CUSTOM_VIEWS_TEMPLATE = new URL('./templates/LiveActivityCustomViews.swift', import.meta.url);
const GROUP = /^group\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
const PLIST_KEY = 'NSSupportsLiveActivities';

export function iosSteps(context) {
  const { srcTauri, platform, show } = context;
  if (platform !== 'darwin') return [step('skipped', 'iOS', 'needs a Mac with Xcode')];
  const apple = join(srcTauri, 'gen', 'apple');
  const specPath = join(apple, 'project.yml');
  const yaml = readText(specPath);
  if (yaml === undefined) {
    return [step('skipped', 'iOS', 'no src-tauri/gen/apple yet: run `tauri ios init`, then run setup again')];
  }
  const project = readProject(yaml);
  const plist = infoPlistStep(context);
  if (project.widget) {
    const detail = `already has a widget extension, ${project.widget}; add the plugin's widget to it by hand (docs/ios-integration.md)`;
    const { files, appGroup } = context;
    const given = [files.fonts.length && '--font', files.assets.length && '--asset', appGroup && '--app-group'].filter(Boolean);
    const left = given.length === 0 ? [] : [step('todo', show(specPath), `${given.join(', ')} not applied: that widget is yours to give fonts, images and an App Group (docs/ios-integration.md)`)];
    return [plist, step('skipped', show(specPath), detail), ...left];
  }
  if (!project.appTarget) {
    const detail = `no target named ${project.name ?? '<name>'}_iOS, so setup did not add the widget; see docs/usage.md`;
    return [plist, step('todo', show(specPath), detail)];
  }
  const widget = join(apple, WIDGET);
  const appGroup = appGroupFor(context, apple, project);
  const include = includeStep(context, specPath, yaml);
  // XcodeGen lists the files of a folder when it generates, so a new or removed widget file also needs a run.
  const projectSteps = [
    widgetStep(context, widget), ...retiredSteps(context, widget, readText(join(apple, SPEC_FILE))), customViewsStep(context, widget),
    ...fontSteps(context, widget), ...assetSteps(context, widget),
    specStep(context, apple, project, { fonts: bundledFonts(context, widget), appGroup }), include,
  ];
  return [plist, ...projectSteps, xcodegenStep(context, apple, specPath, projectSteps, include)];
}

/**
 * The App Group of `--app-group`: the group it names, or `group.<app identifier>`. A spec that setup wrote
 * with a group keeps it on later runs.
 */
function appGroupFor({ appGroup, config }, apple, project) {
  const kept = appGroupOf(readText(join(apple, SPEC_FILE)));
  const group = typeof appGroup === 'string' ? appGroup : kept ?? (appGroup ? `group.${project.bundleId ?? config.identifier}` : undefined);
  if (group !== undefined && !GROUP.test(group)) {
    throw new SetupError(`The App Group ${JSON.stringify(group)} must be "group." followed by letters, digits, '-' and '.'.`);
  }
  return group;
}

/**
 * LiveActivityCustomViews.swift belongs to the app: created once, then never written again, except that a file of 0.3
 * takes activitykit's names, its views kept.
 */
function customViewsStep({ show }, widget) {
  const path = join(widget, CUSTOM_VIEWS);
  const current = readText(path);
  if (current !== undefined) {
    const renamed = renameCustomViews(current);
    if (renamed === undefined) return step('unchanged', show(path));
    return step('updated', show(path), "activitykit's names for the registry and its types; your views are kept", writeFile(path, renamed));
  }
  const stub = readText(CUSTOM_VIEWS_TEMPLATE);
  return step('created', show(path), 'yours, for custom views; setup never changes it again', writeFile(path, stub));
}

/** Tauri merges src-tauri/Info.ios.plist into the app's Info.plist when it builds. */
function infoPlistStep({ srcTauri, show }) {
  const path = join(srcTauri, 'Info.ios.plist');
  const text = readText(path);
  if (text === undefined) return step('created', show(path), `${PLIST_KEY} = true`, writeFile(path, newPlist(PLIST_KEY)));
  const result = setTrueKey(text, PLIST_KEY);
  if (result.status === 'present') return step('unchanged', show(path));
  if (result.status === 'added') return step('updated', show(path), `${PLIST_KEY} = true`, writeFile(path, result.text));
  if (result.status === 'unreadable') {
    return step('todo', show(path), `add ${PLIST_KEY} = YES to it; setup reads XML plists only`);
  }
  return step('kept', show(path), `it sets ${PLIST_KEY} to something other than true; Live Activities need true`);
}

/** The widget bundle from activitykit's template; one that 0.2 or 0.3 wrote is replaced, one of the app's kept. */
function widgetStep({ activitykit, show }, widget) {
  const wanted = readText(join(activitykit.dir, WIDGET_TEMPLATE));
  if (wanted === undefined) throw new SetupError(`The activitykit crate at ${activitykit.dir} has no ${WIDGET_TEMPLATE}.`);
  const path = join(widget, WIDGET_FILE);
  const current = readText(path);
  if (current === undefined) return step('created', show(path), '', writeFile(path, wanted));
  if (current === wanted) return step('unchanged', show(path));
  if (released(WIDGET_FILE, current)) {
    return step('updated', show(path), "activitykit's widget, in place of the one tauri-plugin-live-activity 0.3 wrote", writeFile(path, wanted));
  }
  if (OLD_MODULES.test(current)) {
    return step('todo', show(path), "imports the Swift modules of tauri-plugin-live-activity 0.3, which 0.4 no longer has: draw with ActivityKitWidget's ActivityKitLayoutWidget(), or delete the file and run setup again");
  }
  return step('kept', show(path), "differs from activitykit's template; to take the template, delete it and run setup again");
}

/**
 * The button intent and the custom views registry of 0.2 and 0.3, which activitykit's products replace. A spec changed
 * by hand, which setup keeps, may still name one: XcodeGen would fail without it, so it stays as a step to do.
 */
function retiredSteps({ show }, widget, spec) {
  const kept = spec !== undefined && !writtenBySetup(spec);
  return RETIRED.flatMap(name => {
    const path = join(widget, name);
    const current = readText(path);
    if (current === undefined) return [];
    if (kept && spec.includes(name)) {
      return [step('todo', show(path), `${SPEC_FILE}, which you changed, still names it: take it out of the spec, then delete it; activitykit's Swift package replaces it`)];
    }
    if (released(name, current)) {
      return [step('removed', show(path), "activitykit's Swift package replaces it", () => rmSync(path))];
    }
    return [step('todo', show(path), "changed by hand; activitykit's Swift package replaces it, so move your changes and delete it")];
  });
}

function specStep({ plugin, activitykit, config, srcTauri, show }, apple, project, { fonts, appGroup }) {
  const path = join(apple, SPEC_FILE);
  const wanted = widgetSpec({
    fonts,
    appGroup,
    // XcodeGen writes the entitlements file from the spec, so the App Group goes into the spec, at the app's path.
    appEntitlements: project.entitlements ?? `${project.appTarget}/${project.appTarget}.entitlements`,
    pluginVersion: plugin.version,
    packagePath: join(activitykit.dir, 'swift'),
    appTarget: project.appTarget,
    bundleId: `${project.bundleId ?? config.identifier}.widget`,
    ...appVersions(config, srcTauri),
    teamGroup: project.settingGroups.includes('app'),
  });
  const current = readText(path);
  if (current === undefined) {
    return step('created', show(path), "the widget extension on activitykit's Swift package, and the button intent and custom views in the app", writeFile(path, wanted));
  }
  if (current === wanted) return step('unchanged', show(path));
  if (!writtenBySetup(current)) {
    return step('kept', show(path), 'it was changed by hand; delete it and run setup again to have it written anew');
  }
  return step('updated', show(path), 'for the current plugin, activitykit and app version', writeFile(path, wanted));
}

/** The `version` of Cargo.toml's [package] section. */
function cargoVersion(text = '') {
  let inPackage = false;
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) inPackage = /^\s*\[package\]\s*$/.test(line);
    else if (inPackage && /^\s*version\s*=/.test(line)) return /"([^"]+)"/.exec(line)?.[1];
  }
  return undefined;
}

/** The app's version where Tauri reads it, so that the extension's version matches the app's. */
function appVersions(config, srcTauri) {
  const fromFile = typeof config.version === 'string' && config.version.endsWith('.json');
  const version = fromFile ? parseJson(readText(resolve(srcTauri, config.version)) ?? '')?.version
    : config.version ?? cargoVersion(readText(join(srcTauri, 'Cargo.toml')));
  const short = /^\d+(\.\d+){0,2}/.exec(String(version ?? ''))?.[0];
  return short ? { appVersion: short, buildVersion: String(config.bundle?.iOS?.bundleVersion ?? short) } : {};
}

function includeStep({ show }, specPath, yaml) {
  const result = addInclude(yaml, SPEC_FILE);
  if (result.status === 'present') return step('unchanged', show(specPath));
  if (result.status === 'added') return step('updated', show(specPath), `includes ${SPEC_FILE}`, writeFile(specPath, result.text));
  return step('todo', show(specPath), `add ${SPEC_FILE} to its include list`);
}

function generatedWithWidget(apple) {
  return readdirSync(apple).filter(name => name.endsWith('.xcodeproj'))
    .some(name => readText(join(apple, name, 'project.pbxproj'))?.includes(WIDGET));
}

function xcodegenStep({ env, show }, apple, specPath, projectSteps, include) {
  const command = `xcodegen generate --spec ${show(specPath)}`;
  if (include.status === 'todo') return step('skipped', 'Xcode project', 'waits for the include in project.yml');
  const changed = projectSteps.some(item => ['created', 'updated', 'removed'].includes(item.status));
  if (!changed && generatedWithWidget(apple)) return step('unchanged', 'Xcode project');
  const xcodegen = which('xcodegen', env);
  if (!xcodegen) return step('todo', 'Xcode project', `XcodeGen is not on PATH. Install it (brew install xcodegen), then run: ${command}`);
  return step('ran', command, '', () => {
    const result = spawnSync(xcodegen, ['generate', '--spec', specPath], { cwd: apple, env, encoding: 'utf8' });
    if (result.status === 0) return undefined;
    const output = tail(result.stderr || result.stdout || result.error?.message);
    return step('todo', 'Xcode project', `xcodegen failed: ${output}. Fix it, then run: ${command}`);
  });
}
