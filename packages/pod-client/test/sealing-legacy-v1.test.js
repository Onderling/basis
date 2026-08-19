/**
 * Legacy v1 envelope back-compat (Node) — the sealing substrate was ported off node:crypto
 * (AES-256-GCM) to a portable tweetnacl/@noble stack (v2). New data is written as v2, but any
 * already-persisted v1 (AES-256-GCM) envelopes — e.g. feedback-pipeline's on-pod data — must
 * still open. This test mints a GENUINE v1 envelope with node:crypto (replicating the old
 * format) and asserts the new `open`/`openWithGroupKey` read it. Node-only by nature (v1 reads
 * use node:crypto); the browser never holds v1 data.
 */
import { describe, it, expect } from 'vitest';
import {
  generateKeyPairSync, createPublicKey, diffieHellman, hkdfSync,
  randomBytes, createCipheriv, createHash,
} from 'node:crypto';
import { open, openWithGroupKey, generateGroupKey, isSealed } from '../src/sealing/envelope.js';

const INFO = new TextEncoder().encode('fp1-kek');
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');
const ridNode = (pubB64) => b64u(createHash('sha256').update(unb64u(pubB64)).digest().subarray(0, 8));

function aesEnc(key, pt) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return { iv: b64u(iv), ct: b64u(ct), tag: b64u(c.getAuthTag()) };
}
function pack(env) { return 'fp1:' + b64u(Buffer.from(JSON.stringify(env), 'utf8')); }

/** A node:crypto x25519 keypair as the old DER b64url strings. */
function legacyKeypair() {
  const kp = generateKeyPairSync('x25519');
  return {
    publicKey: b64u(kp.publicKey.export({ type: 'spki', format: 'der' })),
    privateKey: b64u(kp.privateKey.export({ type: 'pkcs8', format: 'der' })),
  };
}

/** The ORIGINAL v1 recipient seal (AES-256-GCM), to produce genuine legacy data. */
function sealV1(plaintext, recipientPubB64) {
  const cek = randomBytes(32);
  const body = aesEnc(cek, Buffer.from(String(plaintext), 'utf8'));
  const eph = generateKeyPairSync('x25519');
  const epkDer = eph.publicKey.export({ type: 'spki', format: 'der' });
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey({ key: unb64u(recipientPubB64), format: 'der', type: 'spki' }) });
  const kek = Buffer.from(hkdfSync('sha256', shared, epkDer, INFO, 32));
  const slot = { rid: ridNode(recipientPubB64), ...aesEnc(kek, cek) };
  return pack({ v: 1, epk: b64u(epkDer), body, recips: [slot] });
}
function sealV1Group(plaintext, groupKeyB64) {
  return pack({ v: 1, gk: 1, body: aesEnc(unb64u(groupKeyB64), Buffer.from(String(plaintext), 'utf8')) });
}

describe('legacy v1 (AES-256-GCM) envelopes still open', () => {
  it('recipient mode: new open() reads a genuine node:crypto v1 envelope', () => {
    const k = legacyKeypair();
    const sealed = sealV1('legacy hallo — v1 recipient', k.publicKey);
    expect(isSealed(sealed)).toBe(true);
    expect(open(sealed, k.privateKey)).toBe('legacy hallo — v1 recipient');
  });

  it('recipient mode: a non-recipient v1 key is rejected', () => {
    const k = legacyKeypair();
    const other = legacyKeypair();
    const sealed = sealV1('secret', k.publicKey);
    expect(() => open(sealed, other.privateKey)).toThrow(/not a recipient/);
  });

  it('group mode: new openWithGroupKey() reads a v1 group envelope', () => {
    const gk = generateGroupKey();   // v2-generated key string — format is just a b64url 32-byte key
    const sealed = sealV1Group('legacy circle — v1 group', gk);
    expect(openWithGroupKey(sealed, gk)).toBe('legacy circle — v1 group');
  });
});
