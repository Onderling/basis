/**
 * THE SCREEN CLIENT IN A PAGE OPENED FROM DISK (ledger L1035, the circle-tools brief §9 and §10): a toolbox folds the
 * ONE built file into its own classic script (module scripts are refused on `file://`), the page loads from
 * `file://…/index.html`, the client is there and runs nothing until asked, a first visit says `not-paired`, a pairing
 * keeps its key under THIS toolbox's name, and what the browser does with `file://` storage (one store for every local
 * page, or one per path) is read and reported: a toolbox builder must be told which.
 *
 *   npx playwright test test-browser/screen-client-file.spec.js --project=no-relay
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(app, 'dist', 'screen-client', 'onderling-screen-client.js');
const esbuild = path.join(app, 'node_modules', '.bin', 'esbuild');

/** A toolbox's page in a folder of its own: its script imports the built client and is folded into ONE classic script. */
function pageIn(dir, startLink) {
  writeFileSync(path.join(dir, 'page.src.js'), `
    import { createScreenClient, SCREEN_CLIENT_VERSION } from ${JSON.stringify(built)};
    const before = localStorage.getItem('onderling.probe');
    localStorage.setItem('onderling.probe', location.pathname);
    const client = createScreenClient({ toolbox: 'boodschappen', bot: ${JSON.stringify(startLink)} });
    window.__report = { version: SCREEN_CLIENT_VERSION, state: client.state(), seenByThisPage: before };
    client.resume().then((r) => { window.__report.resume = r; });
    client.startPairing().then((p) => { window.__report.pairing = { code: p.code }; }, (e) => { window.__report.pairingError = String(e && e.message || e); })
      .finally(() => { window.__report.keys = Object.keys(localStorage); });
  `);
  execFileSync(esbuild, [path.join(dir, 'page.src.js'), '--bundle', '--format=iife', '--platform=browser', `--outfile=${path.join(dir, 'page.js')}`, '--log-level=error'], { cwd: app });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>toolbox page</title><script src="./page.js"></script>');
  return pathToFileURL(path.join(dir, 'index.html')).href;
}

test('the built client in a page opened from disk', async ({ browser }, testInfo) => {
  execFileSync(process.execPath, [path.join(app, 'scripts', 'build-screen-client.mjs')], { cwd: app, stdio: 'pipe' });
  // a start link whose relay is not there: the pairing makes its key (where it lands is what is read) and then cannot connect
  const { encodeScreenStartLink } = await import(pathToFileURL(path.join(app, 'src', 'v2', 'botScreens.js')).href);
  const start = encodeScreenStartLink('https://basis.example/app', { botAddress: 'BOTKEY', relayUrl: 'ws://127.0.0.1:9' });
  const a = pageIn(mkdtempSync(path.join(tmpdir(), 'toolbox-page-a-')), start);
  const b = pageIn(mkdtempSync(path.join(tmpdir(), 'toolbox-page-b-')), start);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(a);
  await page.waitForFunction(() => window.__report && window.__report.resume && window.__report.keys, null, { timeout: 30_000 });
  const ra = await page.evaluate(() => window.__report);
  expect(ra.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(ra.state).toBe('not-paired');
  expect(ra.resume).toEqual({ ok: false, code: 'not-paired' });
  // the key a pairing made sits under THIS toolbox's name
  expect(ra.keys.some((k) => k.startsWith('onderling-screen:boodschappen:')), `the keys: ${ra.keys.join(', ')}`).toBe(true);

  // a second page from another folder, same browser: does it see the first page's storage?
  const page2 = await ctx.newPage();
  await page2.goto(b);
  await page2.waitForFunction(() => window.__report && window.__report.resume, null, { timeout: 30_000 });
  const rb = await page2.evaluate(() => window.__report);
  const shared = rb.seenByThisPage !== null;
  testInfo.annotations.push({ type: 'file-storage', description: `${testInfo.project.use?.defaultBrowserType ?? 'chromium'}: file:// storage is ${shared ? 'ONE store shared by every local page' : 'kept per path'}` });
  console.info(`[screen-client] chromium: file:// storage is ${shared ? 'shared by every local page' : 'kept per path'}; page B saw ${JSON.stringify(rb.seenByThisPage)}`);
  await ctx.close();
});
