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
import { useSignatureEquation } from '@onderling/core';

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
 * Install the box's equation (node:crypto). Returns what `useSignatureEquation` said (it keeps tweetnacl on a refusal).
 * @param {object} nodeCrypto  `node:crypto`
 */
export async function installBoxSignatureEquation(nodeCrypto) {
  try { return await useSignatureEquation(nodeCryptoEquation(nodeCrypto)); } catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }
}

/**
 * Install the web's equation (WebCrypto's batch); the kernel vets the batch itself. With no Ed25519 in this browser, or
 * a different answer, tweetnacl stays.
 * @param {SubtleCrypto|null|undefined} subtle
 */
export async function installWebSignatureEquation(subtle) {
  if (!subtle) return { ok: false, reason: 'no-webcrypto' };
  return useSignatureEquation(webCryptoEquation(subtle));
}
