/**
 * THE DEPLOY'S WIRE SMOKE PASSES AGAINST A REAL RELAY. The box's health gate runs `deploy/smoke/smoke.mjs` against the
 * relay's own socket after every rebuild; nothing ran it in CI, so the day its address proof named the wrong relay
 * (a `const URL` shadowed the global, and every proof said `localhost`) the first sign would have been a rolled-back
 * release on the box.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startRelay } from '../src/server.js';

const SMOKE = fileURLToPath(new URL('../../../deploy/smoke/smoke.mjs', import.meta.url));
let relay;
afterEach(async () => { await relay?.stop?.(); relay = null; });

function runSmoke(url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SMOKE, url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('the deploy smoke against a real relay', () => {
  it('registers with a proof naming the relay it dialled, and every check passes', async () => {
    relay = await startRelay({ port: 0, host: '127.0.0.1' });
    const { code, out } = await runSmoke(`ws://127.0.0.1:${relay.port}`);
    expect(out).not.toMatch(/PROOF_INVALID/);
    expect(code, out.slice(-400)).toBe(0);
  }, 60_000);
});
