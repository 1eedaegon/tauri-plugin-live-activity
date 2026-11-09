import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { linkActivitykit } from './link-activitykit.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: directory,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'esm',
  target: ['es2021'],
  sourcemap: true,
});
await Promise.all(['index.html', 'styles.css'].map(name => copyFile(
  new URL(`src/${name}`, import.meta.url), new URL(`dist/${name}`, import.meta.url),
)));
// The Xcode project names activitykit's Swift package through this link. A build without cargo (the web page alone)
// goes on without it.
try {
  linkActivitykit();
} catch (error) {
  console.warn(`The iOS project cannot reach activitykit: ${error.message}`);
}
