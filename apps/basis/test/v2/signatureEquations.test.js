/**
 * The box's and the web's faster signature equations, against the platform's strict rule.
 */
import { describe, it, expect, afterEach } from 'vitest';
import nodeCrypto from 'node:crypto';
import nacl from 'tweetnacl';
import { useSignatureEquation, signatureEquationName, verifyEd25519StrictBatch, AgentIdentity } from '@onderling/core';
import { ed25519Disagreements } from '@onderling/core/conformance';
import { nodeCryptoEquation, webCryptoEquation, webCryptoBatchAgrees, installBoxSignatureEquation, installWebSignatureEquation } from '../../src/v2/signatureEquations.js';

afterEach(() => { useSignatureEquation(null); });

describe('the box: node:crypto behind the rule', () => {
  it('is taken, agrees on the vectors, and answers honest and tampered signatures as tweetnacl does', () => {
    expect(installBoxSignatureEquation(nodeCrypto)).toMatchObject({ ok: true, name: 'node-crypto' });
    expect(signatureEquationName()).toBe('node-crypto');
    const eq = nodeCryptoEquation(nodeCrypto);
    for (let i = 0; i < 20; i += 1) {
      const kp = nacl.sign.keyPair();
      const msg = nacl.randomBytes(1 + i * 7);
      const sig = nacl.sign.detached(msg, kp.secretKey);
      expect(eq.verify(msg, sig, kp.publicKey)).toBe(true);
      const t = new Uint8Array(sig); t[i % 32] ^= 1;
      expect(eq.verify(msg, t, kp.publicKey)).toBe(nacl.sign.detached.verify(msg, t, kp.publicKey));
    }
    expect(ed25519Disagreements((m, s, k) => AgentIdentity.verify(m, s, Buffer.from(k).toString('base64url')))).toEqual([]);
  });

  it('is faster than tweetnacl (the reason it exists)', () => {
    const kp = nacl.sign.keyPair();
    const msg = nacl.randomBytes(200);
    const sig = nacl.sign.detached(msg, kp.secretKey);
    const eq = nodeCryptoEquation(nodeCrypto);
    eq.verify(msg, sig, kp.publicKey);
    const time = (f) => { const t = performance.now(); for (let i = 0; i < 50; i += 1) f(); return performance.now() - t; };
    const fast = time(() => eq.verify(msg, sig, kp.publicKey));
    const slow = time(() => nacl.sign.detached.verify(msg, sig, kp.publicKey));
    expect(fast).toBeLessThan(slow);
  });
});

describe('the web: WebCrypto batch behind the rule', () => {
  const subtle = globalThis.crypto?.subtle;

  it('the batch self-test passes where WebCrypto has Ed25519, and the batch answers like the rule', async () => {
    expect(await webCryptoBatchAgrees(subtle)).toBe(true);
    expect(await installWebSignatureEquation(subtle)).toMatchObject({ ok: true, name: 'webcrypto-batch' });
    const items = [];
    for (let i = 0; i < 130; i += 1) {
      const kp = nacl.sign.keyPair();
      const msg = nacl.randomBytes(40);
      const sig = nacl.sign.detached(msg, kp.secretKey);
      if (i % 3 === 0) sig[5] ^= 1;
      items.push({ msg, sig, key: kp.publicKey, want: nacl.sign.detached.verify(msg, sig, kp.publicKey) });
    }
    expect(await verifyEd25519StrictBatch(items)).toEqual(items.map((x) => x.want));
  });

  it('no WebCrypto (or no Ed25519 in it): tweetnacl stays', async () => {
    expect(await installWebSignatureEquation(null)).toMatchObject({ ok: false });
    const broken = { importKey: async () => { throw new Error('Ed25519 not supported'); }, verify: async () => false };
    expect(await installWebSignatureEquation(broken)).toMatchObject({ ok: false });
    expect(signatureEquationName()).toBe('tweetnacl');
  });

  it('chunks: a long batch gives the thread back between chunks', async () => {
    let yields = 0;
    const eq = webCryptoEquation(subtle, { yieldToThread: async () => { yields += 1; } });
    const kp = nacl.sign.keyPair();
    const msg = nacl.randomBytes(10);
    const sig = nacl.sign.detached(msg, kp.secretKey);
    const r = await eq.verifyBatch(Array.from({ length: 200 }, () => ({ msg, sig, key: kp.publicKey })));
    expect(r.every(Boolean)).toBe(true);
    expect(yields).toBe(3);
  });
});
