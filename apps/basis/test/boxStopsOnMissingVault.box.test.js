/**
 * The real box (`bin/device-runner.mjs`) with a data folder that holds a box's state but no vault files (a backup put
 * back without them): it stops with words and mints nothing, counts the failed starts, and on the third one in a row it
 * STOPS TRYING: says so and stays up, so its container does not restart it in a loop (ledger L1115).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'device-runner.mjs');
const cleanup = [];
afterEach(async () => { for (const f of cleanup.splice(0)) await f(); });

/** One start: `{code, out}` when it exits, or `{held: true, out}` when it is still up after the line. */
function startOnce(dataDir, { holdWithin = 20_000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: { PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const done = (r) => { clearTimeout(timer); resolve({ ...r, out }); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); done({ timedOut: true }); }, holdWithin);
    const onData = (b) => {
      out += String(b);
      if (out.includes('STOPPED TRYING')) setTimeout(() => { const up = child.exitCode == null; child.kill('SIGKILL'); done({ held: up }); }, 1500);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { if (!out.includes('STOPPED TRYING')) done({ code }); });
  });
}

describe('the box with its vault files missing beside its state (L1115)', () => {
  it('stops with words, mints nothing, and stops trying on the third start', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'box-missing-vault-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(path.join(dataDir, 'registry'));   // a box's state, as a restored folder holds it

    const first = await startOnce(dataDir);
    expect(first.code, first.out.slice(-800)).toBe(1);
    expect(first.out).toMatch(/vault\.json and chat-vault\.json is missing/);
    expect(first.out).toMatch(/Failed starts in a row: 1/);
    expect(existsSync(path.join(dataDir, 'vault.json'))).toBe(false);
    expect(existsSync(path.join(dataDir, 'chat-vault.json'))).toBe(false);

    expect((await startOnce(dataDir)).out).toMatch(/Failed starts in a row: 2/);
    const third = await startOnce(dataDir);
    expect(third.out).toMatch(/STOPPED TRYING after 3 starts/);
    expect(third.held, 'the third start stays up instead of exiting').toBe(true);
    expect(JSON.parse(readFileSync(path.join(dataDir, 'start-failures.json'), 'utf8'))).toMatchObject({ count: 3 });
  }, 90_000);
});
