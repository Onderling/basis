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
 *   header  = { v: 'onderling/spine.v2', kind, circleId, subject, authorRef, author, parentHash, deps, payloadDigest }
 *   hash    = sha256( canonicalDeep(header) )                // the chain id
 *   sig     = b64( Ed25519.sign(canonicalDeep(header)) )     // by the CIRCLE-SCOPED key = author
 *   body    = header + payload + hash                        // the payload is committed to by its digest
 *   • ONE header, hashed AND signed, in one canonical form sorted at every depth: a TOMBSTONE (the payload dropped,
 *     the header and the signature kept) still proves itself, can be sent on, and a planted one fails; one statement
 *     has one hash whatever order its nested keys came in. `authorRef` (who said it, in ref space) is in the header.
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
import { exactVerdictKey, processSignatureMemo, processVerdictMemo } from './signatureMemo.js';
import { encode as b64encode } from '../crypto/b64.js';
import { hashHex }             from '../hashHex.js';

/** Version of the signed spine body — a self-describing namespaced STRING (docs/conventions/signed-bodies.md). */
export const SPINE_STMT_VERSION = 'onderling/spine.v2';

/**
 * ONE canonical form, sorted at EVERY depth (today's envelope `canonicalize` sorts the top level only): the same
 * statement is the same bytes, whatever order its nested payload keys were written in. Arrays keep their order;
 * `undefined` members are left out as JSON leaves them out.
 * @param {*} value
 * @returns {string}
 */
export function canonicalDeep(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalDeep(v === undefined ? null : v)).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalDeep(value[k])}`).join(',')}}`;
}

/** The digest the header commits the payload by (absent payload = the digest of null). */
export function payloadDigestOf(payload) { return hashHex(canonicalDeep(payload === undefined ? null : payload)); }

const canonDeps = (deps) => (Array.isArray(deps) ? [...new Set(deps.filter((h) => typeof h === 'string' && h))].sort() : []);

/**
 * THE HEADER (format v2): what the chain hash and the signature are BOTH over. It commits to the payload by its
 * digest, so a statement whose payload was removed (a TOMBSTONE) still proves itself: header + signature check, and
 * the header still names who said it (`authorRef`). `deps` is the cross-author frontier, sorted.
 */
function headerOf(body) {
  return {
    v: body.v, kind: body.kind, circleId: body.circleId, subject: body.subject,
    authorRef: typeof body.authorRef === 'string' ? body.authorRef : null,
    author: body.author, parentHash: body.parentHash ?? null, deps: canonDeps(body.deps), payloadDigest: body.payloadDigest,
  };
}

/** The exact bytes (as a string) a spine statement's signature and chain hash are over: its canonical header. */
export function spineSignedMessage(body) { return canonicalDeep(headerOf(body ?? {})); }

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
  const d = canonDeps(deps);
  const header = headerOf({
    v: SPINE_STMT_VERSION, kind, circleId, subject,
    authorRef: typeof payload?.authorRef === 'string' ? payload.authorRef : null,
    author: identity.pubKey, parentHash: parent, deps: d, payloadDigest: payloadDigestOf(payload),
  });
  const signed = canonicalDeep(header);
  const body = { ...header, ...(payload !== undefined ? { payload } : {}), hash: hashHex(signed) };
  if (!d.length) delete body.deps;   // the body keeps its old shape: no deps field when there is no frontier
  const sig  = b64encode(identity.sign(signed));
  return { body, sig, by: identity.pubKey };
}

/**
 * The verdict memo's key for a statement checked with these expectations: what was asked, then the statement's exact
 * content (`exactVerdictKey`); null when the content cannot be keyed exactly (then it is always checked in full).
 * One function, so a rail that asks "is this one known already?" asks with the key the check remembers.
 * @param {object} statement
 * @param {{expectedCircleId?: string, expectedKind?: string}} [o]
 * @returns {string|null}
 */
export function spineVerdictKey(statement, { expectedCircleId, expectedKind } = {}) {
  const exact = exactVerdictKey(statement);
  return exact === null ? null : `${expectedCircleId ?? ''}\u0000${expectedKind ?? ''}\u0000${exact}`;
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
 * @param {(msg: string, sig: string, pubKey: string) => boolean} [opts.verifySignature]  the pure signature check —
 *   default: the process's memo under the verifier name 'spine' (`processSignatureMemo`); a test that counts passes its own
 * @returns {{ ok: true, body: object } | { ok: false, reason: string }}
 */
export function verifySpine(statement, opts = {}) {
  const { expectedCircleId, expectedKind } = opts;
  if (!statement || typeof statement !== 'object') return { ok: false, reason: 'malformed statement' };
  // THE VERDICT MEMO: a statement that passed, asked exactly the same, passes again without the canonical form and the
  // hashes (a read of a lane re-checks every stored statement). Keyed by the statement's whole content and what was asked
  // of it; only a pass is remembered; a caller that brings its own signature check is never answered from memory.
  const memo = opts.verdictMemo ?? (opts.verifySignature ? null : processVerdictMemo('spine'));
  const key = memo ? spineVerdictKey(statement, { expectedCircleId, expectedKind }) : null;
  if (key && memo.has(key)) return { ok: true, body: statement.body };
  const r = verifySpineUncached(statement, { expectedCircleId, expectedKind, verifySignature: opts.verifySignature ?? processSignatureMemo().verifierFor('spine') });
  if (r.ok && key) memo.remember(key);
  return r;
}

function verifySpineUncached(statement, { expectedCircleId, expectedKind, verifySignature }) {
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
  if (typeof body.payloadDigest !== 'string' || !body.payloadDigest) return { ok: false, reason: 'body.payloadDigest required' };
  if (body.authorRef !== null && body.authorRef !== undefined && typeof body.authorRef !== 'string') return { ok: false, reason: 'body.authorRef must be a string or null' };
  if (expectedCircleId && body.circleId !== expectedCircleId) return { ok: false, reason: 'circle mismatch' };
  // The payload the header commits to: present → its digest must match and its authorRef must be the header's; absent →
  // only a TOMBSTONE may lack it (its header still proves itself), else it is the digest of nothing.
  if (statement.tombstone === true) {
    // a TOMBSTONE keeps at most `{ authorRef }` as its payload (what the chain walks read), and it must be the header's
    if (body.payload !== undefined) {
      const keys = body.payload && typeof body.payload === 'object' ? Object.keys(body.payload) : null;
      if (!keys || keys.length !== 1 || keys[0] !== 'authorRef' || body.payload.authorRef !== (body.authorRef ?? null)) {
        return { ok: false, reason: 'a tombstone keeps its authorRef only' };
      }
    }
  } else if (body.payload !== undefined) {
    if (payloadDigestOf(body.payload) !== body.payloadDigest) return { ok: false, reason: 'payload does not match its digest' };
    const ref = typeof body.payload?.authorRef === 'string' ? body.payload.authorRef : null;
    if (ref !== (body.authorRef ?? null)) return { ok: false, reason: 'authorRef does not match the header' };
  } else if (body.payloadDigest !== payloadDigestOf(undefined)) {
    return { ok: false, reason: 'payload missing' };
  }
  // ONE header, hashed and signed: the chain hash recomputes from it, and the author's signature is over it.
  const signed = canonicalDeep(headerOf(body));
  if (hashHex(signed) !== body.hash) return { ok: false, reason: 'bad chain hash' };
  if (!verifySignature(signed, sig, body.author)) return { ok: false, reason: 'bad signature' };
  return { ok: true, body };
}
