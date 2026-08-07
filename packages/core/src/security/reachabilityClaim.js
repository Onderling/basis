/**
 * reachabilityClaim.js — signed "who I can reach directly" claims.
 *
 * The producer signs a body { v, i, p, t, s } with their Ed25519 key.
 * The consumer verifies, checks the monotonic sequence `s` against the
 * last accepted value from the same issuer, and anchors the TTL `t`
 * against its *own* local wall-clock on receipt — so clock skew between
 * issuer and receiver is structurally irrelevant.
 *
 * See Design-v3/oracle-bridge-selection.md §2 and §10 (T1 decisions).
 *
 * Signed body shape:
 *   {
 *     v: 'onderling/reachability.v1', // protocol version (self-describing string)
 *     i: '<issuer-pubkey-b64url>', // Ed25519 pubkey of signer
 *     p: ['<pk1>','<pk2>',...],    // sorted lexicographically
 *     t: 300000,                   // ttlMs (relative, receiver-anchored)
 *     s: 1716450000000             // monotonic sequence from issuer
 *   }
 *
 * Full claim on the wire:
 *   { body, sig }    — sig is base64url Ed25519 over canonicalize(body)
 */

import { AgentIdentity }        from '../identity/AgentIdentity.js';
import { canonicalize }          from '../Envelope.js';
import { encode as b64encode }   from '../crypto/b64.js';

/**
 * Version (`v` field) of the signed reachability-claim body — a self-describing, namespaced STRING so an
 * independent implementation knows the exact shape without our source (docs/conventions/signed-bodies.md).
 * Signing writes it; `verifyReachabilityClaim` rejects any other version.
 */
export const CLAIM_VERSION = 'onderling/reachability.v1';

/** Sane consumer-side defaults. Callers can pass their own limits. */
export const DEFAULT_VERIFY_LIMITS = Object.freeze({
  maxPeers:  256,
  maxTtlMs:  10 * 60_000,
  maxBytes:  256 * 1024,
});

// ── Sequence store ───────────────────────────────────────────────────────────

/**
 * Minimal monotonic-sequence store, async-friendly. Backed by any durable
 * key-value; defaults to an in-memory counter seeded with Date.now() on the
 * first sign.
 *
 * @returns {{ read: () => Promise<number>, write: (n: number) => Promise<void> }}
 */
export function createMemorySeqStore(initial = 0) {
  let current = initial;
  return {
    read:  async () => current,
    write: async (n) => { current = n; },
  };
}

// ── Sign ─────────────────────────────────────────────────────────────────────

/**
 * Sign a reachability claim. The issuer's pubKey is read from the identity.
 *
 * @param {import('../identity/AgentIdentity.js').AgentIdentity} identity
 * @param {string[]} peerPubKeys   — base64url Ed25519 pubkeys of direct peers
 * @param {object}  opts
 * @param {number}  [opts.ttlMs=300000]
 * @param {object}  [opts.seqStore]  — { read(), write(n) }; defaults to an
 *                                      in-memory store seeded with Date.now()
 *                                      on first call.
 * @returns {Promise<{ body: object, sig: string }>}
 */
export async function signReachabilityClaim(identity, peerPubKeys, opts = {}) {
  if (!identity?.pubKey)  throw new Error('signReachabilityClaim: identity required');
  if (!Array.isArray(peerPubKeys)) throw new Error('signReachabilityClaim: peerPubKeys must be an array');

  const ttlMs    = opts.ttlMs ?? 5 * 60_000;
  const seqStore = opts.seqStore ?? _getDefaultSeqStore(identity.pubKey);

  // Deterministic peer order is part of the signed surface.
  const p = [...peerPubKeys].sort();

  // Monotonic s: never reverts, even if the wall clock jumps backwards.
  const prevSeq = await seqStore.read();
  const s       = Math.max(Date.now(), prevSeq + 1);
  await seqStore.write(s);

  const body = {
    v: CLAIM_VERSION,
    i: identity.pubKey,
    p,
    t: ttlMs,
    s,
  };

  const sigBytes = identity.sign(canonicalize(body));
  return { body, sig: b64encode(sigBytes) };
}

