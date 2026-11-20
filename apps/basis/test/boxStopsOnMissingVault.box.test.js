/**
 * The real box (`bin/device-runner.mjs`) with a data folder that ran a box (its `box-started` mark) but whose vault files
 * are gone (a backup put back without them): it stops with words that name a working way out, mints nothing, counts
 * the failed starts and backs off before exiting (a missing file may come back: it never holds for that) (ledger L1115).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'device-runner.mjs');
const cleanup = [];
afterEach(async () => { for (const f of cleanup.splice(0)) await f(); });

/** One start, until a line matching `until` is out (then the child is ended), it exits, or 60 s pass: `{out, code?}`. */
function startOnce(dataDir, { until, within = 60_000 } = {}) {
  return new Promise((resolve) => {
    let out = ''; let settled = false;
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: { PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const done = (r) => { if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL'); resolve({ ...r, out }); };
    const timer = setTimeout(() => done({ timedOut: true }), within);
    const onData = (b) => { out += String(b); if (until && until.test(out)) setTimeout(() => done({ matched: true }), 300); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => done({ code }));
  });
}

describe('the box with its vault files missing in a folder that ran a box (L1115)', () => {
  it('stops with words, mints nothing, counts, and backs off; the enrol never counts', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'box-missing-vault-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(path.join(dataDir, 'registry'));
    writeFileSync(path.join(dataDir, 'box-started'), '2026-11-01T00:00:00Z');   // this folder ran a box before

    const first = await startOnce(dataDir, { until: /trying again in/ });
    expect(first.out, first.out.slice(-800)).toMatch(/vault\.json and chat-vault\.json is missing/);
    expect(first.out).toMatch(/Failed starts in a row: 1/);
    expect(first.out).toMatch(/move .* aside .*--enrol/);
    expect(first.out).toMatch(/trying again in 1 minute/);
    expect(existsSync(path.join(dataDir, 'vault.json'))).toBe(false);
    expect(existsSync(path.join(dataDir, 'chat-vault.json'))).toBe(false);

    const second = await startOnce(dataDir, { until: /trying again in/ });
    expect(second.out).toMatch(/Failed starts in a row: 2/);
    expect(second.out).toMatch(/trying again in 2 minute/);
    expect(second.out).not.toMatch(/STOPPED TRYING/);
    expect(JSON.parse(readFileSync(path.join(dataDir, 'start-failures.json'), 'utf8'))).toMatchObject({ count: 2 });
  }, 90_000);

  // A box that ran before this upgrade has no `box-started` (the mark is new), but its registry holds its own record: a
  // finished start wrote it, after both vault files. Its first start after the upgrade must not mint a missing vault.
  it('a box that ran before the mark existed (registry rows, no mark), its chat vault gone: stops with words', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'box-old-folder-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const up = await startOnce(dataDir, { until: /device-runner: up/ });   // a real start that came up: a real old folder
    expect(up.out, up.out.slice(-800)).toMatch(/device-runner: up/);
    expect(readdirSync(path.join(dataDir, 'registry')).length, 'the start left no registry row').toBeGreaterThan(0);
    rmSync(path.join(dataDir, 'box-started'));          // the folder of a box from before the mark
    rmSync(path.join(dataDir, 'chat-vault.json'));      // a backup put back without its chat vault
    const again = await startOnce(dataDir, { until: /trying again in|device-runner: up/ });
    expect(again.out, again.out.slice(-800)).toMatch(/chat-vault\.json is missing/);
    expect(again.out).not.toMatch(/device-runner: up/);
    expect(existsSync(path.join(dataDir, 'chat-vault.json')), 'a new chat vault was minted').toBe(false);
  }, 120_000);

  it('a folder without the mark is a first start, also one cut short half-way', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'box-first-start-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(path.join(dataDir, 'registry'));   // what a killed first start left, no box-started
    const r = await startOnce(dataDir, { until: /device-runner: up|is missing/ });
    expect(r.out).not.toMatch(/is missing/);
  }, 90_000);
});
