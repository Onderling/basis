// sealing/envelope.js — at-rest envelope encryption for pod resources (OPT-IN; not a default).
//
// Lifted + generalized from feedback-pipeline's `pod/project-seal.js` (rule-of-two: feedback's
// seal-to-project-key + household's shared-pod group key). The plan's "sealing substrate".
//
// PORTABLE (2026-06-15): ported off `node:crypto` to a pure-JS, SYNCHRONOUS stack that runs in
// Node, the browser, AND React-Native — the same primitives the core SecurityLayer already
// standardises on, so NO new deps:
//   • X25519 (key-exchange) + XSalsa20-Poly1305 (body cipher)  → `tweetnacl`
//   • HKDF-SHA256 (key derivation) + SHA-256 (recipient ids)   → `@noble/hashes`
// Keys stay X25519 SPKI/PKCS8 **DER** (byte-identical to the previous node:crypto encoding), so
// `recipientId`s and any already-persisted sealing identities remain valid, and tweetnacl's X25519
// ECDH is byte-identical to node's `diffieHellman('x25519')` (verified). Everything is sync, so
// SealedPodClient / controlAgent / groupKeyResource and their tests are UNCHANGED.
//
// Envelope versions:
//   • v2 (DEFAULT, written by seal/sealWithGroupKey) — portable: secretbox body + secretbox-wrapped CEK.
//   • v1 (LEGACY, read-only) — the original AES-256-GCM format. Opened via `node:crypto` (Node only —
//     the browser never holds v1 data; v1 was only ever written server-side / in Node). New data is
//     never written as v1.
//
// Two wrap modes share ONE content cipher (a fresh per-resource CEK encrypts the body):
//   • RECIPIENT mode — the CEK is wrapped to each recipient PUBLIC key (ephemeral X25519 ECDH → HKDF →
//     symmetric wrap). The writer needs only public keys (host-blind); only a recipient private key opens.
//   • GROUP-KEY mode — the body is encrypted directly with a shared symmetric GROUP KEY; the group key
//     itself is distributed by wrapping it to members with RECIPIENT mode (one key resource, O(1) per
//     resource). grant = one wrap; rotate = a new group key version.

import nacl from 'tweetnacl';
import ed2curve from 'ed2curve';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8Decode } from './utf8.js';

const SENTINEL = 'fp1:';               // kept stable: feedback's existing on-pod envelopes start with it
// HKDF context (a TypedArray — keeps this module Buffer-free at load time for the browser graph).
const INFO = new TextEncoder().encode('fp1-kek');
const te = new TextEncoder();

// X25519 DER headers (fixed ASN.1 prefixes) — wrap tweetnacl's raw 32-byte keys back into the SPKI/PKCS8
// DER the rest of the format expects, so the on-wire key bytes (and thus recipientId) are byte-identical
// to the previous node:crypto encoding.
const SPKI_PREFIX  = unhex('302a300506032b656e032100');        // → 12 bytes + 32 raw public
const PKCS8_PREFIX = unhex('302e020100300506032b656e04220420'); // → 16 bytes + 32 raw private

// ── portable byte helpers (no Buffer; btoa/atob exist in Node 16+ and every browser) ────────────────
function unhex(h) { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; }
function concat(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; }
function b64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const wrapPub  = (raw32) => concat(SPKI_PREFIX, raw32);
const wrapPriv = (raw32) => concat(PKCS8_PREFIX, raw32);
const rawKey   = (der) => der.subarray(der.length - 32);   // last 32 bytes of an X25519 SPKI/PKCS8 DER

/** Stable short id for a recipient public key (b64url SPKI DER) — the slot label in an envelope. */
export function recipientId(publicKeyB64) {
  return b64u(sha256(unb64u(publicKeyB64)).subarray(0, 8));
}

/** Generate an X25519 keypair as b64url DER strings. The keygen LOCATION (client/external/host) is a
 *  policy choice about WHO holds `privateKey`; the function is identical. */
export function generateKeypair() {
  const kp = nacl.box.keyPair();                 // {publicKey: raw32 X25519, secretKey: raw32}
  const pub = b64u(wrapPub(kp.publicKey));
  return {
    publicKey: pub,
    privateKey: b64u(wrapPriv(kp.secretKey)),
    recipientId: recipientId(pub),
  };
}

// ── OUT-OF-CIRCLE recipients: derive a SEALING key from a PUBLISHED NETWORK identity key ────────────
// A network identity (core `AgentIdentity`) publishes an **Ed25519** public key as its network address.
// The sealing substrate wraps to **X25519** keys. These two functions bridge that gap with the SAME
// birational Ed25519→Curve25519 map `AgentIdentity` already uses for `nacl.box` (ed2curve) — NO new
// cipher, NO new key-agreement: the derived X25519 key is wrapped into the exact SPKI/PKCS8 DER the
// envelope already encodes, so `seal`/`grantMember`/`open` treat it identically to a native sealing key.
// This is what lets you grant a recipient OUTSIDE the origin circle: you don't have their sealing key
// from the roster, but you DO have their published network key, and its sealing counterpart is derivable.

