/**
 * ONE STRICT RULE FOR A VALID Ed25519 SIGNATURE — the same answer on every device, whatever library does the curve.
 *
 * Ed25519 libraries disagree on crafted signatures. Measured 2026-11-12 on the 12 published edge-case vectors
 * (ed25519-speccheck, "Taming the many EdDSAs", Chalkias, Garillot, Nikolaenko 2020): tweetnacl (what every device ran
 * until now) accepts a signature whose scalar S is not below the group order L and accepts the identity point as a
 * public key (under which any bytes "verify"); node:crypto and WebCrypto refuse the first and accept the second;
 * libsodium refuses both. If devices checked with different libraries, a member could craft a statement some devices
 * accept and others refuse, and their rosters would differ.
 *
 * So every check passes these BYTE checks first (the ones libsodium makes), and only then the library's own
 * single-signature equation, which must be the cofactorless one (all of ours are):
 *   1. the signature is 64 bytes and the key 32;
 *   2. S (the signature's second half, little-endian) is canonical: S < L;
 *   3. the key A and the point R (the signature's first half) are canonically encoded: y < p;
 *   4. neither A nor R is of small order: its encoding (sign bit ignored) is not one of the seven encodings of the
 *      eight small-order points (two of them non-canonical, kept so the list stands on its own).
 * Pure byte comparisons: no curve arithmetic, so the rule costs nothing next to the check it guards.
 *
 * The seven constants and the rule are pinned against an independent big-integer oracle and the 12 vectors in
 * `test/ed25519Strict.test.js`; honest signatures from today's signer all pass. Every Ed25519 check in the platform
 * goes through `verifyEd25519Strict` (a guard refuses a direct `nacl.sign.detached.verify` elsewhere).
 */
import nacl from 'tweetnacl';
import { ed25519Disagreements, ED25519_EDGE_VECTORS, ED25519_ACCEPTED } from '../conformance/ed25519Conformance.js';

/** The rule set's name, for anything that ever records a verdict beyond this process. */
export const ED25519_RULE = 'ed25519-strict-1';

// L = 2^252 + 27742317777372353535851937790883648493, little-endian
const L_LE = Uint8Array.from([
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
]);

const ff = (n) => new Array(n).fill(0xff);
// The encodings (sign bit ignored: the last byte is compared as & 0x7f) of the eight small-order points, as libsodium
// lists them. Order 4 (y = 0), order 1 (y = 1), the two y of order 8, order 2 (y = p - 1), and the non-canonical
// p (= 0) and p + 1 (= 1).
const SMALL_ORDER = [
  new Array(32).fill(0x00),
  [0x01, ...new Array(31).fill(0x00)],
  [0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0,
    0xd5, 0xdf, 0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05],
  [0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f,
    0x2a, 0x20, 0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a],
  [0xec, ...ff(30), 0x7f],
  [0xed, ...ff(30), 0x7f],
  [0xee, ...ff(30), 0x7f],
].map((a) => Uint8Array.from(a));

/** S < L, comparing little-endian from the most significant byte down. */
function scalarIsCanonical(s) {
  for (let i = 31; i >= 0; i -= 1) {
    if (s[i] < L_LE[i]) return true;
    if (s[i] > L_LE[i]) return false;
  }
  return false;   // S == L
}

/** y < p = 2^255 - 19 (the sign bit is not part of y): non-canonical only for y in [p, 2^255 - 1]. */
function pointIsCanonical(e) {
  if ((e[31] & 0x7f) !== 0x7f) return true;
  for (let i = 30; i >= 1; i -= 1) if (e[i] !== 0xff) return true;
  return e[0] < 0xed;
}

/** One of the small-order encodings, the sign bit ignored. */
function hasSmallOrder(e) {
  for (const bad of SMALL_ORDER) {
    let same = true;
    for (let i = 0; i < 31 && same; i += 1) if (e[i] !== bad[i]) same = false;
    if (same && (e[31] & 0x7f) === bad[31]) return true;
  }
  return false;
}

/**
 * The byte rule alone (no equation): may this (signature, key) pair be handed to a library at all?
 * @param {Uint8Array} sig  64 bytes
 * @param {Uint8Array} key  32 bytes
 */
