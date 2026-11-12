/**
 * ONE STRICT RULE FOR A VALID SIGNATURE: the 12 published edge-case vectors, an independent big-integer oracle for the
 * small-order list, honest signatures, and the same answer from two different libraries behind the rule.
 *
 * Vectors: ed25519-speccheck ("Taming the many EdDSAs", Chalkias, Garillot, Nikolaenko 2020), fetched 2026-11-12,
 * [message, public key, signature] in hex. With the rule, tweetnacl, node:crypto, WebCrypto and libsodium all accept
 * exactly case 3 (mixed order, valid under both equations) and refuse the other eleven; bare tweetnacl, what every
 * device ran until now, accepted 0, 1, 2, 3, 6, 7 and 11.
 */
import { describe, it, expect } from 'vitest';
import { createPublicKey, verify as nodeVerify } from 'node:crypto';
import nacl from 'tweetnacl';
import { VaultMemory } from '@onderling/vault';
import { strictSignatureShapeOk, verifyEd25519Strict, ED25519_RULE } from '../src/crypto/ed25519Strict.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { encode as b64encode } from '../src/crypto/b64.js';
import { ED25519_EDGE_VECTORS, ED25519_ACCEPTED, ed25519Disagreements } from '../src/conformance/ed25519Conformance.js';

const CASES = ED25519_EDGE_VECTORS;
const hex = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
const ACCEPTED = [...ED25519_ACCEPTED];

// ── an independent big-integer oracle (test only: slow, plain, from the curve's definition) ──────────────────────
const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const mod = (a) => ((a % P) + P) % P;
const pow = (b, e) => { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; } return r; };
const inv = (a) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);
const leToBig = (b) => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);
const bigToLe = (n) => { const out = new Uint8Array(32); for (let i = 0; i < 32; i += 1) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; };
function decodePoint(bytes) {
  const raw = leToBig(bytes); const sign = raw >> 255n; const y = mod(raw & ((1n << 255n) - 1n));
  const u = mod(y * y - 1n); const v = mod(D * y * y + 1n);
  let x = mod(u * pow(v, 3n) * pow(u * pow(v, 7n), (P - 5n) / 8n));
  if (mod(v * x * x) !== u) { if (mod(v * x * x) === mod(-u)) x = mod(x * SQRT_M1); else return null; }
  if ((x & 1n) !== sign) x = mod(-x);
  return { x, y };
}
const encode = ({ x, y }) => { const e = bigToLe(y); if (x & 1n) e[31] |= 0x80; return e; };
const add = (a, b) => { const t = mod(D * a.x * b.x * a.y * b.y); return { x: mod((a.x * b.y + b.x * a.y) * inv(1n + t)), y: mod((a.y * b.y + a.x * b.x) * inv(1n - t)) }; };
const isIdentity = (p) => p.x === 0n && p.y === 1n;
const timesEight = (p) => { let q = p; for (let i = 0; i < 3; i += 1) q = add(q, q); return q; };

const spki = (raw) => createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw)]), format: 'der', type: 'spki' });
const nodeCheck = (m, s, k) => { try { return nodeVerify(null, m, spki(k), s); } catch { return false; } };

describe('the strict signature rule', () => {
  it('names its rule set', () => { expect(ED25519_RULE).toBe('ed25519-strict-1'); });

  it('the conformance set reports no disagreement for the platform check', () => {
    expect(ed25519Disagreements(verifyEd25519Strict)).toEqual([]);
  });

  it('accepts exactly the vectors every library accepts under the rule', () => {
    const got = CASES.map(([m, k, s], i) => (verifyEd25519Strict(hex(m), hex(s), hex(k)) ? i : -1)).filter((i) => i >= 0);
    expect(got).toEqual(ACCEPTED);
  });

  it('gives the same answer with node:crypto behind it (the rule, not the library, decides)', () => {
    const got = CASES.map(([m, k, s], i) => (strictSignatureShapeOk(hex(s), hex(k)) && nodeCheck(hex(m), hex(s), hex(k)) ? i : -1)).filter((i) => i >= 0);
    expect(got).toEqual(ACCEPTED);
  });

  it('AgentIdentity.verify, the platform check, follows the rule', () => {
    const got = CASES.map(([m, k, s], i) => (AgentIdentity.verify(hex(m), b64encode(hex(s)), b64encode(hex(k))) ? i : -1)).filter((i) => i >= 0);
    expect(got).toEqual(ACCEPTED);
  });

  it('refuses every encoding of every small-order point (derived by the oracle, both sign bits) as R or as the key', () => {
    // the eight small-order points: the multiples of one point of order 8 (the c717… encoding)
    const t = decodePoint(hex('c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a'));
    expect(t && isIdentity(timesEight(t)), 'the generator is of small order').toBe(true);
    const points = []; let q = t;
    for (let i = 0; i < 8; i += 1) { points.push(q); q = add(q, t); }
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(8);
    const honest = nacl.sign.keyPair();
    const zeroS = new Uint8Array(32);
    for (const p of points) {
      for (const flip of [0, 0x80]) {
        const e = encode(p); e[31] ^= flip;
        expect(strictSignatureShapeOk(new Uint8Array([...e, ...zeroS]), honest.publicKey), `R small order ${Buffer.from(e).toString('hex')}`).toBe(false);
        expect(strictSignatureShapeOk(new Uint8Array([...honest.publicKey, ...zeroS]), e), `key small order ${Buffer.from(e).toString('hex')}`).toBe(false);
      }
    }
  });

  it('refuses a non-canonical point (y >= p) and a non-canonical scalar (S >= L)', () => {
    const kp = nacl.sign.keyPair(); const m = nacl.randomBytes(48); const sig = nacl.sign.detached(m, kp.secretKey);
    expect(verifyEd25519Strict(m, sig, kp.publicKey)).toBe(true);
    const sPlusL = bigToLe(leToBig(sig.subarray(32)) + L);
    const malleable = new Uint8Array([...sig.subarray(0, 32), ...sPlusL]);
    expect(nacl.sign.detached.verify(m, malleable, kp.publicKey), 'bare tweetnacl accepts S + L').toBe(true);
    expect(verifyEd25519Strict(m, malleable, kp.publicKey)).toBe(false);
    const yIsP = bigToLe(P);   // y = p: a non-canonical encoding of y = 0
    expect(strictSignatureShapeOk(new Uint8Array([...yIsP, ...sig.subarray(32)]), kp.publicKey)).toBe(false);
  });

  it('passes every honest signature (200 from tweetnacl, 50 through AgentIdentity)', async () => {
    for (let i = 0; i < 200; i += 1) {
      const kp = nacl.sign.keyPair(); const m = nacl.randomBytes(1 + (i % 200));
      expect(verifyEd25519Strict(m, nacl.sign.detached(m, kp.secretKey), kp.publicKey)).toBe(true);
    }
    for (let i = 0; i < 50; i += 1) {
      const id = await AgentIdentity.generate(new VaultMemory());
      const msg = `statement ${i}`;
      expect(AgentIdentity.verify(msg, id.sign(msg), id.pubKey)).toBe(true);
    }
  });
});
