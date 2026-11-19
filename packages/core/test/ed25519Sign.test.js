/**
 * Signing and key derivation behind one port (ledger L619): a shell may install a faster implementation (the phone's
 * libsodium), and the kernel takes it only if it gives tweetnacl's exact bytes. Ed25519 is deterministic, so a key
 * pair from a seed and a signature of a message have one right answer; anything else is refused and tweetnacl stays.
 */
import { describe, it, expect, afterEach } from 'vitest';
import nacl from 'tweetnacl';
import { ed25519KeyPairFromSeed, ed25519Sign, useSigningEquation, signingEquationName } from '../src/crypto/ed25519Sign.js';

afterEach(() => useSigningEquation(null));
const seed = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
const msg = new TextEncoder().encode('melk en brood');

describe('signing and key derivation behind the port', () => {
  it('by default tweetnacl answers, byte for byte', () => {
    expect(signingEquationName()).toBe('tweetnacl');
    const kp = ed25519KeyPairFromSeed(seed);
    const ref = nacl.sign.keyPair.fromSeed(seed);
    expect([...kp.publicKey]).toEqual([...ref.publicKey]);
    expect([...kp.secretKey]).toEqual([...ref.secretKey]);
    expect([...ed25519Sign(msg, kp.secretKey)]).toEqual([...nacl.sign.detached(msg, ref.secretKey)]);
  });

  it('an implementation that agrees is taken, and then answers', () => {
    let calls = 0;
    const r = useSigningEquation({
      name: 'agreeing',
      keyPairFromSeed: (s) => { calls += 1; return nacl.sign.keyPair.fromSeed(s); },
      sign: (m, sk) => { calls += 1; return nacl.sign.detached(m, sk); },
    });
    expect(r).toMatchObject({ ok: true, name: 'agreeing' });
    const before = calls;
    ed25519Sign(msg, ed25519KeyPairFromSeed(seed).secretKey);
    expect(calls - before).toBe(2);
    expect(signingEquationName()).toBe('agreeing');
  });

  it('one that gives other bytes is refused, and tweetnacl stays', () => {
    const wrongSig = useSigningEquation({
      name: 'wrong-signature', keyPairFromSeed: (s) => nacl.sign.keyPair.fromSeed(s),
      sign: (m, sk) => { const s = nacl.sign.detached(m, sk); s[0] ^= 1; return s; },
    });
    expect(wrongSig).toMatchObject({ ok: false, reason: 'signature-disagrees' });
    const wrongKey = useSigningEquation({
      name: 'wrong-key', keyPairFromSeed: (s) => { const k = nacl.sign.keyPair.fromSeed(s); k.publicKey[1] ^= 1; return k; },
      sign: (m, sk) => nacl.sign.detached(m, sk),
    });
    expect(wrongKey).toMatchObject({ ok: false, reason: 'key-pair-disagrees' });
    const throws = useSigningEquation({ name: 'throws', keyPairFromSeed: () => { throw new Error('x'); }, sign: () => new Uint8Array(64) });
    expect(throws.ok).toBe(false);
    expect(useSigningEquation({ name: 'half' }).ok).toBe(false);
    expect(signingEquationName()).toBe('tweetnacl');
  });
});
