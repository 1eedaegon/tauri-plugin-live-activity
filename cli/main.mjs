// The command line of `npx tauri-plugin-live-activity`.
import { formatReport } from './report.mjs';
import { SetupError, setup } from './setup.mjs';

const USAGE = `Usage: npx tauri-plugin-live-activity setup [--dry-run] [--ios-only]

Run it in the folder of a Tauri 2 app after \`cargo add\` and \`npm i\`. It grants the plugin's
permissions, sets the Android minimum to API 26 and, on a Mac, adds the Live Activity widget
extension to src-tauri/gen/apple. Run it after \`tauri ios init\`, and again if that folder is
ever made from scratch.

  --dry-run   show what would change, and write nothing
  --ios-only  do only the iOS part: leave the capabilities and tauri.conf.json alone
`;

const FLAGS = { '--dry-run': 'dryRun', '--ios-only': 'iosOnly' };
const HELP = new Set(['help', '--help', '-h']);

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
  const unknown = command === 'setup' ? rest.find(arg => !Object.hasOwn(FLAGS, arg)) : command;
  if (unknown !== undefined) {
    err(`Unknown ${command === 'setup' ? 'option' : 'command'} ${unknown}.\n\n${USAGE}`);
    return 2;
  }
  const options = Object.fromEntries(rest.map(arg => [FLAGS[arg], true]));
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