// Per-pubKey default stores, so two Agents sharing this module don't
// interfere with each other's sequences.
const _defaultStores = new Map();
function _getDefaultSeqStore(pubKey) {
  let store = _defaultStores.get(pubKey);
  if (!store) {
    store = createMemorySeqStore(0);
    _defaultStores.set(pubKey, store);
  }
  return store;
}

// ── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a reachability claim in-place. Does NOT mutate `lastSeenSeq` —
 * callers take `newLastSeq` on success and store it themselves.
 *
 * @param {{ body: object, sig: string }} claim
 * @param {object} opts
 * @param {string}  opts.expectedIssuer     — pubKey we expect the claim to be from
 * @param {number}  [opts.lastSeenSeq]      — highest `s` we've previously accepted from this issuer
 * @param {number}  [opts.maxPeers]         — cap on |p|    (default 256)
 * @param {number}  [opts.maxTtlMs]         — cap on t      (default 10 min)
 * @param {number}  [opts.maxBytes]         — cap on serialised body size (default 256 KB)
 * @returns {{ ok: true, newLastSeq: number } | { ok: false, reason: string }}
 */
export function verifyReachabilityClaim(claim, opts = {}) {
  const {
    expectedIssuer,
    lastSeenSeq,
    maxPeers = DEFAULT_VERIFY_LIMITS.maxPeers,
    maxTtlMs = DEFAULT_VERIFY_LIMITS.maxTtlMs,
    maxBytes = DEFAULT_VERIFY_LIMITS.maxBytes,
  } = opts;

  if (!expectedIssuer) {
    return { ok: false, reason: 'expectedIssuer required' };
  }
  if (!claim || typeof claim !== 'object' || !claim.body || typeof claim.sig !== 'string') {
    return { ok: false, reason: 'malformed claim shape' };
  }

  const body = claim.body;

  // 1. Version
  if (body.v !== CLAIM_VERSION) {
    return { ok: false, reason: `unsupported version: ${body.v}` };
  }

  // 2. Structural shape
  if (typeof body.i !== 'string'
      || !Array.isArray(body.p)
      || typeof body.t !== 'number'
      || typeof body.s !== 'number') {
    return { ok: false, reason: 'body missing required fields' };
  }

  // 3. Reflection guard
  if (body.i !== expectedIssuer) {
    return { ok: false, reason: 'issuer mismatch' };
  }

  // 4. Size / TTL caps
  if (body.p.length > maxPeers) {
    return { ok: false, reason: `peers list too large: ${body.p.length} > ${maxPeers}` };
  }
  if (body.t <= 0 || body.t > maxTtlMs) {
    return { ok: false, reason: `ttl out of range: ${body.t}` };
  }

  // 5. Sort-order determinism guard — the signed `p` must already be sorted.
  for (let i = 1; i < body.p.length; i++) {
    if (body.p[i - 1] >= body.p[i]) {
      return { ok: false, reason: 'peers list not strictly sorted' };
    }
  }

  // 6. Serialised payload size
  const canonical = canonicalize(body);
  if (canonical.length > maxBytes) {
    return { ok: false, reason: `payload too large: ${canonical.length} > ${maxBytes}` };
  }

  // 7. Replay guard
  if (lastSeenSeq != null && body.s <= lastSeenSeq) {
    return { ok: false, reason: `replay: s=${body.s} ≤ lastSeenSeq=${lastSeenSeq}` };
  }

  // 8. Signature
  if (!AgentIdentity.verify(canonical, claim.sig, body.i)) {
    return { ok: false, reason: 'bad signature' };
  }

  return { ok: true, newLastSeq: body.s };
}
