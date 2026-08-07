/**
 * scopedSchemes — the D2 rule: WHICH seal schemes may have their audience extended by a grant.
 *
 * Extracted 2026-08-03 from `grants/grantsOverPeer.js`, which was deleted. The façade around this rule was
 * built 2026-07-26 and never reached: every interface compiles to `{opId, args}` and hands it to
 * `callSkill`, and the façade sat behind no op, so nothing could call it. Meanwhile the shipping share path
 * solved the narrower problem inline and said why — *"the key resource is the durable record of who holds
 * the key … no extra bookkeeping to drift"* (`apps/basis/src/v2/circleShareEnforcement.js`). That is a
 * decision against a second grant registry, not an oversight.
 *
 * **The RULE outlived the machine.** A deny-by-default gate is worth keeping even when the thing that was
 * going to call it is not — so it lives here, next to the seal schemes it talks about, where the reachable
 * path can use it. The rest of the façade (grant records, mode chooser, serialize/hydrate) is recoverable
 * from `plans/NOTE-grants-over-peer.md` D1–D7 if resource enumeration ever needs it.
 */
import { SEAL_SCHEMES } from '../sealing/sealResolver.js';

export const SCOPED_SEAL_SCHEMES = Object.freeze([SEAL_SCHEMES.PAIRWISE, SEAL_SCHEMES.PER_RESOURCE_CEK]);

/**
 * D2 gate — assert a seal scheme may have its audience extended by a grant. DENY-BY-DEFAULT: an absent /
 * unknown scheme throws rather than defaulting to "allowed", so a caller that forgets to say which scheme
 * it is sealing under cannot silently widen a group-key audience.
 *
 * @param {string|null|undefined} scheme  a `SEAL_SCHEMES` value.
 * @returns {string} the validated scheme.
 * @throws {Error} when the scheme is group-key, sealed-forward, unsealed (null), or missing.
 */
export function assertScopedScheme(scheme) {
  if (scheme === SEAL_SCHEMES.GROUP_KEY) {
    throw new Error(
      'grantsOverPeer: refusing to extend a GROUP-KEY audience (D2) — a grant would hand the grantee every '
      + 'piece of circle content sealed under that key. Seal the resource under a scoped scheme '
      + `(${SCOPED_SEAL_SCHEMES.join(' | ')}) and grant against that.`,
    );
  }
  if (scheme === SEAL_SCHEMES.SEALED_FORWARD) {
    throw new Error('grantsOverPeer: sealed-forward is a delivery scheme, not an at-rest audience — nothing to extend (D2)');
  }
  if (scheme == null) {
    throw new Error(
      'grantsOverPeer: no seal scheme resolved (unsealed p0/p1 content, or none supplied) — pass '
      + '{ scheme } or { policy } naming a scoped scheme (D2, deny-by-default)',
    );
  }
  if (!SCOPED_SEAL_SCHEMES.includes(scheme)) {
    throw new Error(`grantsOverPeer: unknown seal scheme "${scheme}" — a grant may only extend ${SCOPED_SEAL_SCHEMES.join(' | ')} (D2)`);
  }
  return scheme;
}

/**
 * The D2 ROUTER predicate (Frits 2026-08-06) — true iff content under this scheme must LEAVE its audience as a
 * re-sealed COPY rather than an in-place grant. That is EXACTLY `group-key`: an in-place grant of group-key
 * content hands the grantee the one key to the WHOLE audience's content, so a cross-circle or out-of-circle
 * share of it becomes a copy instead. A SCOPED scheme (`PAIRWISE` | `PER_RESOURCE_CEK`) grants only its own
 * per-recipient/per-resource audience → in-place is fine. Absent/unknown/sealed-forward is NEITHER copy nor
 * in-place: it stays REFUSED by the throwing gate (`assertScopedScheme`), deny-by-default — a caller that can't
 * name its scheme must not silently share. Narrow on purpose (group-key only), so nothing else changes.
 * @param {string|null|undefined} scheme  a `SEAL_SCHEMES` value.
 * @returns {boolean}
 */
export function needsCopyToLeaveAudience(scheme) {
  return scheme === SEAL_SCHEMES.GROUP_KEY;
}

/**
 * pick the scheme for a RESOURCE grant from policy. Default = broker (least-authority: key stays home,
 * revoke instant). `policy.offline === true` opts into the per-resource CEK (offline-capable) path.
 * @param {{offline?: boolean}} [policy]
 * @returns {'broker'|'cek'}
 */
