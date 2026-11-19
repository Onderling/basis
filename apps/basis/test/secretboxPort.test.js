/**
 * Secretbox behind one port (ledger L619, a phone start profile: ~1.1 s of pure-JS secretbox opening the stored records).
 *
 * The phone installs libsodium's C behind `useSecretbox`, vetted by fixed bytes; tweetnacl answers until then and on any
 * refusal or throw. These tests prove (1) the start's hot paths — the content-at-rest group-key envelopes, the tunnel
 * seal, the PFS step — reach the port, (2) the phone's implementation (exercised against `libsodium-wrappers`, the same
 * library build and API as `react-native-libsodium`'s JSI surface) passes the vetting and is byte-identical to
 * tweetnacl both ways, and (3) a throw mid-session falls back per call with the same bytes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import { useSecretbox, secretboxSeal, secretboxOpen, sealTunnelOW, openTunnelOW, AgentIdentity } from '@onderling/core';
import { sealWithGroupKey, openWithGroupKey } from '@onderling/pod-client';
import { libsodiumSecretbox, installPhoneSecretbox } from '../src/v2/signatureEquations.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// libsodium-wrappers is already in the tree (react-native-libsodium's own dependency); nothing is added
const sodiumPath = path.join(here, '..', '..', 'basis-mobile', 'node_modules', 'libsodium-wrappers');
const loadSodium = async () => { const s = createRequire(import.meta.url)(sodiumPath); await s.ready; return s; };

afterEach(() => { useSecretbox(null); vi.restoreAllMocks(); });

/** tweetnacl behind a counter, out of the spies' sight. */
function counting() {
  const seal = nacl.secretbox; const open = nacl.secretbox.open;
  const c = { seals: 0, opens: 0 };
  c.impl = { name: 'counting', seal: (m, n, k) => { c.seals += 1; return seal(m, n, k); }, open: (b, n, k) => { c.opens += 1; return open(b, n, k); } };
  return c;
}

describe('the start\'s secretbox paths reach the port', () => {
  it('the group-key envelope (every sealed local store), the tunnel seal and AgentIdentity.secretbox seal and open through it', () => {
    const c = counting();
    expect(useSecretbox(c.impl)).toMatchObject({ ok: true, name: 'counting' });
    c.seals = 0; c.opens = 0;
    const groupKey = Buffer.from(new Uint8Array(32).fill(9)).toString('base64url');
    const sealed = sealWithGroupKey('a person\'s shopping list', groupKey);
    expect(openWithGroupKey(sealed, groupKey)).toBe('a person\'s shopping list');
    const key = Buffer.from(new Uint8Array(32).fill(4)).toString('base64url');
    const t = sealTunnelOW({ key, innerOW: { hi: 1 } });
    expect(openTunnelOW({ key, ...t })).toEqual({ hi: 1 });
    const nonce = new Uint8Array(24).fill(2); const k = new Uint8Array(32).fill(3);
    expect(AgentIdentity.secretunbox(AgentIdentity.secretbox(new Uint8Array([1, 2, 3]), nonce, k), nonce, k)).toEqual(new Uint8Array([1, 2, 3]));
    expect(c.seals).toBe(3);
    expect(c.opens).toBe(3);
  });
});

describe('the phone\'s implementation (libsodium, exercised over libsodium-wrappers)', () => {
  it('passes the vetting, and what either side seals the other opens, byte for byte', async () => {
    const sodium = await loadSodium();
    const t0 = performance.now();
    expect(installPhoneSecretbox(sodium)).toMatchObject({ ok: true, name: 'libsodium-jsi' });
    console.info(`[secretbox] vetting libsodium (wasm, in node), incl. the 768 KiB message: ${(performance.now() - t0).toFixed(1)} ms`);
    const key = nacl.randomBytes(32); const nonce = nacl.randomBytes(24);
    const msg = new TextEncoder().encode('both ways, the same bytes');
    const viaPort = secretboxSeal(msg, nonce, key);
    expect(Buffer.from(viaPort).equals(Buffer.from(nacl.secretbox(msg, nonce, key)))).toBe(true);
    expect(nacl.secretbox.open(viaPort, nonce, key)).toEqual(msg);
    expect(secretboxOpen(nacl.secretbox(msg, nonce, key), nonce, key)).toEqual(msg);
    // a box that does not authenticate is null, as tweetnacl says it — never libsodium's thrown error
    const forged = Uint8Array.from(viaPort); forged[forged.length - 1] ^= 1;
    expect(secretboxOpen(forged, nonce, key)).toBeNull();
    expect(secretboxOpen(viaPort, nonce, nacl.randomBytes(32))).toBeNull();
  });

  it('a throw mid-session: that call answers by tweetnacl, the same bytes, said once', async () => {
    const sodium = await loadSodium();
    const base = libsodiumSecretbox(sodium);
    let broken = false;
    expect(useSecretbox({ ...base, name: 'flaky', seal: (m, n, k) => { if (broken) throw new Error('jsi gone'); return base.seal(m, n, k); }, open: (b, n, k) => { if (broken) throw new Error('jsi gone'); return base.open(b, n, k); } }).ok).toBe(true);
    broken = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const key = nacl.randomBytes(32); const nonce = nacl.randomBytes(24); const msg = new Uint8Array([7, 7, 7]);
    const box = secretboxSeal(msg, nonce, key);
    expect(Buffer.from(box).equals(Buffer.from(nacl.secretbox(msg, nonce, key)))).toBe(true);
    expect(secretboxOpen(box, nonce, key)).toEqual(msg);
    secretboxSeal(msg, nonce, key);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('flaky')).length).toBe(1);
  });
});
