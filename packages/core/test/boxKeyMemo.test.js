/**
 * Per peer, the converted key and the shared key are remembered for the session (ledger L619, a phone start profile).
 *
 * Every `box`/`unbox` converted the peer's Ed25519 public key to its Curve25519 key again (`convertPublicKey`) and
 * derived the shared key again (`nacl.box.before`), in pure JS; a start's greeting burst spent ~2.9 s there. Now the
 * conversion is remembered per public key (public data) and the shared key per identity and peer key (in memory, on
 * the identity, bounded); the bytes on the wire are identical, and a different key — a peer's rotation — simply misses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import nacl from 'tweetnacl';

const counts = vi.hoisted(() => ({ pub: 0, pair: 0 }));
vi.mock('ed2curve', async (importOriginal) => {
  const real = (await importOriginal()).default ?? (await importOriginal());
  const wrapped = {
    ...real,
    convertPublicKey: (...a) => { counts.pub += 1; return real.convertPublicKey(...a); },
    convertKeyPair: (...a) => { counts.pair += 1; return real.convertKeyPair(...a); },
  };
  return { default: wrapped, ...wrapped };
});

const realEd2curve = (await vi.importActual('ed2curve')).default;
const { AgentIdentity } = await import('../src/identity/AgentIdentity.js');
const { b64encode } = await import('../src/index.js');

const seedOf = (k) => Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + k) & 0xff);
const { VaultMemory } = await import('@onderling/vault');
const idOf = (k) => AgentIdentity.fromSeed(seedOf(k), new VaultMemory());

beforeEach(() => { counts.pub = 0; counts.pair = 0; });

describe('the box keys are remembered per peer', () => {
  it('K sends to one peer: one conversion of its key and one shared-key derivation, not K', async () => {
    const me = await idOf(1);
    const peer = await idOf(2);
    const before = vi.spyOn(nacl.box, 'before');
    counts.pub = 0;
    const K = 12;
    try {
      for (let i = 0; i < K; i += 1) me.box(new TextEncoder().encode(`hello ${i}`), peer.pubKey);
      expect(counts.pub).toBeLessThanOrEqual(1);
      expect(before).toHaveBeenCalledTimes(1);
    } finally { before.mockRestore(); }
  });

  it('receiving from that peer reuses the same shared key: unbox derives nothing again', async () => {
    const me = await idOf(3);
    const peer = await idOf(4);
    const boxed = [0, 1, 2, 3].map((i) => peer.box(new TextEncoder().encode(`m${i}`), me.pubKey));
    const before = vi.spyOn(nacl.box, 'before');
    try {
      for (const b of boxed) expect(me.unbox(b.ciphertext, b.nonce, peer.pubKey)).not.toBeNull();
      expect(before).toHaveBeenCalledTimes(1);
      me.box(new TextEncoder().encode('reply'), peer.pubKey);
      expect(before).toHaveBeenCalledTimes(1);   // the same pair of keys: the same shared key
    } finally { before.mockRestore(); }
  });

  it('the bytes on the wire are identical to a plain nacl.box with the same nonce', async () => {
    const me = await idOf(5);
    const peer = await idOf(6);
    const nonce = Uint8Array.from({ length: 24 }, (_, i) => i);
    const msg = new TextEncoder().encode('the same bytes, every time');
    const rnd = vi.spyOn(nacl, 'randomBytes').mockImplementation((n) => (n === 24 ? Uint8Array.from(nonce) : new Uint8Array(n)));
    let first; let second;
    try { first = me.box(msg, peer.pubKey); second = me.box(msg, peer.pubKey); } finally { rnd.mockRestore(); }
    const mySecret = realEd2curve.convertKeyPair(nacl.sign.keyPair.fromSeed(seedOf(5))).secretKey;
    const peerCurve = realEd2curve.convertPublicKey(nacl.sign.keyPair.fromSeed(seedOf(6)).publicKey);
    const reference = nacl.box(msg, nonce, peerCurve, mySecret);
    expect(b64encode(first.ciphertext)).toBe(b64encode(reference));
    expect(b64encode(second.ciphertext)).toBe(b64encode(reference));   // the second came from the memo
    // and it opens both ways: the peer opens mine, I open the peer's
    expect(new TextDecoder().decode(peer.unbox(first.ciphertext, first.nonce, me.pubKey))).toBe('the same bytes, every time');
    const back = peer.box(new TextEncoder().encode('and back'), me.pubKey);
    expect(new TextDecoder().decode(me.unbox(back.ciphertext, back.nonce, peer.pubKey))).toBe('and back');
  });

  it('a different key misses the memo: another peer (or a rotated key) gets its own shared key, never this one', async () => {
    const me = await idOf(7);
    const a = await idOf(8);
    const b = await idOf(9);
    me.box(new TextEncoder().encode('x'), a.pubKey);
    const boxedForB = me.box(new TextEncoder().encode('for b'), b.pubKey);
    expect(a.unbox(boxedForB.ciphertext, boxedForB.nonce, me.pubKey)).toBeNull();
    expect(new TextDecoder().decode(b.unbox(boxedForB.ciphertext, boxedForB.nonce, me.pubKey))).toBe('for b');
    // two identities never share an entry: b's shared key with a is not mine with a
    const fromB = b.box(new TextEncoder().encode('b to a'), a.pubKey);
    expect(me.unbox(fromB.ciphertext, fromB.nonce, a.pubKey)).toBeNull();
  });

  it('an identity that never boxes never converts its own key pair', async () => {
    counts.pair = 0;
    const quiet = await idOf(10);
    quiet.sign('only signing');
    expect(counts.pair).toBe(0);
  });
});
