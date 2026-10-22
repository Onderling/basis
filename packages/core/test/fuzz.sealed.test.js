/**
 * FUZZ: what a peer hands us sealed or signed. A deterministic, seeded mutator (the same cases every run, so a red is
 * reproducible) throws malformed, truncated, bit-flipped and oversized input at the openers and verifiers that read
 * another device's bytes. Three properties:
 *   - an OPENER never opens a mutated box (it returns null or throws an Error — never plaintext, never a non-Error);
 *   - a VERIFIER never accepts a statement with any field changed;
 *   - a DECODER returns or throws an Error on any input, and never hangs.
 * A mutation that decodes to the SAME bytes (base64url's unused trailing bits) is not a mutation and is skipped.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { packSealed, openSealed, SEALED_VERSION } from '../src/security/sealedForward.js';
import { InternalBus, InternalTransport } from '../src/index.js';
import { sealTunnelOW, openTunnelOW, generateTunnelKey } from '../src/security/tunnelSeal.js';
import { signOrigin } from '../src/security/originSignature.js';
import { signEviction, verifyEviction } from '../src/security/evictionStatement.js';
import { encode as b64encode, decode as b64decode } from '../src/crypto/b64.js';
import { TextPart } from '../src/Parts.js';
import { openFromPersonKey, derivePersonKeySeed, personKeyPubKeyB64 } from '../src/identity/personKey.js';
import { CapabilityToken } from '../src/permissions/CapabilityToken.js';
import { PodCapabilityToken } from '../src/permissions/PodCapabilityToken.js';
import { Agent } from '../src/Agent.js';
import nacl from 'tweetnacl';

const CASES = 400;

/** mulberry32: a small seeded PRNG, so every run throws the same cases. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ODD = ['', '=', '==', '+', '/', ' ', '\n', '\u0000', 'é', '\u{1F600}', '%', '.', '"', '{}', 'null'];

/** One mutation of a string: flip, insert, delete, truncate, duplicate, an odd character, or a much longer string. */
function mutate(s, r) {
  const i = Math.floor(r() * (s.length + 1));
  const ch = () => (r() < 0.8 ? B64[Math.floor(r() * B64.length)] : ODD[Math.floor(r() * ODD.length)]);
  switch (Math.floor(r() * 8)) {
    case 0: return s.slice(0, i) + ch() + s.slice(i + 1);              // replace one
    case 1: return s.slice(0, i) + ch() + s.slice(i);                  // insert one
    case 2: return s.slice(0, i) + s.slice(i + 1);                     // delete one
    case 3: return s.slice(0, i);                                       // truncate
    case 4: return s + s.slice(0, Math.max(1, i));                     // grow
    case 5: return ODD[Math.floor(r() * ODD.length)];                  // something else entirely
    case 6: return s.repeat(1 + Math.floor(r() * 50));                 // much longer
    default: { const a = [...s]; const j = Math.floor(r() * a.length); const k = Math.floor(r() * a.length); [a[j], a[k]] = [a[k], a[j]]; return a.join(''); }   // swap two
  }
}
const sameBytes = (a, b) => { try { const x = b64decode(a); const y = b64decode(b); return x.length === y.length && x.every((v, i) => v === y[i]); } catch { return false; } };

/** Run `fn`; the outcome is 'value' (with it), 'null', or 'error'. A throw that is not an Error is a failure. */
function outcome(fn) {
  try {
    const v = fn();
    if (v && typeof v.then === 'function') throw new Error('sync expected');
    return v == null ? { kind: 'null' } : { kind: 'value', v };
  } catch (e) {
    if (!(e instanceof Error)) throw new Error(`threw a non-Error: ${String(e)}`);
    return { kind: 'error' };
  }
}

describe('fuzz: openers never open a mutated box', () => {
  it('openSealed: a mutated seal, nonce or sender never opens', async () => {
    const alice = await AgentIdentity.generate(new VaultMemory());
    const carol = await AgentIdentity.generate(new VaultMemory());
    const parts = [TextPart('hallo')];
    const { sig, originTs } = signOrigin(alice, { target: carol.pubKey, skill: 'receive-message', parts });
    const box = packSealed({ identity: alice, recipientPubKey: carol.pubKey, skill: 'receive-message', parts, origin: alice.pubKey, originSig: sig, originTs });
    expect(openSealed({ identity: carol, ...box, senderPubKey: alice.pubKey }).skill).toBe('receive-message');
    const r = rng(1);
    let tried = 0;
    for (let n = 0; n < CASES; n++) {
      const field = ['sealed', 'nonce', 'senderPubKey'][n % 3];
      const orig = field === 'senderPubKey' ? alice.pubKey : box[field];
      const m = mutate(orig, r);
      if (m === orig || sameBytes(m, orig)) continue;
      tried++;
      const args = { identity: carol, sealed: box.sealed, nonce: box.nonce, senderPubKey: alice.pubKey, [field]: m };
      const o = outcome(() => openSealed(args));
      expect(o.kind, `${field} mutated (case ${n}) opened`).not.toBe('value');
    }
    expect(tried).toBeGreaterThan(CASES * 0.8);
  });

  it('openTunnelOW: a mutated key, seal or nonce never opens', () => {
    const key = generateTunnelKey();
    const box = sealTunnelOW({ key, innerOW: { skill: 'x', parts: [] } });
    expect(openTunnelOW({ key, ...box })).toMatchObject({ skill: 'x' });
    const r = rng(2);
    for (let n = 0; n < CASES; n++) {
      const field = ['key', 'sealed', 'nonce'][n % 3];
      const orig = field === 'key' ? key : box[field];
      const m = mutate(orig, r);
      if (m === orig || sameBytes(m, orig)) continue;
      const o = outcome(() => openTunnelOW({ key, ...box, [field]: m }));
      expect(o.kind, `${field} mutated (case ${n}) opened`).not.toBe('value');
    }
  });
});

