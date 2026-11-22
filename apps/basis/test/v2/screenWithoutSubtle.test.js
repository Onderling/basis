/**
 * A TOOLBOX PAGE ON PLAIN HTTP RUNS WITHOUT crypto.subtle (ledger L1183, Fable's correction 2026-11-22). A browser gives
 * `crypto.subtle` only to https and loopback pages, so a page served over http in the home network has none; the
 * screen door's code (`sha256Hex`) used `subtle.digest` and pairing threw there. The hash is now pure JavaScript.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('the screen code without crypto.subtle', () => {
  it('sha256Hex answers the same hash with no subtle in the page', async () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a) => real.getRandomValues(a) });   // what an http page has
    const { sha256Hex } = await import('../../src/v2/botAdmission.js');
    const s = 'viewkey|nonce-123 ü';
    expect(await sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});