export function strictSignatureShapeOk(sig, key) {
  if (!(sig instanceof Uint8Array) || !(key instanceof Uint8Array)) return false;
  if (sig.length !== 64 || key.length !== 32) return false;
  const R = sig.subarray(0, 32);
  const S = sig.subarray(32, 64);
  if (!scalarIsCanonical(S)) return false;
  if (!pointIsCanonical(key) || !pointIsCanonical(R)) return false;
  if (hasSmallOrder(key) || hasSmallOrder(R)) return false;
  return true;
}

const TWEETNACL = Object.freeze({ name: 'tweetnacl', verify: (msg, sig, key) => nacl.sign.detached.verify(msg, sig, key), verifyBatch: null });
let equation = TWEETNACL;

/**
 * THE check: the strict byte rule, then the equation (tweetnacl's cofactorless one, unless the shell installed a faster
 * one that agrees: `useSignatureEquation`).
 * @param {Uint8Array} msg
 * @param {Uint8Array} sig
 * @param {Uint8Array} key
 * @returns {boolean}
 */
export function verifyEd25519Strict(msg, sig, key) {
  if (!strictSignatureShapeOk(sig, key)) return false;
  try { return equation.verify(msg, sig, key) === true; } catch { return false; }
}

/**
 * Many checks at once, each with the byte rule in front: the installed equation's `verifyBatch` when it has one (an
 * async check such as WebCrypto, which never blocks the thread), else one by one.
 * @param {Array<{msg: Uint8Array, sig: Uint8Array, key: Uint8Array}>} items
 * @returns {Promise<boolean[]>}
 */
export async function verifyEd25519StrictBatch(items) {
  const list = Array.isArray(items) ? items : [];
  const shapeOk = list.map((it) => strictSignatureShapeOk(it?.sig, it?.key));
  const eq = equation;
  if (typeof eq.verifyBatch !== 'function') return list.map((it, i) => shapeOk[i] && verifyEd25519Strict(it.msg, it.sig, it.key));
  const passing = list.filter((_, i) => shapeOk[i]);
  let answers = [];
  try { answers = (await eq.verifyBatch(passing)) ?? []; } catch { answers = []; }
  let j = 0;
  return list.map((_, i) => (shapeOk[i] ? answers[j++] === true : false));
}

const fromHex = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
const SIG_KEY = '9ca0da86726d8282ce4e0719df6d1f4db2902bdfe78632ac4890d0b9a8e38e27';
const SIG_MSG = '6f6e6465726c696e67206571756174696f6e2073656c662d74657374';   // 'onderling equation self-test'
const SIG_SIG = 'c9cc2945dfa22f477ab15db089f67c002b8333d49713593cfa75179cf41ac902f28f45e91e0dd003eb21e0548d68b2643f54e9c2dade4779bd77648cc855a301';
/**
 * The fixed vectors the vetting checks a candidate against, written down as BYTES so installing an equation at a start
 * makes no key pair and no signature in tweetnacl (it did, at every install). One honest signature — tweetnacl's, over
 * the message, with the key of the fixed seed — that must be accepted, and three that must be refused, each passing the
 * byte rule so the refusal is the equation's own: the message with one bit flipped, the signature's R with one bit
 * flipped, and the honest signature under another seed's key. A test pins that tweetnacl still gives exactly these.
 */
export const SIGNATURE_VECTORS = Object.freeze({
  seed: fromHex('05101b26313c47525d68737e89949faab5c0cbd6e1ecf7020d18232e39444f5a'),
  key: fromHex(SIG_KEY),
  msg: fromHex(SIG_MSG),
  sig: fromHex(SIG_SIG),
  negatives: Object.freeze([
    { case: 'tampered-message', msg: fromHex('6e' + SIG_MSG.slice(2)), sig: fromHex(SIG_SIG), key: fromHex(SIG_KEY) },
    { case: 'tampered-signature', msg: fromHex(SIG_MSG), sig: fromHex('c8' + SIG_SIG.slice(2)), key: fromHex(SIG_KEY) },
    { case: 'wrong-key', msg: fromHex(SIG_MSG), sig: fromHex(SIG_SIG), key: fromHex('d685026fc71177fb4945d10d81be65704c47d53cff34014e049c3b714cacb249') },
  ]),
});
/** Fresh copies per check: a candidate that writes into its inputs cannot change the next check. */
const copy = (u) => Uint8Array.from(u);