describe('fuzz: a verifier never accepts a changed statement', () => {
  it('verifyEviction: any string field of the body, or the signature, changed → not ok', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const st = signEviction(admin, { circleId: 'circle-1', evicted: 'member-x' });
    expect(verifyEviction(st, { expectedCircleId: 'circle-1' }).ok).toBe(true);
    const r = rng(3);
    const fields = ['sig', ...Object.keys(st.body).filter((k) => typeof st.body[k] === 'string')];
    for (let n = 0; n < CASES; n++) {
      const f = fields[n % fields.length];
      const orig = f === 'sig' ? st.sig : st.body[f];
      const m = mutate(orig, r);
      if (m === orig || (f === 'sig' && sameBytes(m, orig))) continue;
      const changed = f === 'sig' ? { ...st, sig: m } : { ...st, body: { ...st.body, [f]: m } };
      const o = outcome(() => verifyEviction(changed, { expectedCircleId: 'circle-1' }));
      expect(o.kind === 'value' && o.v.ok === true, `${f} mutated (case ${n}) verified`).toBe(false);
    }
  });
});

describe('fuzz: decoders return or throw an Error, on anything', () => {
  it('base64url decode', () => {
    const r = rng(4);
    const seed = b64encode(new Uint8Array(48).map((_, i) => i * 7));
    for (let n = 0; n < CASES; n++) outcome(() => b64decode(mutate(seed, r)));
  });
});

/** A body that names a prototype key; each decoder below must refuse it (it would otherwise reach a merge). */
const PROTO = '{"__proto__":{"isAdmin":true},"v":1}';
/** The same JSON with an own `__proto__` key added at the top. */
const withProtoKey = (json) => `{"__proto__":{"isAdmin":true},${json.slice(1)}`;

describe('a prototype key refuses the input, at every decoder of someone else\'s JSON', () => {
  it('openSealed: an otherwise valid sealed body carrying `__proto__` does not open', async () => {
    const alice = await AgentIdentity.generate(new VaultMemory());
    const carol = await AgentIdentity.generate(new VaultMemory());
    const parts = [TextPart('hallo')];
    const { sig, originTs } = signOrigin(alice, { target: carol.pubKey, skill: 'receive-message', parts });
    const body = JSON.stringify({ v: SEALED_VERSION, skill: 'receive-message', parts, origin: alice.pubKey, originSig: sig, originTs });
    const seal = (text) => { const { nonce, ciphertext } = alice.box(new TextEncoder().encode(text), carol.pubKey); return { sealed: b64encode(ciphertext), nonce: b64encode(nonce) }; };
    expect(openSealed({ identity: carol, ...seal(body), senderPubKey: alice.pubKey }).skill).toBe('receive-message');   // the control opens
    expect(() => openSealed({ identity: carol, ...seal(withProtoKey(body)), senderPubKey: alice.pubKey })).toThrow(/not valid JSON|unsafe key/);
  });
  it('openTunnelOW: a tunnel body carrying `__proto__` does not open', () => {
    const key = generateTunnelKey();
    const n = nacl.randomBytes(24);
    const sealed = nacl.secretbox(new TextEncoder().encode(PROTO), n, b64decode(key));
    expect(openTunnelOW({ key, sealed: b64encode(sealed), nonce: b64encode(n) })).toBeNull();
  });
  it('openFromPersonKey: a person-sealed body carrying `__proto__` does not open', async () => {
    const a = derivePersonKeySeed(new Uint8Array(32).fill(1), 1);
    const b = derivePersonKeySeed(new Uint8Array(32).fill(2), 1);
    // sealed as raw text (an object's `__proto__` would be its prototype, not a key, once stringified)
    const id = await AgentIdentity.fromSeed(a, new VaultMemory());
    const { nonce, ciphertext } = id.box(new TextEncoder().encode(PROTO), personKeyPubKeyB64(b));
    expect(await openFromPersonKey(b, personKeyPubKeyB64(a), { sealed: b64encode(ciphertext), nonce: b64encode(nonce) })).toBeNull();
  });
  it('a capability token (and a pod one) presented as JSON with `__proto__` is refused', () => {
    expect(() => CapabilityToken.fromJSON(PROTO)).toThrow();
    expect(() => PodCapabilityToken.fromJSON(PROTO)).toThrow();
  });
  it('an otherwise valid agent definition with `__proto__` is refused', async () => {
    const opts = () => ({ vault: new VaultMemory(), transport: new InternalTransport(new InternalBus(), 'agent-x') });
    const def = '{"agent":{"name":"a"}}';
    await expect(Agent.fromJson(def, opts())).resolves.toBeTruthy();   // the control loads
    await expect(Agent.fromJson(withProtoKey(def), opts())).rejects.toThrow(/unsafe key/);
  });
});
