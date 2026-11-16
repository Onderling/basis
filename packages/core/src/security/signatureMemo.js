/**
 * signatureMemo — remember that a signature CHECKED OUT, so the same signed bytes are not verified again and again.
 *
 * Verify-on-read re-checks every stored statement on every read, and a roster re-checks every member's link on every
 * derivation. Pure-JS ed25519 makes that the bulk of a busy device's CPU — measured: most of a walk's busy time, which
 * starved everything else on the event loop (a relay's challenge answered tens of seconds late).
 *
 * THE RULE, and the only thing this caches:
 *   • the pure cryptographic check — (the exact signed bytes, the signature, the public key) → true. Nothing else:
 *     never a binding, an authority, a retirement or a revocation decision; those change over time and stay decided
 *     on every read by their callers.
 *   • keyed by the CONTENT itself, never by a hash the content claims — a statement tampered after it was memoised
 *     is a different key, misses, and is verified (and refused);
 *   • a miss or a false is never stored;
 *   • bounded: least recently used out first.
 */
import { AgentIdentity } from '../identity/AgentIdentity.js';
import { verifyEd25519StrictBatch } from '../crypto/ed25519Strict.js';
import { decode as b64decode } from '../crypto/b64.js';
import { hashHex } from '../hashHex.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

/**
 * The memo's bound, in BYTES of keys held (an entry is ~0.5 KB: the verifier, the key, the signature and the message's
 * sha-256). 8 MiB holds ~16,000 verdicts: a second read of a 9,000-statement log does no check (measured on Frits's
 * phone 2026-11-12: one check is ~61 ms there).
 */
