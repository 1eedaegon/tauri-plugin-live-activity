import { fileURLToPath } from 'node:url';

// The plugin's entry points as source files of guest-js, by the import path an app writes. The live page takes the
// plugin so (vite.config.ts), as build.ts does for the demo's own page; so does the test of its card, and
// tsconfig.live.json names the same files for the type check.
const files = {
  'tauri-plugin-live-activity': 'index.ts',
  'tauri-plugin-live-activity/react': 'react/index.ts',
  'tauri-plugin-live-activity/jsx': 'jsx/index.ts',
  'tauri-plugin-live-activity/jsx/jsx-runtime': 'jsx/jsx-runtime.ts',
  'tauri-plugin-live-activity/jsx/jsx-dev-runtime': 'jsx/jsx-dev-runtime.ts',
};

export const pluginSource: { readonly [specifier: string]: string } = Object.fromEntries(
  Object.entries(files).map(([specifier, file]) => [specifier, fileURLToPath(new URL(`../../guest-js/${file}`, import.meta.url))]),
);
