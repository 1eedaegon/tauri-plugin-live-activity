import { build, context } from 'esbuild';
import type { BuildOptions } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { linkActivitykit } from './link-activitykit.ts';

// `node build.ts` writes the page to dist once. `node build.ts --watch` stays, and writes it again after each change
// of a file the page is made of: the demo's sources and the plugin's guest-js, which the demo imports as source.
// Tauri's dev commands start it so (tauri.conf.json), and their dev server reloads the page when dist changes.
const watching = process.argv.includes('--watch');
const page: BuildOptions = {
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/main.ts', 'src/index.html', 'src/styles.css'],
  // The page and its style sheet go to dist as they are.
  loader: { '.html': 'copy', '.css': 'copy' },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: ['es2021'],
  sourcemap: true,
};
await build(page);
// The Xcode project names activitykit's Swift package through this link. A build without cargo (the web page alone)
// goes on without it.
try {
  linkActivitykit();
} catch (error) {
  console.warn(`The iOS project cannot reach activitykit: ${error instanceof Error ? error.message : String(error)}`);
}
if (watching) {
  // A change that does not build is reported here, and dist stays as it was.
  const pages = await context({ ...page, logLevel: 'info' });
  await pages.watch();
}
