/**
 * THREE LOW FINDINGS OF THE INDEPENDENT READ (2026-11-20), two of them fixed here:
 *   • a box shorter than its authenticator: on the phone the native secretbox sized a buffer from `length - 16` (an
 *     unsigned underflow) and the port relied on the runtime turning that into a JS throw. Now such a box, or one that
 *     is not bytes, opens to nothing before any implementation sees it, and the vetting refuses an implementation that
 *     answers a short box with bytes;
 *   • the per-peer shared keys stayed in memory, unzeroed, after an identity left the device: `forgetPeerKeys` zeroes
 *     and drops them, and one the memo's bound lets go is zeroed too.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { secretboxOpen, useSecretbox, secretboxName } from '../src/crypto/secretbox.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import nacl from 'tweetnacl';

const memVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
afterEach(() => { useSecretbox(null); });

describe('a malformed box', () => {
  it('a box shorter than 16 bytes, or not bytes, opens to nothing and no implementation is asked', () => {
    let asked = 0;
    const honest = { name: 'counting', seal: (m, n, k) => nacl.secretbox(m, n, k), open: (b, n, k) => { asked += 1; return nacl.secretbox.open(b, n, k); } };
    expect(useSecretbox(honest).ok).toBe(true);
    asked = 0;
    const nonce = new Uint8Array(24); const key = new Uint8Array(32);
    expect(secretboxOpen(new Uint8Array(15), nonce, key)).toBeNull();
    expect(secretboxOpen(new Uint8Array(0), nonce, key)).toBeNull();
    expect(secretboxOpen('not bytes', nonce, key)).toBeNull();
    expect(asked, 'the implementation never saw them').toBe(0);
  });

  it('the vetting refuses an implementation that answers a short box with bytes', () => {
    const sloppy = { name: 'sloppy', seal: (m, n, k) => nacl.secretbox(m, n, k), open: (b, n, k) => (b.length < 16 ? new Uint8Array(0) : nacl.secretbox.open(b, n, k)) };
    const res = useSecretbox(sloppy);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('opens-a-short-box');
    expect(secretboxName()).toBe('tweetnacl');
  });
});

describe('the shared keys remembered with peers', () => {
  it('forgetPeerKeys zeroes the remembered key and the next use derives it again', async () => {
    const me = await AgentIdentity.generate(memVault());
    const peer = await AgentIdentity.generate(memVault());
    const handedOut = me.deriveSessionKey(peer.pubKey);   // a copy
    const { ciphertext, nonce } = me.box(new TextEncoder().encode('hallo'), peer.pubKey);
    me.forgetPeerKeys();
    // the remembered key is gone: the next derive gives the same bytes again (derived anew), and boxes still open
    expect(Buffer.from(me.deriveSessionKey(peer.pubKey)).equals(Buffer.from(handedOut))).toBe(true);
    expect(peer.unbox(ciphertext, nonce, me.pubKey)).toBeTruthy();
  });
});
