/**
 * spineStatement.js — the GENERIC signed, chained SPINE statement.
 *
 * The SPINE is the class of circle events where equivocation is an attack — governance (proposals/votes),
 * roles (admin promote/demote), membership (join/leave/evict), key rotations. They all ride ONE per-author
 * causal chain (`createAuthorChain`), filterable by `kind`, so each materialised HEAD folds its own subset
 * (the roster head folds membership; a governance head folds proposals/votes; a roles head folds role changes;
 * the `Peer` projection is a head too). CONTENT — chat, tasks, offerings — is NOT spine: forking it is normal,
 * so it rides the ordinary item-store merge, not this chain.
 *
 * WHY (principles): principle 2 (circle state is a signed, peer-replicated append-only log — "verwijderen kun je vragen,
 * niet afdwingen": a transition is a signed REQUEST the fold applies, not a central enforcement), principle 6 (membership
 * is proof-derived + tamper-evident = a signed per-circle key + a per-author hash-chain over membership/key
 * events — this file IS that chain), principle 7 (one record; the roster is a rebuildable materialised head, never a
 * second store), principle 10 (what must be AGREED — who is in, who is admin — is folded identically everywhere;
 * deny-wins). The gate binds at the fold (principle 9), never on the issuer's device.
 *
 * GENERIC + EXTENSIBLE by design: any `kind` — including one a third party adds — signs and verifies the same
 * way here. Only the FOLD is kind-aware. So this primitive never needs to change to support a new spine kind.
 *
 *   content = { v, kind, circleId, subject, payload? }      // subject = who/what the entry is ABOUT
 *   body    = chainEvent(content, { author, parentHash })   // + author · parentHash · hash   (authorChain)
 *   sig     = b64( Ed25519.sign(canonicalize(body)) )       // by the CIRCLE-SCOPED key = author
 *
 *   • `author` is the issuer's circle-scoped signing key (NOT their global identity) — matches the roster,
 *     preserves per-circle unlinkability (principle 5). The caller passes the circle-scoped signer.
 *   • `parentHash` is the issuer's PREVIOUS spine-entry hash (null for their first) — the per-author causal
 *     POSITION (never a wall-clock time, so a clock-skewed device folds the SAME order). Two entries by one
 *     author off the same parent with different content hash differently → a detectable fork the fold resolves.
 *   • `deps` (optional) is the CROSS-AUTHOR frontier — the heads by OTHER authors the issuer had SEEN when
 *     signing (DESIGN-log-ordering-unification §2–4). Normally empty; grows only under genuine concurrency.
 *     It is a chain field: bound into the hash + the signature but EXCLUDED from the content serializer, so a
 *     multi-parent equivocation (same content, different frontier off one self-parent) stays a detectable fork.
 *   • `payload` (optional) carries kind-specific fields (e.g. `{ role: 'admin' }` for a role change); it is
 *     canonicalised into the hash, so it is covered by both the chain hash and the signature.
 *
 * DURABLE + REPLAYABLE: no freshness window. Idempotent: the chain `hash` is a stable id. `verifySpine` proves
 * a genuine, untampered, chain-consistent signature by `body.author`; WHO may issue this kind, and whether a
 * concurrent change voids it, is the fold's authority decision (deny-wins), never decided here.
 */
import { AgentIdentity }       from '../identity/AgentIdentity.js';
import { canonicalize }        from '../Envelope.js';
import { encode as b64encode } from '../crypto/b64.js';
import { createAuthorChain }   from './authorChain.js';

/** Version of the signed spine body — a self-describing namespaced STRING (docs/conventions/signed-bodies.md). */
export const SPINE_STMT_VERSION = 'onderling/spine.v1';

/**
 * Content-selective serializer for `authorChain`: the content fields + a canonicalised payload, and NEVER the
 * chain fields (`author`/`parentHash`/`deps`/`hash`) — so chain-time hashing and the verifier's recompute
 * agree (the authorChain contract; see authorChain.js). The chain fields are authenticated by the signature
 * and the chain hash, but excluding them here is what makes a same-content-different-frontier a detectable fork.
 */
const SPINE_CONTENT = ['v', 'kind', 'circleId', 'subject'];
const spineSerialize = (e) => {
  const base = SPINE_CONTENT.filter((k) => e[k] !== undefined).map((k) => `${k}=${e[k]}`).join('&');
  return e.payload !== undefined ? `${base}&payload=${canonicalize(e.payload)}` : base;
};
const spineChain = createAuthorChain(spineSerialize);

/** Rebuild the content object (no chain fields) from a full body — for the verifier's hash recompute. */
function contentOf(body) {
  const c = { v: body.v, kind: body.kind, circleId: body.circleId, subject: body.subject };
  if (body.payload !== undefined) c.payload = body.payload;
  return c;
}

