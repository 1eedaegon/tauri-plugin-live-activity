import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { pluginSource } from './plugin-source.ts';

// The live-editing page's dev server (docs/live-editing.md). `tauri ios dev --config src-tauri/tauri.live.conf.json`
// starts it, and the app loads the page from it; saves reach the running page through React Fast Refresh. It serves
// src/live alone: the demo's own page is build.ts's.
const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
// Set by Tauri's CLI with `--host`, and when the app runs on a device and reaches the Mac by its network address.
const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  root: at('src/live'),
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // The plugin as source, as build.ts takes it: a change to guest-js reaches the page as well. Each path exactly,
    // since an alias by prefix would send `tauri-plugin-live-activity/jsx` to the main entry's file.
    alias: Object.entries(pluginSource).map(([specifier, file]) => ({ find: new RegExp(`^${specifier}$`), replacement: file })),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    // The app may load the page through its own scheme, so the socket of hot updates is named in full.
    hmr: { protocol: 'ws', host: host ?? 'localhost', port: 1421 },
    // Only what the page is made of. On a device run Vite listens on the Mac's network address, without a password,
    // so nothing else of the working tree may be served: a signing key or a keystore may lie there. The page imports
    // ../live-page.ts and the plugin's guest-js, outside its root; the rest comes from the two node_modules.
    fs: {
      allow: [at('src'), at('node_modules'), at('../../guest-js'), at('../../node_modules')],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '*.{asc,gpg,p8,p12,key,jks,keystore,mobileprovision}', 'key.properties'],
    },
  },
});
