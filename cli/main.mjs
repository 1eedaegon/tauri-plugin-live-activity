// The command line of `npx tauri-plugin-live-activity`.
import { formatReport } from './report.mjs';
import { SetupError, setup } from './setup.mjs';

const USAGE = `Usage: npx tauri-plugin-live-activity setup [--dry-run] [--ios-only] [--font <file>]... [--asset <file>]... [--app-group[=<id>]]

Run it in the folder of a Tauri 2 app after \`cargo add\` and \`npm i\`. It grants the plugin's
permissions, sets the Android minimum to API 26 and, on a Mac, adds the Live Activity widget
extension to src-tauri/gen/apple. Run it after \`tauri ios init\`, and again if that folder is
ever made from scratch.

  --dry-run          show what would change, and write nothing
  --ios-only         do only the iOS part: leave the capabilities and tauri.conf.json alone
  --font <file>      bundle a .ttf, .otf or .ttc font in the widget extension, for a style's fontFamily
  --asset <file>     put a .png, .jpg, .pdf or .svg image in the widget's asset catalog, for image('<name>');
                     name@2x.png and name@3x.png are scales of the asset name
  --app-group[=<id>] give the app and the widget extension an App Group, group.<app identifier> unless
                     named, so writeImage can share images; later runs keep it
`;

const FLAGS = { '--dry-run': 'dryRun', '--ios-only': 'iosOnly' };
const FILES = { '--font': 'fonts', '--asset': 'assets' };
const HELP = new Set(['help', '--help', '-h']);

/** The options of `setup`, or the argument it does not take and why. */
function parseOptions(args) {
  const options = { fonts: [], assets: [] };
  for (let index = 0; index < args.length; index += 1) {
    const [name, inline] = args[index].split(/=(.*)/s);
    if (Object.hasOwn(FLAGS, args[index])) options[FLAGS[args[index]]] = true;
    else if (name === '--app-group') options.appGroup = inline ?? true;
    else if (Object.hasOwn(FILES, name)) {
      const file = inline ?? args[(index += 1)];
      if (!file) return { error: `${name} needs a file.` };
      options[FILES[name]].push(file);
    } else return { error: `Unknown option ${args[index]}.` };
  }
  return { options };
}

/** Runs the command and returns its exit status: 0 done, 1 something left to do or an error, 2 usage. */
export function main(argv, {
  cwd = process.cwd(), env = process.env, platform = process.platform,
  out = text => process.stdout.write(text), err = text => process.stderr.write(text),
} = {}) {
  const [command, ...rest] = argv;
  if (command === undefined || HELP.has(command) || (command === 'setup' && rest.some(arg => HELP.has(arg)))) {
    out(USAGE);
    return 0;
  }
  if (command !== 'setup') {
    err(`Unknown command ${command}.\n\n${USAGE}`);
    return 2;
  }
  const { options, error } = parseOptions(rest);
  if (error) {
    err(`${error}\n\n${USAGE}`);
    return 2;
  }
  try {
    const result = setup({ cwd, env, platform, ...options });
    out(formatReport(result));
    return result.steps.some(item => item.status === 'todo') ? 1 : 0;
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    err(`${error.message}\n`);
    return 1;
  }
}