/**
 * Sign a spine statement of any `kind`. `identity` is the issuer's CIRCLE-SCOPED signer.
 *
 * @param {{ pubKey: string, sign: (bytes: Uint8Array) => Uint8Array }} identity  the circle-scoped signer
 * @param {object} args
 * @param {string} args.kind      the spine event kind (e.g. 'evict' · 'leave' · 'join' · 'role' · 'key')
 * @param {string} args.circleId  the circle the entry applies to
 * @param {string} args.subject   who/what the entry is about (a circle-scoped id, per principle 5)
 * @param {object} [args.payload] kind-specific fields (canonicalised into the hash + signature)
 * @param {string|null} [args.parent]  the issuer's previous spine-entry hash (null for their first)
 * @param {string[]} [args.deps]  the CROSS-AUTHOR frontier the issuer had SEEN (other authors' heads); normally
 *        empty. Bound into the hash + signature, excluded from the content serialization (a fork stays detectable).
 * @returns {{ body: object, sig: string, by: string }}
 */
export function signSpine(identity, { kind, circleId, subject, payload, parent = null, deps = [] } = {}) {
  if (!identity?.pubKey) throw new Error('signSpine: circle-scoped authority identity required');
  if (typeof kind     !== 'string' || !kind)     throw new Error('signSpine: kind required');
  if (typeof circleId !== 'string' || !circleId) throw new Error('signSpine: circleId required');
  if (typeof subject  !== 'string' || !subject)  throw new Error('signSpine: subject required');
  if (payload !== undefined && (payload === null || typeof payload !== 'object')) throw new Error('signSpine: payload must be an object');
  if (parent !== null && (typeof parent !== 'string' || !parent)) throw new Error('signSpine: parent must be a hash string or null');
  if (deps !== undefined && !(Array.isArray(deps) && deps.every((h) => typeof h === 'string' && h))) {
    throw new Error('signSpine: deps must be an array of hash strings');
  }
  const content = { v: SPINE_STMT_VERSION, kind, circleId, subject };
  if (payload !== undefined) content.payload = payload;
  const body = spineChain.chainEvent(content, { author: identity.pubKey, parentHash: parent, deps });
  const sig  = b64encode(identity.sign(canonicalize(body)));
  return { body, sig, by: identity.pubKey };
}

/**
 * Verify a spine statement is a genuine, untampered, chain-consistent signature by `body.author`. NO timestamp
 * window (durable). Does NOT decide authority (who may issue this kind, or whether a concurrent change voids
 * it) — that is the fold's deny-wins decision.
 *
 * @param {{ body: object, sig: string }} statement
 * @param {object} [opts]
 * @param {string} [opts.expectedCircleId]  if given, `body.circleId` must match
 * @param {string} [opts.expectedKind]      if given, `body.kind` must match
 * @returns {{ ok: true, body: object } | { ok: false, reason: string }}
 */
export function verifySpine(statement, opts = {}) {
  const { expectedCircleId, expectedKind } = opts;
  if (!statement || typeof statement !== 'object') return { ok: false, reason: 'malformed statement' };
  const { body, sig } = statement;
  if (typeof sig !== 'string' || !sig)   return { ok: false, reason: 'missing signature' };
  if (!body || typeof body !== 'object') return { ok: false, reason: 'missing body' };
  if (body.v !== SPINE_STMT_VERSION)     return { ok: false, reason: `unsupported version: ${body.v}` };
  if (typeof body.kind !== 'string' || !body.kind)         return { ok: false, reason: 'body.kind required' };
  if (expectedKind && body.kind !== expectedKind)          return { ok: false, reason: 'kind mismatch' };
  if (typeof body.circleId !== 'string' || !body.circleId) return { ok: false, reason: 'body.circleId required' };
  if (typeof body.subject  !== 'string' || !body.subject)  return { ok: false, reason: 'body.subject required' };
  if (typeof body.author   !== 'string' || !body.author)   return { ok: false, reason: 'body.author required' };
  if (body.parentHash !== null && typeof body.parentHash !== 'string') return { ok: false, reason: 'body.parentHash must be a hash string or null' };
  if (body.deps !== undefined && !(Array.isArray(body.deps) && body.deps.every((h) => typeof h === 'string' && h))) {
    return { ok: false, reason: 'body.deps must be an array of hash strings' };
  }
  if (typeof body.hash !== 'string' || !body.hash)         return { ok: false, reason: 'body.hash required' };
  if (expectedCircleId && body.circleId !== expectedCircleId) return { ok: false, reason: 'circle mismatch' };
  // Chain integrity: the hash must recompute from the content + author + parentHash + deps frontier.
  if (spineChain.chainEvent(contentOf(body), { author: body.author, parentHash: body.parentHash, deps: body.deps }).hash !== body.hash) {
    return { ok: false, reason: 'bad chain hash' };
  }
  // The signature must verify against the claimed circle-scoped author over the exact body.
  if (!AgentIdentity.verify(canonicalize(body), sig, body.author)) return { ok: false, reason: 'bad signature' };
  return { ok: true, body };
}