/**
 * GRANTER side (public only) — convert a recipient's PUBLISHED Ed25519 network public key (b64url of the
 * raw 32-byte key, as `AgentIdentity.pubKey` publishes it) into the X25519 SEALING public key (b64url
 * SPKI DER) that `seal`/`grantMember` wrap the group key to. Throws on a malformed / non-Ed25519 key.
 */
export function sealingPublicKeyFromNetworkKey(networkPublicKeyB64) {
  const ed = unb64u(networkPublicKeyB64);
  if (ed.length !== 32) throw new Error('sealingPublicKeyFromNetworkKey: expected a 32-byte Ed25519 public key');
  const curve = ed2curve.convertPublicKey(ed);
  if (!curve) throw new Error('sealingPublicKeyFromNetworkKey: not a valid Ed25519 public key');
  return b64u(wrapPub(curve));
}

/**
 * RECIPIENT side — derive the X25519 SEALING keypair (b64url DER, same shape as `generateKeypair`) from an
 * Ed25519 NETWORK secret (b64url of a 32-byte seed OR a 64-byte nacl secret key). An out-of-circle recipient
 * who holds only their network identity uses this to obtain the private key that `open`/`unwrapGroupKey`
 * need — its `publicKey` is byte-identical to `sealingPublicKeyFromNetworkKey(networkPublicKey)`, so it
 * unwraps a group key granted to their published network key. Throws on a malformed key.
 */
export function sealingKeyPairFromNetworkKey(networkSecretB64) {
  const sk = unb64u(networkSecretB64);
  const signKP = sk.length === 32 ? nacl.sign.keyPair.fromSeed(sk)
    : sk.length === 64 ? { publicKey: sk.subarray(32), secretKey: sk }
      : null;
  if (!signKP) throw new Error('sealingKeyPairFromNetworkKey: expected a 32-byte seed or 64-byte secret key');
  const boxKP = ed2curve.convertKeyPair(signKP);
  if (!boxKP) throw new Error('sealingKeyPairFromNetworkKey: not a valid Ed25519 key');
  const pub = b64u(wrapPub(boxKP.publicKey));
  return { publicKey: pub, privateKey: b64u(wrapPriv(boxKP.secretKey)), recipientId: recipientId(pub) };
}

/** A fresh 256-bit symmetric group key (b64url). Distribute it by sealing it to members (RECIPIENT mode). */
export function generateGroupKey() {
  return b64u(nacl.randomBytes(32));
}

/** True if a stored text is a sealed envelope (either mode/version). */
export function isSealed(text) { return typeof text === 'string' && text.startsWith(SENTINEL); }

// ── v2 symmetric primitive: XSalsa20-Poly1305 (tweetnacl secretbox) ─────────────────────────────────
function sbSeal(keyU8, plaintextU8) {
  const n = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { n: b64u(n), c: b64u(nacl.secretbox(plaintextU8, n, keyU8)) };
}
function sbOpen(keyU8, slot) {
  const out = nacl.secretbox.open(unb64u(slot.c), unb64u(slot.n), keyU8);
  if (!out) throw new Error('sealing: secretbox open failed (wrong key or corrupt envelope)');
  return out;
}

function pack(env) { return SENTINEL + b64u(te.encode(JSON.stringify(env))); }
/**
 * The envelope's JSON, decoded ONCE (ledger L619): what `pack` writes is ASCII by construction (base64 fields and
 * numbers), so the base64 decode's binary string IS the JSON text, and the UTF-8 decoder (a JavaScript polyfill on the
 * phone, ~half the cost of opening a record) runs only on the plaintext. An envelope with any non-ASCII byte (none
 * this code writes) takes the full decode.
 */
function unpack(sealedText) {
  const bin = atob(String(sealedText.slice(SENTINEL.length)).replace(/-/g, '+').replace(/_/g, '/'));
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(bin)) return JSON.parse(bin);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return JSON.parse(utf8Decode(u8));
}

/** RECIPIENT mode — seal a string to one or more recipient public keys (b64url SPKI DER). Needs ONLY public keys. */
export function seal(plaintext, recipients) {
  const recips = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);
  if (recips.length === 0) throw new Error('seal: at least one recipient public key required');
  const cek = nacl.randomBytes(32);
  const body = sbSeal(cek, te.encode(String(plaintext)));
  const eph = nacl.box.keyPair();
  const epkDer = wrapPub(eph.publicKey);
  const wrapped = recips.map((pubB64) => {
    const shared = nacl.scalarMult(eph.secretKey, rawKey(unb64u(pubB64)));
    const kek = hkdf(sha256, shared, epkDer, INFO, 32);
    return { rid: recipientId(pubB64), ...sbSeal(kek, cek) };
  });
  return pack({ v: 2, epk: b64u(epkDer), body, recips: wrapped });
}

/** RECIPIENT mode — open with a recipient private key (b64url PKCS8 DER). Plaintext / non-recipient handling
 *  unchanged: passes plaintext through; throws if this key is not a recipient (so the host genuinely can't read). */
