// The command line of `npx tauri-plugin-live-activity`.
import { formatReport } from './report.mjs';
import { SetupError, setup } from './setup.mjs';

const USAGE = `Usage: npx tauri-plugin-live-activity setup [--dry-run] [--ios-only] [--font <file>]... [--asset <file>]... [--app-group[=<id>]] [--small-family]

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
  --small-family     draw a layout's small region on a paired Apple Watch and in CarPlay, and there the
                     compact parts of a layout without one; later runs keep it
`;

const FLAGS = { '--dry-run': 'dryRun', '--ios-only': 'iosOnly', '--small-family': 'smallFamily' } as const;
const FILES = { '--font': 'fonts', '--asset': 'assets' } as const;
const HELP = new Set(['help', '--help', '-h']);

/** What the command line asks of `setup`. */
interface CommandOptions {
  fonts: string[];
  assets: string[];
  dryRun?: true;
  iosOnly?: true;
  smallFamily?: true;
  /** True for `--app-group`, or the name that follows its `=`. */
  appGroup?: string | true;
}

/** What `parseOptions` answers: the options, or the `error` to print with the usage. */
type ParsedOptions = { readonly options: CommandOptions } | { readonly error: string };

/** Where the command runs and writes. A member left out or undefined is the process's own. */
export interface CommandIo {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly out?: ((text: string) => void) | undefined;
  readonly err?: ((text: string) => void) | undefined;
}

/** 0: done. 1: something is left to do, or setup could not start. 2: the command line is not one it takes. */
export type ExitStatus = 0 | 1 | 2;

const isFlag = (name: string): name is keyof typeof FLAGS => Object.hasOwn(FLAGS, name);
const takesFile = (name: string): name is keyof typeof FILES => Object.hasOwn(FILES, name);

/** The options of `setup`, or the argument it does not take and why. */
function parseOptions(args: readonly string[]): ParsedOptions {
  const options: CommandOptions = { fonts: [], assets: [] };
  const left = [...args];
  for (let arg = left.shift(); arg !== undefined; arg = left.shift()) {
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    if (isFlag(arg)) options[FLAGS[arg]] = true;
    else if (name === '--app-group') options.appGroup = inline ?? true;
    else if (takesFile(name)) {
      const file = inline ?? left.shift();
      if (!file) return { error: `${name} needs a file.` };
      options[FILES[name]].push(file);
    } else return { error: `Unknown option ${arg}.` };
  }
  return { options };
}

/** Runs the command and returns its exit status: 0 done, 1 something left to do or an error, 2 usage. */
export function main(argv: readonly string[], {
  cwd = process.cwd(), env = process.env, platform = process.platform,
  out = text => process.stdout.write(text), err = text => process.stderr.write(text),
}: CommandIo = {}): ExitStatus {
  const [command, ...rest] = argv;
  if (command === undefined || HELP.has(command) || (command === 'setup' && rest.some(arg => HELP.has(arg)))) {
    out(USAGE);
    return 0;
  }
  if (command !== 'setup') {
    err(`Unknown command ${command}.\n\n${USAGE}`);
    return 2;
  }
  const parsed = parseOptions(rest);
  if ('error' in parsed) {
    err(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  try {
    const result = setup({ cwd, env, platform, ...parsed.options });
    out(formatReport(result));
    return result.steps.some(item => item.status === 'todo') ? 1 : 0;
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    err(`${error.message}\n`);
    return 1;
  }
}
