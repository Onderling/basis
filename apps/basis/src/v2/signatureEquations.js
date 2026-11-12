/**
 * basis v2 — THE FASTER SIGNATURE EQUATIONS a shell installs behind the one strict rule (home: Agent).
 *
 * The platform's check is the strict byte rule, then an Ed25519 equation (`@onderling/core` `verifyEd25519Strict`).
 * The equation is tweetnacl unless a shell installs a faster one with `useSignatureEquation`, which takes it only if it
 * agrees on the edge-case vectors and on an honest and a tampered signature. Measured on a laptop: tweetnacl ~10 ms a
 * check, node:crypto ~0.14 ms, WebCrypto ~0.18 ms; on a mid-range phone tweetnacl is ~61 ms.
 *
 *   • the BOX: node:crypto, synchronous: every check, on every path, is the fast one;
 *   • the WEB: WebCrypto is asynchronous, so the synchronous check stays tweetnacl and the BATCH is WebCrypto: a read
 *     hands its statements to the memo's `checkBatch` first, and the synchronous checks after it are answered from
 *     memory. Chunked, so a long batch gives the thread back between chunks;
 *   • the PHONE: a native module, later (its own row); until then tweetnacl behind the rule.
 *
 * The platform's crypto is handed IN (the box passes `node:crypto`, the web `crypto.subtle`), so this shared module
 * imports nothing platform-specific.
 */
import nacl from 'tweetnacl';
import { useSignatureEquation, strictSignatureShapeOk, ED25519_EDGE_VECTORS, ED25519_ACCEPTED } from '@onderling/core';

// The DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the 32 key bytes follow it.
const SPKI_ED25519_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
/** How many checks a web batch runs before it gives the thread back. */
const WEB_BATCH_CHUNK = 64;

/**
 * node:crypto's Ed25519 check (OpenSSL), synchronous.
 * @param {{ createPublicKey: Function, verify: Function }} nodeCrypto  `node:crypto`
 */
export function nodeCryptoEquation(nodeCrypto) {
  const keys = new Map();   // raw key (base64) → KeyObject; a key is parsed once
  const keyObjectOf = (key) => {
    const id = Buffer.from(key).toString('base64');
    let k = keys.get(id);
    if (!k) {
      const der = new Uint8Array(SPKI_ED25519_PREFIX.length + 32);
      der.set(SPKI_ED25519_PREFIX); der.set(key, SPKI_ED25519_PREFIX.length);
      k = nodeCrypto.createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
      if (keys.size > 4096) keys.clear();
      keys.set(id, k);
    }
    return k;
  };
  return {
    name: 'node-crypto',
    verify: (msg, sig, key) => nodeCrypto.verify(null, msg, keyObjectOf(key), sig) === true,
  };
}

/**
 * WebCrypto's Ed25519 check, as a BATCH only (the synchronous path stays the platform's tweetnacl).
 * @param {SubtleCrypto} subtle  `crypto.subtle`
 * @param {{ yieldToThread?: () => Promise<void> }} [o]
 */
export function webCryptoEquation(subtle, { yieldToThread = () => new Promise((r) => { setTimeout(r, 0); }) } = {}) {
  const one = async ({ msg, sig, key }) => {
    try {
      const k = await subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
      return (await subtle.verify({ name: 'Ed25519' }, k, sig, msg)) === true;
    } catch { return false; }
  };
  return {
    name: 'webcrypto-batch',
    async verifyBatch(items) {
      const out = [];
      for (let i = 0; i < items.length; i += WEB_BATCH_CHUNK) {
        out.push(...await Promise.all(items.slice(i, i + WEB_BATCH_CHUNK).map(one)));
        if (i + WEB_BATCH_CHUNK < items.length) await yieldToThread();
      }
      return out;
    },
  };
}

/**
 * Does WebCrypto have Ed25519 here, answering like the rule on an honest and a tampered signature? (The vectors are
 * checked by `useSignatureEquation` on the synchronous path; the batch is checked here, once, because it is async.)
 * @param {SubtleCrypto} subtle
 * @returns {Promise<boolean>}
 */
export async function webCryptoBatchAgrees(subtle) {
  try {
    const kp = nacl.sign.keyPair();
    const msg = new TextEncoder().encode('onderling webcrypto self-test');
    const sig = nacl.sign.detached(msg, kp.secretKey);
    const tampered = new Uint8Array(msg); tampered[0] ^= 1;
    const eq = webCryptoEquation(subtle);
    const r = await eq.verifyBatch([{ msg, sig, key: kp.publicKey }, { msg: tampered, sig, key: kp.publicKey }]);
    if (!(r[0] === true && r[1] === false)) return false;
    // the twelve edge-case vectors through the batch, the byte rule in front as the platform runs it
    const hex = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
    const vs = ED25519_EDGE_VECTORS.map(([m, k, sg]) => ({ msg: hex(m), sig: hex(sg), key: hex(k) }));
    const shaped = vs.map((v) => strictSignatureShapeOk(v.sig, v.key));
    const answers = await eq.verifyBatch(vs.filter((_, i) => shaped[i]));
    let j = 0;
    return vs.every((_, i) => (shaped[i] ? answers[j++] === true : false) === ED25519_ACCEPTED.includes(i));
  } catch { return false; }
}

/**
 * Install the box's equation (node:crypto). Returns what `useSignatureEquation` said (it keeps tweetnacl on a refusal).
 * @param {object} nodeCrypto  `node:crypto`
 */
export function installBoxSignatureEquation(nodeCrypto) {
  try { return useSignatureEquation(nodeCryptoEquation(nodeCrypto)); } catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }
}

/**
 * Install the web's equation (WebCrypto's batch), after its self-test; with no Ed25519 in this browser, or a different
 * answer, tweetnacl stays.
 * @param {SubtleCrypto|null|undefined} subtle
 */
export async function installWebSignatureEquation(subtle) {
  if (!subtle || !(await webCryptoBatchAgrees(subtle))) return { ok: false, reason: 'no-ed25519-in-webcrypto' };
  return useSignatureEquation(webCryptoEquation(subtle));
}
