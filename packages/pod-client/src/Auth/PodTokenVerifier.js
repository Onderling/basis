// PodTokenVerifier.js — the pod-SIDE, scope-aware verifier for signed
// `PodCapabilityToken`s (`@onderling/core`).  This is the ENFORCING half of pod
// credential delegation: given a request (op + path) it decides whether a
// presented token actually authorizes that request, deny-by-default.
//
// R2b.0 (PLAN-companion-node-remote-hosting.md §R2b): NO pod honours a
// `PodCapabilityToken` today — issue / verify / matchesScope / verifyChain live
// in core, `CapabilityAuth` `pod-direct` presents the Bearer, but nothing on the
// pod side checks scope/expiry/revocation. This is that missing check. It runs
// IN-PROCESS (the companion's dev client) — real scope/expiry/revocation
// enforcement, but NOT a network-adversary boundary (that arrives with a real
// HTTP pod / R3). It is the exact code path R3 reuses.
//
// This CLONES `packages/blob-gateway/src/adapters/capabilityVerifier.js`'s
// deny-by-default orchestration, retargeted from `CapabilityToken` (skill-scoped)
// to `PodCapabilityToken` (path-scoped): `offeringMatches` → `matchesScope` against
// a request-derived `requiredScope`.
//
// Trust model — INVERTED from blob-gateway's self-attestation. Pod delegation is
// OWNER-ISSUED: issuer = the pod owner (the device), subject = the host the owner
// delegated to. So `requireSelfIssued` is WRONG here (issuer !== subject by
// design). Instead, issuer trust is an injectable seam — the owner-issued model
// passes `isTrusted: (issuer) => issuer === ownerPubKey` (or `trustedIssuers:
// [ownerPubKey]`). Absent a seam, any issuer whose signature checks is accepted.
//
// Checks, ALL deny-by-default (any failure / any throw => null, never leaks):
//   1. shape        — the signed wire fields must be present and well-typed
//   2. signature+   — `PodCapabilityToken.verify(raw, expectedPod)` must be
//      expiry+pod      exactly `true` (Ed25519 sig against the token's own
//                      issuer key + expiry + optional pod binding). Injectable
//                      via `verifySignature(raw, expectedPod)`.
//   3. expiry       — `now()` (injectable clock) vs `expiresAt` (unix-ms).
//                     Defensive + gives an injectable expiry seam even though
//                     the default checkSig enforces expiry against real time.
//   4. issuer trust — when a trust seam is provided (`isTrusted` predicate or a
//                     non-empty `trustedIssuers` list), `token.issuer` must pass.
//   5. scope        — some `token.scopes[i]` must COVER `requiredScope` via
//                     `PodCapabilityToken.matchesScope` (prefix-strict path +
//                     action, `pod.*` wildcard). This is the retargeted check.
//   6. revocation   — when `isRevoked(tokenId)` is injected (e.g.
//                     PodTokenRegistry#isRevoked), a revoked id denies.
//
// On success returns the verified actor: `{ subject, scopes, expiresAt, issuer,
// id }` — `subject` is the host key the capability was granted to; the caller's
// gate lets that host act within `scopes`.

import { PodCapabilityToken } from '@onderling/core';

/** Parse the wire form: JSON string, plain object, or PodCapabilityToken. Null if neither. */
function parseToken(token) {
  if (!token) return null;
  if (typeof token === 'string') {
    const s = token.trim();
    if (!s.startsWith('{')) return null;
    return JSON.parse(s); // throw => caught by the caller => deny
  }
  if (typeof token !== 'object') return null;
  if (typeof token.toJSON === 'function') return token.toJSON();
  return token;
}

/** The wire shape — every field the signature covers must be present and typed. */
function shapeOk(raw) {
  return !!raw && typeof raw === 'object'
    && typeof raw.id === 'string'      && raw.id.length > 0
    && typeof raw.issuer === 'string'  && raw.issuer.length > 0
    && typeof raw.subject === 'string' && raw.subject.length > 0
    && typeof raw.pod === 'string'     && raw.pod.length > 0
    && Array.isArray(raw.scopes)       && raw.scopes.length > 0
    && typeof raw.expiresAt === 'number'
    && typeof raw.sig === 'string'     && raw.sig.length > 0;
}

/**
 * Build the issuer-trust predicate from the injected seam(s):
 *   - `isTrusted` predicate wins if supplied.
 *   - else a non-empty `trustedIssuers` list → membership test.
 *   - else no restriction (any issuer whose signature checks).
 */
function makeTrustCheck({ isTrusted, trustedIssuers }) {
  if (typeof isTrusted === 'function') return isTrusted;
  if (Array.isArray(trustedIssuers) && trustedIssuers.length > 0) {
    const set = new Set(trustedIssuers);
    return (issuer) => set.has(issuer);
  }
  return null; // no trust restriction configured
}

/** Does any granted scope on the token cover `requiredScope`? */
function scopeCovered(scopes, requiredScope) {
  for (const granted of scopes) {
    if (PodCapabilityToken.matchesScope(granted, requiredScope)) return true;
  }
  return false;
}

