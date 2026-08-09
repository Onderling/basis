/**
 * evictionStatement.js — eviction is the `evict` KIND of the generic spine statement.
 *
 * Thin, named wrappers over `spineStatement.js` (signSpine/verifySpine) so the eviction call sites read for
 * what they do. Eviction carries no kind-specific payload — `subject` IS the evicted member. All the substance
 * (the per-author chain, the circle-scoped signer, the durable/replayable semantics, WHO-may-evict staying the
 * fold's deny-wins decision) lives in the generic primitive; see spineStatement.js.
 */
import { signSpine, verifySpine, SPINE_STMT_VERSION } from './spineStatement.js';

/** The spine kind for a member eviction. */
export const EVICTION_KIND = 'evict';

/**
 * Sign an eviction (the `evict` spine kind). `identity` is the issuer's CIRCLE-SCOPED signer.
 * @param {{ pubKey: string, sign: Function }} identity
 * @param {{ circleId: string, evicted: string, parent?: string|null }} args  `evicted` = the evicted member's
 *        circle-scoped id (never a global webid, per principle 5); `parent` = the issuer's previous spine head hash.
 * @returns {{ body: object, sig: string, by: string }}
 */
export function signEviction(identity, { circleId, evicted, parent = null } = {}) {
  if (typeof evicted !== 'string' || !evicted) throw new Error('signEviction: evicted required');
  return signSpine(identity, { kind: EVICTION_KIND, circleId, subject: evicted, parent });
}

/**
 * Verify an eviction statement — a genuine, untampered, chain-consistent `evict`-kind signature. Durable; does
 * NOT decide whether the author may evict, nor whether a concurrent demotion voids it (the fold's job).
 * On success, `res.body.subject` is the evicted member.
 * @param {{ body: object, sig: string }} statement
 * @param {{ expectedCircleId?: string }} [opts]
 * @returns {{ ok: true, body: object } | { ok: false, reason: string }}
 */
export function verifyEviction(statement, opts = {}) {
  return verifySpine(statement, { ...opts, expectedKind: EVICTION_KIND });
}

// Back-reference for call sites that pin the wire version; eviction rides the spine body version.
export const EVICTION_STMT_VERSION = SPINE_STMT_VERSION;
