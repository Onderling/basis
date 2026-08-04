/**
 * Bound-mode knob (batch 7) — the `ACCEPTED_GROUPS` env reaches `startRelay` from BOTH boot entries
 * (`bin/relay.js` here; `deploy/relay/entrypoint.mjs` uses the identical block), and a value that
 * does not parse REFUSES BOOT rather than silently running open. `GroupAuthVerifier.test.js` owns
 * what bound mode DOES; this pins that an operator's knob actually turns it on.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/relay.js');

/** Boot the bin with env; resolve {code, out} when it prints the listening banner or exits. */
function boot(env, { untilBanner = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, '0'], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const done = (code) => resolve({ code, out });
    const onData = (d) => {
      out += String(d);
      if (untilBanner && /@onderling\/relay/.test(out)) { child.kill('SIGKILL'); done(null); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => done(code));
    setTimeout(() => { child.kill('SIGKILL'); done('timeout'); }, 15_000);
  });
}

describe('bin/relay.js — the ACCEPTED_GROUPS knob', () => {
  it('boots BOUND with a valid group list (port 0 = ephemeral)', async () => {
    const groups = JSON.stringify([{ groupId: 'circle-a', adminPubKey: 'pk-admin' }]);
    const r = await boot({ ACCEPTED_GROUPS: groups }, { untilBanner: true });
    expect(r.out, 'the relay must reach its banner with a bound-mode config').toMatch(/@onderling\/relay/);
    expect(r.code, 'should have been killed AFTER booting, not have exited on its own').toBeNull();
  }, 20_000);

  it('REFUSES BOOT on unparseable config — never silently open when the operator asked for bound', async () => {
    const r = await boot({ ACCEPTED_GROUPS: 'not json' });
    expect(r.code, 'a parse failure must be a boot failure').not.toBe(0);
    expect(r.code).not.toBeNull();
  }, 20_000);

  it('REFUSES a non-array (an object is a config mistake, not a group list)', async () => {
    const r = await boot({ ACCEPTED_GROUPS: '{"groupId":"x"}' });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/must be a JSON array/);
  }, 20_000);
});
