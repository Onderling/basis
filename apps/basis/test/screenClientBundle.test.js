/**
 * The screen client as ONE file (ledger L1035, the circle-tools brief's rules for a toolbox's page): built from
 * the same source by `scripts/build-screen-client.mjs`; one ESM file with no real `import()` (comments aside), no
 * worker, no wasm; a `.d.ts` and a VERSION beside it; and NOTHING done at import: importing it with no `window` touches
 * no global and opens nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(app, 'dist', 'screen-client');
const file = path.join(out, 'onderling-screen-client.js');

describe('the screen client, built into one file', () => {
  beforeAll(() => { execFileSync(process.execPath, [path.join(app, 'scripts', 'build-screen-client.mjs')], { cwd: app, stdio: 'pipe' }); }, 180_000);

  it('one ESM file, its .d.ts and its VERSION', async () => {
    expect(existsSync(file)).toBe(true);
    expect(existsSync(path.join(out, 'onderling-screen-client.d.ts'))).toBe(true);
    const { SCREEN_CLIENT_VERSION } = await import('../src/v2/screenClient.js');
    expect(readFileSync(path.join(out, 'VERSION'), 'utf8').trim()).toBe(SCREEN_CLIENT_VERSION);
  });

  it('no real import(), no worker, no wasm (a toolbox may fold it into one classic script)', () => {
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code.match(/[^.\w]import\(/g) ?? []).toEqual([]);
    expect(code).not.toMatch(/new Worker\(|WebAssembly\./);
  });

  it('nothing at import: no global touched, no window needed; the API is there', async () => {
    const before = new Set(Object.getOwnPropertyNames(globalThis));
    const hadWindow = 'window' in globalThis;
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    const added = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
    expect(added, 'globals the import added').toEqual([]);
    expect('window' in globalThis).toBe(hadWindow);
    expect(typeof mod.createScreenClient).toBe('function');
    expect(mod.SCREEN_CLIENT_CODES).toContain('grant-expired');
  });
});
