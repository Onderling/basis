/**
 * The export before an update, on the real box: the runner (a household bot) is up; the updater's own command —
 * `export-now.mjs` against the runner's data dir — gets a fresh export file back, written by the runner, named by the
 * outgoing version. Nothing but the runner opens the household's store.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { until } from './support/pairRealAgents.js';
import { startJourneyRelay } from './support/testRelay.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const EXPORT_NOW = fileURLToPath(new URL('../bin/export-now.mjs', import.meta.url));

describe('export-now on the real box', () => {
  let child; let dataDir; let relay; let out = '';
  beforeAll(async () => {
    // the assistant (and its export shelf) runs behind a door: here its inbox, over a relay
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-export-now-'));
    child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    expect(await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 }), `the runner never came up:\n${out.slice(-1500)}`).toBe(true);
  }, 120_000);
  afterAll(() => {
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
    try { relay?.close?.(); } catch { /* */ }
  });

  it('the updater\'s command gets a fresh export from the running assistant, named by the outgoing version', async () => {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [EXPORT_NOW, '--data-dir', dataDir, '--sha', 'abc1234def5678', '--timeout', '100'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let so = ''; let se = '';
      p.stdout.on('data', (b) => { so += String(b); }); p.stderr.on('data', (b) => { se += String(b); });
      p.on('close', (code) => resolve({ code, so: so.trim(), se }));
    });
    expect(r.code, `export-now failed: ${r.se}\n${out.slice(-800)}`).toBe(0);
    expect(r.so).toMatch(/^pre-update-\d{4}-\d{2}-\d{2}-\d{4}-abc1234def56\.json$/);
    const files = readdirSync(path.join(dataDir, 'exports'));
    expect(files).toContain(r.so);
    const file = JSON.parse(readFileSync(path.join(dataDir, 'exports', r.so), 'utf8'));
    expect(file.format ?? file.kind ?? Object.keys(file).length, 'an export file').toBeTruthy();
    expect(files.filter((f) => f.startsWith('.export-request')), 'the request was taken').toEqual([]);
  }, 130_000);

  it('with no runner answering, export-now says so and fails (the updater then holds)', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'basis-export-none-'));
    const r = spawnSync(process.execPath, [EXPORT_NOW, '--data-dir', empty, '--sha', 'abc', '--timeout', '5'], { encoding: 'utf8' });
    rmSync(empty, { recursive: true, force: true });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no export \(timeout\)/);
  }, 20_000);
});
