// sealing/envelope.js — at-rest envelope encryption for pod resources (OPT-IN; not a default).
//
// Lifted + generalized from feedback-pipeline's `pod/project-seal.js` (rule-of-two: feedback's
// seal-to-project-key + household's shared-pod group key). The plan's "sealing substrate". node:crypto
// only — no new deps; the same family the rest of the stack standardises on (AES-256-GCM like
// @canopy/vault's VaultNodeFs; X25519 like the core SecurityLayer). Node-side module (like
// `tombstones/FileTombstones.js`); a browser WebCrypto impl is a later tier.
//
// Two wrap modes share ONE content cipher (a fresh per-resource CEK encrypts the body, AES-256-GCM):
//   • RECIPIENT mode — the CEK is wrapped to each recipient PUBLIC key (ephemeral X25519 ECDH → HKDF →
//     AES). The writer needs only public keys (host-blind); only a recipient private key opens. Wrapping
//     to N recipients stores the CEK N times. (Feedback uses this: seal each contribution to the project
//     key; wrap the project private key to a team.)
//   • GROUP-KEY mode — the body is encrypted directly with a shared symmetric GROUP KEY; the group key
//     itself is distributed by wrapping it to members with RECIPIENT mode (one key resource, O(1) per
//     resource — see the household shared-pod model). grant = one wrap; rotate = a new group key version.

import {
  generateKeyPairSync, createPublicKey, createPrivateKey,
  diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv,
  createHash,
} from 'node:crypto';

const SENTINEL = 'fp1:';               // kept stable: feedback's existing on-pod envelopes start with it
const ALG = 'aes-256-gcm';
// HKDF context. A Uint8Array (not Buffer.from) so this MODULE evaluates without `Buffer` in a browser —
// it's statically pulled into the browser graph via the feedback pod, and a top-level `Buffer.from`
// crashed the web shell at boot (2026-06-11). hkdfSync accepts a TypedArray for `info`. The sealing
// FUNCTIONS below are still Node-only (node:crypto + Buffer) — a browser WebCrypto tier is future work;
// this only stops the load-time crash so browser code that never calls sealing (the feedback demo) boots.
const INFO = new TextEncoder().encode('fp1-kek');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

const pubDer = (publicKey) => publicKey.export({ type: 'spki', format: 'der' });
const importPub = (b64) => createPublicKey({ key: unb64u(b64), format: 'der', type: 'spki' });
const importPriv = (b64) => createPrivateKey({ key: unb64u(b64), format: 'der', type: 'pkcs8' });

/** Stable short id for a recipient public key (b64url SPKI) — the slot label in an envelope. */
export function recipientId(publicKeyB64) {
  return b64u(createHash('sha256').update(unb64u(publicKeyB64)).digest().subarray(0, 8));
}

/** Generate an X25519 keypair as b64url DER strings. The keygen LOCATION (client/external/host) is a
 *  policy choice about WHO holds `privateKey`; the function is identical. */
export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pub = b64u(pubDer(publicKey));
  return {
    publicKey: pub,
    privateKey: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
    recipientId: recipientId(pub),
  };
}

/** A fresh 256-bit symmetric group key (b64url). Distribute it by sealing it to members (RECIPIENT mode). */
export function generateGroupKey() {
  return b64u(randomBytes(32));
}

/** True if a stored text is a sealed envelope (either mode). */
export function isSealed(text) { return typeof text === 'string' && text.startsWith(SENTINEL); }

function aesEncrypt(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: b64u(iv), ct: b64u(ct), tag: b64u(cipher.getAuthTag()) };
}

function aesDecrypt(key, { iv, ct, tag }) {
  const decipher = createDecipheriv(ALG, key, unb64u(iv));
  decipher.setAuthTag(unb64u(tag));
  return Buffer.concat([decipher.update(unb64u(ct)), decipher.final()]);
}

function pack(env) { return SENTINEL + b64u(Buffer.from(JSON.stringify(env), 'utf8')); }
function unpack(sealedText) { return JSON.parse(unb64u(sealedText.slice(SENTINEL.length)).toString('utf8')); }

/** RECIPIENT mode — seal a string to one or more recipient public keys (b64url SPKI). Needs ONLY public keys. */
export function seal(plaintext, recipients) {
  const recips = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);
  if (recips.length === 0) throw new Error('seal: at least one recipient public key required');
  const cek = randomBytes(32);
  const body = aesEncrypt(cek, Buffer.from(String(plaintext), 'utf8'));
  const eph = generateKeyPairSync('x25519');
  const epkRaw = pubDer(eph.publicKey);
  const wrapped = recips.map((pubB64) => {
    const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: importPub(pubB64) });
    const kek = Buffer.from(hkdfSync('sha256', shared, epkRaw, INFO, 32));
    return { rid: recipientId(pubB64), ...aesEncrypt(kek, cek) };
  });
  return pack({ v: 1, epk: b64u(epkRaw), body, recips: wrapped });
}

/** RECIPIENT mode — open with a recipient private key (b64url PKCS8). Plaintext / non-recipient handling
 *  unchanged: passes plaintext through; throws if this key is not a recipient (so the host genuinely can't read). */
export function open(sealedText, privateKeyB64) {
  if (!isSealed(sealedText)) return sealedText;
  const env = unpack(sealedText);
  if (env.v !== 1) throw new Error(`sealing: unknown envelope version ${env.v}`);
  if (env.gk) throw new Error('sealing: group-key envelope — use openWithGroupKey');
  const priv = importPriv(privateKeyB64);
  const myRid = recipientId(b64u(pubDer(createPublicKey(priv))));
  const slot = env.recips.find((r) => r.rid === myRid);
  if (!slot) throw new Error('sealing: not a recipient of this sealed resource');
  const shared = diffieHellman({ privateKey: priv, publicKey: importPub(env.epk) });
  const kek = Buffer.from(hkdfSync('sha256', shared, unb64u(env.epk), INFO, 32));
  const cek = aesDecrypt(kek, slot);
  return aesDecrypt(cek, env.body).toString('utf8');
}

/** GROUP-KEY mode — seal a string under a shared symmetric group key (b64url). Anyone holding the group
 *  key can open it; the group key is distributed separately via `seal(groupKey, memberPublicKeys)`. */
export function sealWithGroupKey(plaintext, groupKeyB64) {
  if (!groupKeyB64) throw new Error('sealWithGroupKey: group key required');
  const body = aesEncrypt(unb64u(groupKeyB64), Buffer.from(String(plaintext), 'utf8'));
  return pack({ v: 1, gk: 1, body });
}

/** GROUP-KEY mode — open a group-key envelope with the shared group key. Plaintext passes through. */
export function openWithGroupKey(sealedText, groupKeyB64) {
  if (!isSealed(sealedText)) return sealedText;
  const env = unpack(sealedText);
  if (env.v !== 1) throw new Error(`sealing: unknown envelope version ${env.v}`);
  if (!env.gk) throw new Error('sealing: recipient envelope — use open(text, privateKey)');
  return aesDecrypt(unb64u(groupKeyB64), env.body).toString('utf8');
}

/** Closures a writer/reader injects. The sealer holds only public keys (or the group key); the opener
 *  holds a private key (or the group key). */
export function makeSealer(recipients) { return (text) => seal(text, recipients); }
export function makeOpener(privateKeyB64) { return (text) => open(text, privateKeyB64); }
export function makeGroupSealer(groupKeyB64) { return (text) => sealWithGroupKey(text, groupKeyB64); }
export function makeGroupOpener(groupKeyB64) { return (text) => openWithGroupKey(text, groupKeyB64); }
