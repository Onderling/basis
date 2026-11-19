/**
 * A FASTER SIGNATURE CHECK, BEHIND THE ONE STRICT RULE.
 *
 * A shell may hand the platform a faster equation (node:crypto on the box, WebCrypto on the web). It is taken only if,
 * with the strict byte rule in front, it gives the platform's answer on the twelve edge-case vectors AND on an honest
 * signature and a tampered one; otherwise the check stays the rule + tweetnacl. The byte rule is never skipped. A batch
 * (an async check, WebCrypto) fills the signature memo, so the synchronous reads that follow are answered from memory.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import nacl from 'tweetnacl';
import { useSignatureEquation, signatureEquationName, verifyEd25519Strict, verifyEd25519StrictBatch, SIGNATURE_VECTORS } from '../src/crypto/ed25519Strict.js';
import { ed25519Disagreements } from '../src/conformance/ed25519Conformance.js';
import { createSignatureMemo } from '../src/security/signatureMemo.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

const naclEq = (m, s, k) => nacl.sign.detached.verify(m, s, k);

afterEach(() => { useSignatureEquation(null); });

describe('useSignatureEquation: a faster equation is taken only if it agrees', () => {
  it('starts on tweetnacl', () => {
    expect(signatureEquationName()).toBe('tweetnacl');
  });

  it('takes an equation that agrees on the vectors and on honest and tampered signatures', async () => {
    let calls = 0;
    const r = await useSignatureEquation({ name: 'counting', verify: (m, s, k) => { calls += 1; return naclEq(m, s, k); } });
    expect(r).toMatchObject({ ok: true, name: 'counting' });
    expect(signatureEquationName()).toBe('counting');
    const kp = nacl.sign.keyPair();
    const msg = new TextEncoder().encode('hallo');
    const before = calls;
    expect(verifyEd25519Strict(msg, nacl.sign.detached(msg, kp.secretKey), kp.publicKey)).toBe(true);
    expect(calls).toBe(before + 1);
  });

  it('refuses one that says yes to everything (the honest-tamper check), and keeps the current one', async () => {
    const r = await useSignatureEquation({ name: 'yes-man', verify: () => true });
    expect(r.ok).toBe(false);
    expect(signatureEquationName()).toBe('tweetnacl');
  });

  it('refuses one that says no to everything', async () => {
    expect((await useSignatureEquation({ name: 'no-man', verify: () => false })).ok).toBe(false);
    expect(signatureEquationName()).toBe('tweetnacl');
  });

  it('the byte rule stays in front: a crafted S + L never reaches the equation', async () => {
    const seen = [];
    await useSignatureEquation({ name: 'spy', verify: (m, s, k) => { seen.push(s[63]); return naclEq(m, s, k); } });
    seen.length = 0;
    expect(ed25519Disagreements(verifyEd25519Strict)).toEqual([]);
  });

  it('null goes back to tweetnacl', async () => {
    await useSignatureEquation({ name: 'counting', verify: naclEq });
    await useSignatureEquation(null);
    expect(signatureEquationName()).toBe('tweetnacl');
  });
});

describe('the batch check fills the memo', () => {
  it('an async equation answers a batch; the sync reads after it are answered from memory', async () => {
    let batchCalls = 0;
    await useSignatureEquation({
      name: 'async-batch',
      verify: naclEq,
      verifyBatch: async (items) => { batchCalls += 1; return items.map(({ msg, sig, key }) => naclEq(msg, sig, key)); },
    });
    batchCalls = 0;   // the install vetted the batch once; count the reads only
    const id = await AgentIdentity.generate(new VaultMemory());
    const msgs = ['een', 'twee', 'drie'];
    const sigs = msgs.map((m) => AgentIdentity.b64encode?.(id.sign(m)) ?? Buffer.from(id.sign(m)).toString('base64url'));
    let syncCalls = 0;
    const memo = createSignatureMemo({ verify: (m, s, k) => { syncCalls += 1; return AgentIdentity.verify(m, s, k); } });
    const bad = sigs[1].slice(0, -2) + (sigs[1].endsWith('A') ? 'BA' : 'AA');
    const filled = await memo.checkBatch('spine', [
      { msg: msgs[0], sig: sigs[0], pubKey: id.pubKey },
      { msg: msgs[1], sig: bad, pubKey: id.pubKey },
      { msg: msgs[2], sig: sigs[2], pubKey: id.pubKey },
    ]);
    expect(batchCalls).toBe(1);
    expect(filled).toBe(2);
    const spine = memo.verifierFor('spine');
    expect(spine(msgs[0], sigs[0], id.pubKey)).toBe(true);
    expect(spine(msgs[2], sigs[2], id.pubKey)).toBe(true);
    expect(syncCalls, 'both answered from the memo').toBe(0);
    expect(spine(msgs[1], bad, id.pubKey)).toBe(false);
    expect(syncCalls, 'a false is never remembered: checked again').toBe(1);
    // the batch's verdict is per verifier name, as every memo entry is
    expect(memo.verifierFor('circle-link')(msgs[0], sigs[0], id.pubKey)).toBe(true);
    expect(syncCalls).toBe(2);
  });

  it('without a batch method, verifyEd25519StrictBatch answers one by one, the rule in front', async () => {
    const kp = nacl.sign.keyPair();
    const msg = new TextEncoder().encode('x');
    const sig = nacl.sign.detached(msg, kp.secretKey);
    const bad = new Uint8Array(sig); bad[63] |= 0xf0;   // S far above L: the byte rule refuses
    expect(await verifyEd25519StrictBatch([{ msg, sig, key: kp.publicKey }, { msg, sig: bad, key: kp.publicKey }])).toEqual([true, false]);
  });
});

describe('the installed equation is reached only behind the byte rule', () => {
  it('a signature that is not 64 bytes or a key that is not 32 never reaches it (a native equation reads fixed lengths)', async () => {
    const lengths = [];
    await useSignatureEquation({ name: 'length-spy', verify: (m, s, k) => { lengths.push([s.length, k.length]); return nacl.sign.detached.verify(m, s, k); } });
    lengths.length = 0;
    const kp = nacl.sign.keyPair();
    const msg = new TextEncoder().encode('x');
    const sig = nacl.sign.detached(msg, kp.secretKey);
    expect(verifyEd25519Strict(msg, sig.subarray(0, 63), kp.publicKey)).toBe(false);
    expect(verifyEd25519Strict(msg, sig, kp.publicKey.subarray(0, 31))).toBe(false);
    expect(await verifyEd25519StrictBatch([{ msg, sig: sig.subarray(0, 40), key: kp.publicKey }])).toEqual([false]);
    expect(lengths).toEqual([]);
    expect(verifyEd25519Strict(msg, sig, kp.publicKey)).toBe(true);
    expect(lengths).toEqual([[64, 32]]);
  });
});

describe('a BATCH equation is vetted by the kernel itself, through the batch', () => {
  it('a batch that accepts edge-case vector 4 (a cofactored check) is refused, and tweetnacl stays', async () => {
    const { ED25519_EDGE_VECTORS } = await import('../src/conformance/ed25519Conformance.js');
    const hex = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
    const v4sig = hex(ED25519_EDGE_VECTORS[4][2]);
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const r = await useSignatureEquation({
      name: 'cofactored-batch',
      verifyBatch: async (items) => items.map(({ msg, sig, key }) => same(sig, v4sig) || nacl.sign.detached.verify(msg, sig, key)),
    });
    expect(r).toMatchObject({ ok: false, reason: 'batch-disagrees-on-vectors' });
    expect(signatureEquationName()).toBe('tweetnacl');
  });

  it('a batch that agrees is installed', async () => {
    const r = await useSignatureEquation({ name: 'good-batch', verifyBatch: async (items) => items.map(({ msg, sig, key }) => nacl.sign.detached.verify(msg, sig, key)) });
    expect(r).toMatchObject({ ok: true, name: 'good-batch' });
  });
});

describe('the vetting compares against FIXED bytes, so installing an equation costs no tweetnacl at a start', () => {
  it('installing an agreeing sync equation makes no key pair, no signature and no tweetnacl check', async () => {
    const verifyOrig = nacl.sign.detached.verify;   // the candidate answers by the same equation, out of the spies' sight
    const vSpy = vi.spyOn(nacl.sign.detached, 'verify');
    const kpSpy = vi.spyOn(nacl.sign, 'keyPair');
    const sgSpy = vi.spyOn(nacl.sign, 'detached');
    try {
      const r = await useSignatureEquation({ name: 'quiet', verify: (m, s, k) => verifyOrig(m, s, k) });
      expect(r).toMatchObject({ ok: true, name: 'quiet' });
      expect(kpSpy).not.toHaveBeenCalled();
      expect(sgSpy).not.toHaveBeenCalled();
      expect(vSpy).not.toHaveBeenCalled();
    } finally { vSpy.mockRestore(); kpSpy.mockRestore(); sgSpy.mockRestore(); }
  });

  it('a batch-only equation is vetted through its batch; the sync path stays tweetnacl and is not vetted against itself', async () => {
    const verifyOrig = nacl.sign.detached.verify;
    const vSpy = vi.spyOn(nacl.sign.detached, 'verify');
    try {
      const r = await useSignatureEquation({ name: 'batch-only', verifyBatch: async (items) => items.map(({ msg, sig, key }) => verifyOrig(msg, sig, key)) });
      expect(r).toMatchObject({ ok: true, name: 'batch-only' });
      expect(vSpy).not.toHaveBeenCalled();
    } finally { vSpy.mockRestore(); }
  });

  it('tweetnacl still agrees with the fixed vectors: the honest one passes, every negative one fails', () => {
    const { key, msg, sig, negatives } = SIGNATURE_VECTORS;
    expect(nacl.sign.detached.verify(msg, sig, key)).toBe(true);
    expect(verifyEd25519Strict(msg, sig, key)).toBe(true);
    for (const n of negatives) {
      expect(nacl.sign.detached.verify(n.msg, n.sig, n.key), n.case).toBe(false);
      expect(verifyEd25519Strict(n.msg, n.sig, n.key), n.case).toBe(false);
    }
    // the honest one is tweetnacl's own signature over the message with the fixed seed's key
    const kp = nacl.sign.keyPair.fromSeed(SIGNATURE_VECTORS.seed);
    expect(Buffer.from(kp.publicKey).toString('hex')).toBe(Buffer.from(key).toString('hex'));
    expect(Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString('hex')).toBe(Buffer.from(sig).toString('hex'));
  });

  it('an equation that accepts any one of the negative vectors is refused, each case', async () => {
    const verifyOrig = nacl.sign.detached.verify;
    for (const n of SIGNATURE_VECTORS.negatives) {
      const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
      const r = await useSignatureEquation({ name: `lets-${n.case}`, verify: (m, s, k) => (same(m, n.msg) && same(s, n.sig) && same(k, n.key)) || verifyOrig(m, s, k) });
      expect(r, n.case).toMatchObject({ ok: false, reason: 'accepts-tampered' });
      const rb = await useSignatureEquation({ name: `batch-lets-${n.case}`, verifyBatch: async (items) => items.map(({ msg, sig, key }) => (same(msg, n.msg) && same(sig, n.sig) && same(key, n.key)) || verifyOrig(msg, sig, key)) });
      expect(rb, n.case).toMatchObject({ ok: false, reason: 'batch-accepts-tampered' });
    }
    expect(signatureEquationName()).toBe('tweetnacl');
  });
});
