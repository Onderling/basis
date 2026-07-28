// capabilityVerifier.js — the Onderling capability-token verifier satisfying the
// same v0 `verifyToken` contract the gatekeeper injects:
//
//   verifyToken(token) => Promise<{ webId } | null>
//
// PLAN-media-infra-deployment (DECIDED): Onderling capability tokens are the
// PRIMARY media-gate auth; Solid-OIDC (solidVerifier.js) stays as an additional
// verifier — compose the two with `anyVerifier` below.
//
// The token is a signed `CapabilityToken` (`@onderling/core`) as it travels on the
// wire — a JSON string or an already-parsed object; both are accepted. The
// returned actor id is the token's SUBJECT key (the holder — the peer the
// capability was granted to); the gatekeeper's ACL then decides what that
// holder may read.
//
//   createCapabilityVerifier({ verifySignature?, isRevoked?, requiredSkill?,
//                              trustedIssuers?, now? })
//
// Signature verification is REAL by default — `CapabilityToken.verify` checks
// the Ed25519 signature against the token's own issuer key — with
// `verifySignature(raw) => bool` as the injectable seam (same discipline as
// solidVerifier's injected `verifyJwt`), so the orchestration (shape, expiry,
// skill, issuer trust, revocation) is testable without real crypto.
//
// Checks, ALL deny-by-default (any failure / any throw => null, never leaks):
//   1. shape           — the wire fields must be present and well-typed
//   2. signature       — `verifySignature(raw)` must be exactly `true`
//   3. expiry          — `now()` (injectable clock) vs `expiresAt` (unix-ms)
//   4. skill           — `offeringMatches(token.skill, requiredSkill)` (supports
//                        '*' and 'media.*'-style prefixes; default 'media.read')
//   5. issuer trust    — when `trustedIssuers` (the circle's known member/owner
//                        keys) is a non-empty list, `token.issuer` must be in it
//   6. self-issued     — when `requireSelfIssued` (default for media.read on the
//                        deployment), `issuer === subject`: the returned actor is
//                        the key that SIGNED the token, so it is proof-of-
//                        possession of that key — not an attacker-chosen subject.
//                        WHY THIS MATTERS: without it, a valid-sig token with
//                        issuer=Mallory, subject=Alice returns Alice — Mallory
//                        impersonates Alice at the ACL. Self-issued closes that:
//                        forging subject=Alice needs Alice's private key.
//   7. revocation      — when `isRevoked(tokenId)` is injected (e.g.
//                        TokenRegistry#isRevoked), a revoked id denies

import { CapabilityToken, offeringMatches } from '@onderling/core';

const DEFAULT_SKILL = 'media.read';

/** Parse the wire form: JSON string, plain object, or CapabilityToken. Null if neither. */
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
    && typeof raw.agentId === 'string'
    && typeof raw.skill === 'string'
    && typeof raw.expiresAt === 'number'
    && typeof raw.sig === 'string'     && raw.sig.length > 0;
}

/**
 * Normalise the issuer allow-list (mirrors solidVerifier's normalizeIssuers):
 *   - undefined / empty → { mode: 'any' }
 *   - [pubKeys]         → { mode: 'list', set }
 */
function normalizeIssuers(trustedIssuers) {
  if (!Array.isArray(trustedIssuers) || trustedIssuers.length === 0) return { mode: 'any' };
  return { mode: 'list', set: new Set(trustedIssuers) };
}

/**
 * @param {object} opts
 * @param {(raw:object)=>Promise<boolean>|boolean} [opts.verifySignature]
 *        — signature seam; default is the REAL `CapabilityToken.verify` (Ed25519
 *          against the token's issuer key)
 * @param {(tokenId:string)=>Promise<boolean>|boolean} [opts.isRevoked]
 *        — revocation check (e.g. TokenRegistry#isRevoked); default: none
 * @param {string}   [opts.requiredSkill='media.read'] — the skill the gate demands
 * @param {string[]} [opts.trustedIssuers] — allow-list of issuer pubKeys (the
 *        circle's known member/owner keys); default: any issuer whose signature checks
 * @param {boolean} [opts.requireSelfIssued] — require `issuer === subject` so the
 *        actor is proof-of-possession of the signing key (impersonation-safe).
 *        Defaults to TRUE for a `media.read`-style (self-attestation) skill,
 *        FALSE for a wildcard/delegated skill. The media deployment leaves it on.
 * @param {()=>number} [opts.now] — clock (unix-ms) for expiry; default Date.now
 * @returns {(token:string|object)=>Promise<{webId:string}|null>}
 */
export function createCapabilityVerifier({
  verifySignature,
  isRevoked,
  requiredSkill = DEFAULT_SKILL,
  trustedIssuers,
  requireSelfIssued,
  now,
} = {}) {
  // Self-attestation skills (media.read and other non-wildcard exact skills)
  // default to self-issued; an explicit boolean always wins.
  const selfIssued = typeof requireSelfIssued === 'boolean'
    ? requireSelfIssued
    : (requiredSkill !== '*' && !requiredSkill.endsWith('.*'));
  const checkSig = typeof verifySignature === 'function'
    ? verifySignature
    : (raw) => CapabilityToken.verify(raw);
  const allow = normalizeIssuers(trustedIssuers);
  const clock = typeof now === 'function' ? now : () => Date.now();

  return async function verifyToken(token) {
    try {
      // 1. shape — the wire must carry every signed field, well-typed.
      const raw = parseToken(token);
      if (!shapeOk(raw)) return null;

      // 2. signature — only an explicit `true` opens the gate.
      const sigOk = await checkSig(raw);
      if (sigOk !== true) return null;

      // 3. expiry (injectable clock; the default checkSig enforces it too — defensive).
      if (clock() >= raw.expiresAt) return null;

      // 4. skill — the capability must cover what this gate protects.
      if (!offeringMatches(raw.skill, requiredSkill)) return null;

      // 5. issuer trust — when a list is configured, the issuer must be on it.
      if (allow.mode === 'list' && !allow.set.has(raw.issuer)) return null;

      // 6. self-issued — the actor must be the key that signed (impersonation-safe).
      if (selfIssued && raw.issuer !== raw.subject) return null;

      // 7. revocation — when injected, a revoked token id denies.
      if (typeof isRevoked === 'function' && (await isRevoked(raw.id)) === true) return null;

      // The holder — the SUBJECT key — is the actor the gate authorizes.
      return { webId: raw.subject };
    } catch {
      // Deny-by-default: any failure (bad JSON, seam throw) => null. Never leak.
      return null;
    }
  };
}

/**
 * Compose verifiers: the first non-null `{ webId }` wins, all-null denies.
 * Lets the gate accept a capability token OR a Solid-OIDC token:
 *
 *   verifyToken: anyVerifier(createCapabilityVerifier({...}), createSolidVerifier({...}))
 *
 * A verifier that throws is treated as null (deny) and the next one is tried —
 * one broken verifier must not take the whole gate down, nor let anyone in.
 *
 * @param {...(token:any)=>Promise<{webId:string}|null>} verifiers
 * @returns {(token:any)=>Promise<{webId:string}|null>}
 */
export function anyVerifier(...verifiers) {
  const list = verifiers.filter((v) => typeof v === 'function');
  return async function verifyToken(token) {
    for (const verify of list) {
      try {
        const res = await verify(token);
        if (res && res.webId) return res;
      } catch {
        // this verifier denies; try the next
      }
    }
    return null;
  };
}