const SIGNATURE_MEMO_MAX_BYTES = param({ key: 'security.signatureMemoMaxBytes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 * 1024 * 1024 });
/** What one entry costs beyond its key's characters (the Map slot), counted so the bound is honest. */
const ENTRY_OVERHEAD_BYTES = 64;

/**
 * Build a memo over the pure signature check. `verify(msg, sig, pubKey)` answers like `AgentIdentity.verify`, but a
 * check that passed once for exactly those bytes, that signature and that key is answered from memory.
 * `verifierFor(name)` is the same for a NAMED verifier (a circle-link proof, a ceremony reveal, a delegation): the name
 * is part of the key, so one verifier's "true" is never another's, even over the same bytes. ONE agent holds one memo
 * and hands it to every rail and check; the only writer is the real check below, after it returned true.
 * @param {object} [o]
 * @param {number} [o.maxBytes]                             the bound, in bytes of keys held
 * @param {(msg: string, sig: string, pubKey: string) => boolean} [o.verify]  the real check (default AgentIdentity.verify)
 * @returns {{ checkBatch: (verifier: string, items: Array<{msg: string, sig: string, pubKey: string}>) => Promise<number>, verify: (msg: string, sig: string, pubKey: string) => boolean, verifierFor: (name: string) => ((msg: string, sig: string, pubKey: string) => boolean), readonly size: number, readonly bytes: number }}
 */
export function createSignatureMemo({ maxBytes = SIGNATURE_MEMO_MAX_BYTES, verify = (m, s, k) => AgentIdentity.verify(m, s, k) } = {}) {
  const ok = new Map();   // key → its cost in bytes
  let bytes = 0;
  const check = (verifier, msg, sig, pubKey) => {
    if (typeof msg !== 'string' || typeof sig !== 'string' || typeof pubKey !== 'string') return verify(msg, sig, pubKey);
    const key = `${verifier}\u0000${pubKey}\u0000${sig}\u0000${hashHex(msg)}`;
    const had = ok.get(key);
    if (had !== undefined) { ok.delete(key); ok.set(key, had); return true; }
    const good = verify(msg, sig, pubKey) === true;
    if (good) remember(key);
    return good;
  };
  function remember(key) {
    if (ok.has(key)) return;
    const cost = key.length * 2 + ENTRY_OVERHEAD_BYTES;
    ok.set(key, cost); bytes += cost;
    while (bytes > maxBytes && ok.size > 1) {
      const [oldest, c] = ok.entries().next().value;
      ok.delete(oldest); bytes -= c;
    }
  }
  const named = new Map();
  /**
   * Check many at once through the strict rule's batch (an async equation never holds the thread) and remember every
   * one that passed, under `verifier` (the same name the synchronous reads will ask with). The batch IS the real check:
   * a false or an error is never remembered. Returns how many were remembered (already-known ones count).
   * @param {string} verifier  'signature' or a named verifier
   * @param {Array<{msg: string, sig: string, pubKey: string}>} items
   */
  async function checkBatch(verifier, items) {
    const list = (Array.isArray(items) ? items : []).filter((it) => typeof it?.msg === 'string' && typeof it?.sig === 'string' && typeof it?.pubKey === 'string');
    const keys = list.map((it) => `${verifier}\u0000${it.pubKey}\u0000${it.sig}\u0000${hashHex(it.msg)}`);
    const todo = [];
    let known = 0;
    keys.forEach((k, i) => { if (ok.has(k)) known += 1; else todo.push(i); });
    if (todo.length === 0) return known;
    const enc = new TextEncoder();
    const asBytes = [];
    const at = [];
    for (const i of todo) {
      try { asBytes.push({ msg: enc.encode(list[i].msg), sig: b64decode(list[i].sig), key: b64decode(list[i].pubKey) }); at.push(i); } catch { /* not decodable: not remembered */ }
    }
    let answers = [];
    try { answers = await verifyEd25519StrictBatch(asBytes); } catch { answers = []; }
    let added = 0;
    at.forEach((i, j) => { if (answers[j] === true) { remember(keys[i]); added += 1; } });
    return known + added;
  }
  return {
    checkBatch,
    verify: (msg, sig, pubKey) => check('signature', msg, sig, pubKey),
    verifierFor(name) {
      if (typeof name !== 'string' || !name || name === 'signature') throw new Error('signatureMemo: a named verifier needs its own name');
      if (!named.has(name)) named.set(name, (msg, sig, pubKey) => check(name, msg, sig, pubKey));
      return named.get(name);
    },
    get size() { return ok.size; },
    get bytes() { return bytes; },
  };
}

/**
 * THE VERDICT MEMO, one level up: remember that EXACTLY this input checked out under a pure check, so the work around
 * the signature (the canonical form, the payload digest, the header hash) is not redone either. A cold start on the
 * Samsung ran the statement check 554 times over 71 distinct statements and the circle-link proof 920 times over 23
 * addresses: the signature was already remembered, the canonical form and the hashes around it were not (~2.7 ms each).
 *
 * The same rule as the signature memo, and the key is the whole input:
 *   • only a pure check whose answer depends on its input alone (a statement's own validity, never an authority);
 *   • the key is the caller's exact input as bytes (`JSON.stringify` of the statement plus what was asked of it), never
 *     a hash the content claims: a copy changed anywhere, or written in another key order, misses and is checked;
 *   • only a pass is stored; a refusal is checked again every time;
 *   • bounded in bytes, least recently used out first.
 * @param {object} [o]
 * @param {number} [o.maxBytes]
 * @returns {{ has: (key: string) => boolean, remember: (key: string) => void, readonly size: number, readonly bytes: number }}
 */
export function createVerdictMemo({ maxBytes = VERDICT_MEMO_MAX_BYTES } = {}) {
  const ok = new Map();   // key → its cost in bytes
  let bytes = 0;
  return {
    has(key) {
      const c = ok.get(key);
      if (c === undefined) return false;
      ok.delete(key); ok.set(key, c);
      return true;
    },
    remember(key) {
      if (typeof key !== 'string' || ok.has(key)) return;
      const cost = key.length * 2 + ENTRY_OVERHEAD_BYTES;
      ok.set(key, cost); bytes += cost;
      while (bytes > maxBytes && ok.size > 1) {
        const [oldest, c] = ok.entries().next().value;
        ok.delete(oldest); bytes -= c;
      }
    },
    get size() { return ok.size; },
    get bytes() { return bytes; },
  };
}

/**
 * The exact key for a verdict: the value's JSON, or null when JSON would make two different inputs look the same (a
 * non-finite number or a value with `toJSON`, both written as something else, an `undefined` inside an array, written
 * as null, or a function, symbol or bigint, which JSON drops or refuses). A null key is never remembered, so such an input is always checked in full.
 * @param {*} value
 * @returns {string|null}
 */
export function exactVerdictKey(value) {
  const LOSSY = {};
  try {
    return JSON.stringify(value, function exact(k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) throw LOSSY;
      if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') throw LOSSY;   // JSON drops or refuses these
      if (v === undefined && Array.isArray(this)) throw LOSSY;
      // `this[k]` is the value before its toJSON ran (a Date, a Buffer): its JSON is not the value itself
      const raw = this?.[k];
      if (raw !== null && typeof raw === 'object' && typeof raw.toJSON === 'function') throw LOSSY;
      return v;
    }) ?? null;
  } catch { return null; }
}

/**
 * The verdict memo's bound, in BYTES of keys held. A statement's key is its JSON (~0.5–2 KB), so 4 MiB holds a few
 * thousand verdicts: every statement a phone reads at a start, several times over.
 */
const VERDICT_MEMO_MAX_BYTES = param({ key: 'security.verdictMemoMaxBytes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 * 1024 * 1024 });

const processVerdictMemos = new Map();
/**
 * The process's verdict memo for one named check ('spine', 'circle-link'): one per check, so one check's pass is never
 * read as another's. In memory only, like the signature memo.
 * @param {string} name
 */
export function processVerdictMemo(name) {
  if (typeof name !== 'string' || !name) throw new Error('processVerdictMemo: a check needs its name');
  if (!processVerdictMemos.has(name)) processVerdictMemos.set(name, createVerdictMemo());
  return processVerdictMemos.get(name);
}

let processMemo = null;
/**
 * THE process's one memo (verify-once, step A): every rail, the chat rail and the named checks (a circle-link proof, a
 * ceremony reveal, a device delegation) use it unless a caller hands its own (a test that counts). One memo per process
 * rather than per agent: a production process holds one agent, and a verdict is a pure fact about bytes, a signature
 * and a key, the same for any agent that asks. In memory only; never persisted, never taken from another device.
 * @returns {ReturnType<typeof createSignatureMemo>}
 */
export function processSignatureMemo() {
  if (!processMemo) processMemo = createSignatureMemo();
  return processMemo;
}
