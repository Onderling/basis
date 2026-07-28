/**
 * @onderling/secure-agent — signed WebID↔pubKey claims.
 *
 * Wires A.2 from the v0.7 security roadmap.  A claim is a small,
 * Ed25519-signed JSON object that binds:
 *
 *   webid    →  pubKey  (the agent's stable signing identity)
 *            →  nknAddr (optional — current transport address)
 *
 * Published by the WebID owner to their pod (e.g. as a JSON file at
 * `<pod>/onderling/identity/claim.json`).  A peer that resolves a WebID
 * fetches the claim, verifies the signature against the embedded
 * pubKey, and only THEN treats `nknAddr` as authoritative.
 *
 * Without this binding, an attacker who controls a WebID's pod can
 * point peers to ANY NKN address.  With it, they can only point to
 * addresses they hold the private key for — i.e. their own agent.
 *
 * # Wire format
 *
 * Canonical-JSON over a sorted object:
 *
 *   { v: 1, webid, pubKey, nknAddr?, ts, exp }
 *
 * Plus a sibling `sig` field (base64url Ed25519 over the canonical
 * form WITHOUT `sig`).  When deserialising, peel off `sig` first,
 * canonicalise the rest, verify against `pubKey`.
 *
 * Layer: substrate.  Platform-neutral.
 */

import {
  AgentIdentity,
  canonicalize,
  b64encode,
  b64decode,
} from '@onderling/core';

export const CLAIM_VERSION   = 1;
export const DEFAULT_TTL_MS  = 7 * 24 * 60 * 60 * 1000;   // 7 days

/**
 * Sign a WebID claim.
 *
 * @param {AgentIdentity} identity   the signing identity (its pubKey
 *                                   is recorded in the claim body)
 * @param {object} args
 * @param {string} args.webid        the WebID being claimed
 * @param {string} [args.nknAddr]    current transport address, optional
 * @param {number} [args.ttlMs]      claim lifetime; default 7 days
 * @param {number} [args.now]        clock override (tests)
 * @returns {{ v, webid, pubKey, nknAddr?, ts, exp, sig }}
 */
export function signClaim(identity, args = {}) {
  if (!identity?.pubKey || typeof identity.sign !== 'function') {
    throw new Error('signClaim: identity with .sign() required');
  }
  if (typeof args.webid !== 'string' || !args.webid) {
    throw new Error('signClaim: webid (string) required');
  }
  const now   = typeof args.now === 'number' ? args.now : Date.now();
  const ttl   = typeof args.ttlMs === 'number' ? args.ttlMs : DEFAULT_TTL_MS;
  const body  = {
    v:      CLAIM_VERSION,
    webid:  args.webid,
    pubKey: identity.pubKey,
    ts:     now,
    exp:    now + ttl,
  };
  if (typeof args.nknAddr === 'string' && args.nknAddr) {
    body.nknAddr = args.nknAddr;
  }
  const sigBytes = identity.sign(canonicalize(body));
  return { ...body, sig: b64encode(sigBytes) };
}

/**
 * Verify a signed WebID claim.
 *
 * Returns `{ ok: true, body }` on success.  On failure returns
 * `{ ok: false, reason }` with a stable string code for callers
 * that want to branch on the failure mode.
 *
 * Failure codes (stable strings — apps can switch on these):
 *   'bad-shape'  — required field missing
 *   'bad-sig'    — Ed25519 verification failed
 *   'expired'    — exp < now
 *   'future-ts'  — ts > now + clockSkewMs (rejecting clock-future claims)
 *
 * @param {object} claim
 * @param {object} [opts]
 * @param {number} [opts.now]            clock override
 * @param {number} [opts.clockSkewMs]    accepted future skew; default 10 min
 * @returns {{ ok: true, body: object } | { ok: false, reason: string }}
 */
export function verifyClaim(claim, opts = {}) {
  if (!claim || typeof claim !== 'object') {
    return { ok: false, reason: 'bad-shape' };
  }
  const { sig, ...body } = claim;
  if (typeof sig !== 'string' || !sig)               return { ok: false, reason: 'bad-shape' };
  if (body.v !== CLAIM_VERSION)                       return { ok: false, reason: 'bad-shape' };
  if (typeof body.webid !== 'string' || !body.webid)  return { ok: false, reason: 'bad-shape' };
  if (typeof body.pubKey !== 'string' || !body.pubKey) return { ok: false, reason: 'bad-shape' };
  if (typeof body.ts !== 'number' || !Number.isFinite(body.ts))   return { ok: false, reason: 'bad-shape' };
  if (typeof body.exp !== 'number' || !Number.isFinite(body.exp)) return { ok: false, reason: 'bad-shape' };

  const now  = typeof opts.now === 'number' ? opts.now : Date.now();
  const skew = typeof opts.clockSkewMs === 'number' ? opts.clockSkewMs : 10 * 60_000;
  if (body.ts > now + skew) return { ok: false, reason: 'future-ts' };
  if (body.exp < now)       return { ok: false, reason: 'expired' };

  let sigBytes;
  try { sigBytes = b64decode(sig); }
  catch { return { ok: false, reason: 'bad-sig' }; }

  if (!AgentIdentity.verify(canonicalize(body), sigBytes, body.pubKey)) {
    return { ok: false, reason: 'bad-sig' };
  }
  return { ok: true, body };
}

/**
 * Serialize a signed claim to a JSON string suitable for pod-writing.
 * Round-trip stable: `parseClaim(serializeClaim(c))` produces an
 * object equal to `c`.
 *
 * @param {object} claim
 * @returns {string}
 */
export function serializeClaim(claim) {
  return JSON.stringify(claim);
}

/**
 * Parse a JSON string into a claim object.  Throws on invalid JSON.
 * Does NOT verify the signature; pass the result to verifyClaim().
 *
 * @param {string} str
 * @returns {object}
 */
export function parseClaim(str) {
  return JSON.parse(str);
}