/**
 * A FASTER EQUATION, installed once by the shell (node:crypto on the box, WebCrypto's batch on the web; a native module
 * on the phone later), BEHIND the byte rule. Taken only if, with the rule in front, it gives the platform's answer on
 * the twelve edge-case vectors, accepts the fixed honest signature and refuses the three fixed negative ones; otherwise
 * the current equation stays and the answer says why. `null` goes back to tweetnacl. The rule itself is never
 * replaceable. An equation that brings only `verifyBatch` (an async check) keeps tweetnacl for the synchronous path —
 * which is the reference and is not vetted against itself. A `verifyBatch` is vetted HERE too, through the batch itself
 * (the vectors with the rule in front, the honest and the negative signatures): the one place the rule "nothing faster
 * without agreeing" lives, for every shell. Async for that reason. No tweetnacl runs at an install: every expected
 * answer is fixed bytes.
 * @param {{name: string, verify?: (msg: Uint8Array, sig: Uint8Array, key: Uint8Array) => boolean,
 *          verifyBatch?: (items: Array<{msg: Uint8Array, sig: Uint8Array, key: Uint8Array}>) => Promise<boolean[]>}|null} eq
 * @returns {Promise<{ok: boolean, name: string, reason?: string, disagreements?: Array<object>}>}
 */
export async function useSignatureEquation(eq) {
  if (eq == null) { equation = TWEETNACL; return { ok: true, name: equation.name }; }
  const hasSync = typeof eq?.verify === 'function';
  if ((!hasSync && typeof eq?.verifyBatch !== 'function') || typeof eq?.name !== 'string' || !eq.name) return { ok: false, name: equation.name, reason: 'not-an-equation' };
  const sync = hasSync ? eq.verify : TWEETNACL.verify;
  if (hasSync) {
    const withRule = (m, s, k) => strictSignatureShapeOk(s, k) && sync(m, s, k) === true;
    const disagreements = ed25519Disagreements(withRule);
    if (disagreements.length) return { ok: false, name: equation.name, reason: 'disagrees-on-vectors', disagreements };
    const { key, msg, sig, negatives } = SIGNATURE_VECTORS;
    let honest = false; let refused = false;
    try {
      honest = withRule(copy(msg), copy(sig), copy(key));
      refused = negatives.every((n) => !withRule(copy(n.msg), copy(n.sig), copy(n.key)));
    } catch { honest = false; }
    if (!honest || !refused) return { ok: false, name: equation.name, reason: honest ? 'accepts-tampered' : 'refuses-honest' };
  }
  if (typeof eq.verifyBatch === 'function') {
    const why = await batchDisagrees(eq.verifyBatch);
    if (why) return { ok: false, name: equation.name, reason: why };
  }
  equation = Object.freeze({ name: eq.name, verify: sync, verifyBatch: typeof eq.verifyBatch === 'function' ? eq.verifyBatch : null });
  return { ok: true, name: equation.name };
}

/** The batch's own answers, with the byte rule in front as the platform runs it: null when it agrees, else why not. */
async function batchDisagrees(verifyBatch) {
  const vs = ED25519_EDGE_VECTORS.map(([m, k, s]) => ({ msg: fromHex(m), sig: fromHex(s), key: fromHex(k) }));
  const shaped = vs.map((v) => strictSignatureShapeOk(v.sig, v.key));
  const { key, msg, sig, negatives } = SIGNATURE_VECTORS;
  const items = [
    ...vs.filter((_, i) => shaped[i]),
    { msg: copy(msg), sig: copy(sig), key: copy(key) },
    ...negatives.map((n) => ({ msg: copy(n.msg), sig: copy(n.sig), key: copy(n.key) })),
  ];
  let answers = [];
  try { answers = (await verifyBatch(items)) ?? []; } catch { return 'batch-failed'; }
  let j = 0;
  const vectorsOk = vs.every((_, i) => (shaped[i] ? answers[j++] === true : false) === ED25519_ACCEPTED.includes(i));
  if (!vectorsOk) return 'batch-disagrees-on-vectors';
  if (answers[j] !== true) return 'batch-refuses-honest';
  if (negatives.some((_, n) => answers[j + 1 + n] !== false)) return 'batch-accepts-tampered';
  return null;
}

/** Does the installed equation check a batch off the thread (WebCrypto)? A read then checks ahead, as one batch. */
export function signatureEquationBatches() { return typeof equation.verifyBatch === 'function'; }

/** Which equation answers now ('tweetnacl' until a shell installs one). For diagnostics. */
export function signatureEquationName() { return equation.name; }