/**
 * Build a deny-by-default verifier for `PodCapabilityToken`s: checks shape, signature/expiry/pod
 * binding, issuer trust, scope coverage, and revocation in order, resolving to the verified actor
 * `{ subject, scopes, expiresAt, issuer, id }` — or null on ANY failure (errors never propagate).
 *
 * @param {object} [opts]
 * @param {(issuer:string)=>Promise<boolean>|boolean} [opts.isTrusted]
 *        — issuer-trust predicate; the owner-issued model passes
 *          `(i) => i === ownerPubKey`.
 * @param {string[]} [opts.trustedIssuers]
 *        — allow-list of issuer pubKeys (alternative to `isTrusted`).
 * @param {(tokenId:string)=>Promise<boolean>|boolean} [opts.isRevoked]
 *        — revocation check (e.g. PodTokenRegistry#isRevoked); default: none.
 * @param {(raw:object, expectedPod?:string)=>Promise<boolean>|boolean} [opts.verifySignature]
 *        — signature/expiry/pod seam; default is the REAL
 *          `PodCapabilityToken.verify` (Ed25519 against the token's issuer key).
 * @param {()=>number} [opts.now] — clock (unix-ms) for expiry; default Date.now.
 * @returns {(req:{token:string|object, requiredScope:string, expectedPod?:string})
 *            => Promise<{subject:string, scopes:string[], expiresAt:number, issuer:string, id:string}|null>}
 */
export function createPodTokenVerifier({
  isTrusted,
  trustedIssuers,
  isRevoked,
  verifySignature,
  now,
} = {}) {
  const checkSig = typeof verifySignature === 'function'
    ? verifySignature
    : (raw, expectedPod) => PodCapabilityToken.verify(raw, expectedPod);
  const trustCheck = makeTrustCheck({ isTrusted, trustedIssuers });
  const clock = typeof now === 'function' ? now : () => Date.now();

  return async function verify({ token, requiredScope, expectedPod } = {}) {
    try {
      // 1. shape — the wire must carry every signed field, well-typed.
      const raw = parseToken(token);
      if (!shapeOk(raw)) return null;

      // requiredScope must itself be a usable scope string.
      if (typeof requiredScope !== 'string' || requiredScope.length === 0) return null;

      // 2. signature + expiry + pod binding — only an explicit `true` opens the gate.
      const sigOk = await checkSig(raw, expectedPod);
      if (sigOk !== true) return null;

      // 3. expiry (injectable clock; the default checkSig enforces it too — defensive).
      if (clock() >= raw.expiresAt) return null;

      // 4. issuer trust — when a seam is configured, the issuer must pass.
      if (trustCheck && (await trustCheck(raw.issuer)) !== true) return null;

      // 5. scope — some granted scope must cover what this request needs.
      if (!scopeCovered(raw.scopes, requiredScope)) return null;

      // 6. revocation — when injected, a revoked token id denies.
      if (typeof isRevoked === 'function' && (await isRevoked(raw.id)) === true) return null;

      // The verified actor — the SUBJECT (the host) may act within `scopes`.
      return {
        subject:   raw.subject,
        scopes:    [...raw.scopes],
        expiresAt: raw.expiresAt,
        issuer:    raw.issuer,
        id:        raw.id,
      };
    } catch {
      // Deny-by-default: any failure (bad JSON, seam throw) => null. Never leak.
      return null;
    }
  };
}

/**
 * Map a pod request `(op, path)` to the `requiredScope` string the verifier
 * checks against a token's granted scopes.  This is the only genuinely-new
 * logic in R2b.0 — pure + small.
 *
 *   read   → `pod.read:<path>`
 *   list   → `pod.read:<path>`   (listing a container is a read)
 *   write  → `pod.write:<path>`
 *   delete → `pod.delete:<path>`
 *
 * The `<path>` is passed through verbatim; `matchesScope` decides container-
 * prefix vs exact-resource coverage against the token's granted scope.
 *
 * @param {'read'|'list'|'write'|'delete'} op
 * @param {string} path — pod-relative resource path (e.g. `/notes/recipes.md`)
 * @returns {string} the required scope string
 * @throws if `op` is unknown or `path` is not a non-empty string
 */
const OP_TO_ACTION = { read: 'read', list: 'read', write: 'write', delete: 'delete' };

/**
 * Map a pod request `(op, path)` to the required scope string checked by the verifier:
 * `read`/`list` → `pod.read:<path>`, `write` → `pod.write:<path>`, `delete` → `pod.delete:<path>`.
 * The path is passed through verbatim; throws on an unknown op or a non-string/empty path.
 * @param {'read'|'list'|'write'|'delete'} op
 * @param {string} path — pod-relative resource path (e.g. `/notes/recipes.md`)
 * @returns {string} the required scope string
 */
export function scopeForRequest(op, path) {
  const action = OP_TO_ACTION[op];
  if (!action) throw new Error(`scopeForRequest: unknown op '${String(op)}'`);
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('scopeForRequest: path must be a non-empty string');
  }
  return `pod.${action}:${path}`;
}