export function open(sealedText, privateKeyB64) {
  if (!isSealed(sealedText)) return sealedText;
  const env = unpack(sealedText);
  if (env.v === 1) return openV1(env, privateKeyB64);          // legacy AES-GCM (Node only)
  if (env.v !== 2) throw new Error(`sealing: unknown envelope version ${env.v}`);
  if (env.gk) throw new Error('sealing: group-key envelope — use openWithGroupKey');
  const privRaw = rawKey(unb64u(privateKeyB64));
  const myRid = recipientId(b64u(wrapPub(nacl.scalarMult.base(privRaw))));
  const slot = env.recips.find((r) => r.rid === myRid);
  if (!slot) throw new Error('sealing: not a recipient of this sealed resource');
  const epkDer = unb64u(env.epk);
  const shared = nacl.scalarMult(privRaw, rawKey(epkDer));
  const kek = hkdf(sha256, shared, epkDer, INFO, 32);
  const cek = sbOpen(kek, slot);
  return utf8Decode(sbOpen(cek, env.body));
}

/** GROUP-KEY mode — seal a string under a shared symmetric group key (b64url). Anyone holding the group
 *  key can open it; the group key is distributed separately via `seal(groupKey, memberPublicKeys)`. */
export function sealWithGroupKey(plaintext, groupKeyB64) {
  if (!groupKeyB64) throw new Error('sealWithGroupKey: group key required');
  return pack({ v: 2, gk: 1, body: sbSeal(unb64u(groupKeyB64), te.encode(String(plaintext))) });
}

/** GROUP-KEY mode — open a group-key envelope with the shared group key. Plaintext passes through. */
export function openWithGroupKey(sealedText, groupKeyB64) {
  if (!isSealed(sealedText)) return sealedText;
  const env = unpack(sealedText);
  if (env.v === 1) return openV1Group(env, groupKeyB64);       // legacy AES-GCM (Node only)
  if (env.v !== 2) throw new Error(`sealing: unknown envelope version ${env.v}`);
  if (!env.gk) throw new Error('sealing: recipient envelope — use open(text, privateKey)');
  return utf8Decode(sbOpen(unb64u(groupKeyB64), env.body));
}

// ── v1 LEGACY readers (AES-256-GCM, node:crypto) — Node-only, read-only ─────────────────────────────
// New data is never written as v1. The browser never holds v1 data (v1 was only ever written
// server-side / in Node), so this path is unreachable there; reaching it in the browser throws via the
// node:crypto shim, which is the correct "should be unreachable" signal. node:crypto is loaded lazily
// (require) so the browser bundle never statically pulls it for the sealing module.
function nodeCrypto() {
  const req = (typeof module !== 'undefined' && module.require) ? module.require.bind(module)
    : (typeof require === 'function' ? require : null);
  if (!req) throw new Error('sealing: a v1 (legacy AES-GCM) envelope can only be opened in a Node context');
  return req('node:crypto');
}
function aesDecryptV1({ createDecipheriv }, keyU8, { iv, ct, tag }) {
  const d = createDecipheriv('aes-256-gcm', keyU8, unb64u(iv));
  d.setAuthTag(unb64u(tag));
  return new Uint8Array(Buffer.concat([d.update(unb64u(ct)), d.final()]));
}
function openV1(env, privateKeyB64) {
  const c = nodeCrypto();
  const priv = c.createPrivateKey({ key: Buffer.from(unb64u(privateKeyB64)), format: 'der', type: 'pkcs8' });
  const myDerPub = new Uint8Array(c.createPublicKey(priv).export({ type: 'spki', format: 'der' }));
  const slot = env.recips.find((r) => r.rid === recipientId(b64u(myDerPub)));
  if (!slot) throw new Error('sealing: not a recipient of this sealed resource');
  const shared = c.diffieHellman({ privateKey: priv, publicKey: c.createPublicKey({ key: Buffer.from(unb64u(env.epk)), format: 'der', type: 'spki' }) });
  const kek = new Uint8Array(c.hkdfSync('sha256', shared, unb64u(env.epk), INFO, 32));
  const cek = aesDecryptV1(c, kek, slot);
  return utf8Decode(aesDecryptV1(c, cek, env.body));
}
function openV1Group(env, groupKeyB64) {
  return utf8Decode(aesDecryptV1(nodeCrypto(), unb64u(groupKeyB64), env.body));
}

/** Closures a writer/reader injects. The sealer holds only public keys (or the group key); the opener
 *  holds a private key (or the group key). */
export function makeSealer(recipients) { return (text) => seal(text, recipients); }
/** Bind a recipient PRIVATE key into an `open(text)` closure for recipient-mode envelopes. */
export function makeOpener(privateKeyB64) { return (text) => open(text, privateKeyB64); }
/** Bind a shared group key into a `seal(text)` closure (group-key-mode envelopes). */
export function makeGroupSealer(groupKeyB64) { return (text) => sealWithGroupKey(text, groupKeyB64); }
/** Bind a shared group key into an `open(text)` closure; unsealed text passes through unchanged. */
export function makeGroupOpener(groupKeyB64) { return (text) => openWithGroupKey(text, groupKeyB64); }
