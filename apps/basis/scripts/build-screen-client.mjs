#!/usr/bin/env node
/**
 * Build the SCREEN CLIENT (src/v2/screenClient.js) into ONE ESM file a toolbox's page imports (ledger L1035, the
 * circle-tools brief): `dist/screen-client/onderling-screen-client.js`, beside its `.d.ts` and `VERSION`.
 * Vite in library mode over the web app's OWN config, so the browser shims (node:*, ws, …) are the ones the web app
 * ships with, defined once in vite.config.js, never copied here. One file: no chunks, no workers, no wasm.
 */
import { build } from 'vite';
import { copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(app, 'dist', 'screen-client');
const { SCREEN_CLIENT_VERSION } = await import(path.join(app, 'src', 'v2', 'screenClient.js'));

await build({
  configFile: path.join(app, 'vite.config.js'),
  root: app,
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: { entry: path.join(app, 'src', 'v2', 'screenClient.js'), formats: ['es'], fileName: () => 'onderling-screen-client.js' },
    rollupOptions: { input: path.join(app, 'src', 'v2', 'screenClient.js'), output: { inlineDynamicImports: true } },
  },
});
mkdirSync(out, { recursive: true });
copyFileSync(path.join(app, 'src', 'v2', 'screenClient.d.ts'), path.join(out, 'onderling-screen-client.d.ts'));
writeFileSync(path.join(out, 'VERSION'), `${SCREEN_CLIENT_VERSION}\n`);
console.log(`screen client ${SCREEN_CLIENT_VERSION} → ${path.relative(app, out)}/onderling-screen-client.js`);
