/**
 * inviteCeiling — how many people ONE invite may admit (B5).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────────────────────────
 * An invite code was redeemable an unlimited number of times. Walked 2026-07-30 (S6/J-A9): 300
 * distinct identities redeemed one live code in 436 ms and the circle grew to 307 members, with no
 * cap, no throttle and nothing anywhere saying the code had been used 300 times. Fine in a test;
 * a liability the day a code leaves the room it was read out in.
 *
 * ── The shape (Frits, 2026-07-30) ───────────────────────────────────────────────────────────────
 * A **circle-level ceiling**, with each invite choosing **within** it — the same three-level shape
 * the disclosure model already uses (default-strict → circle ceiling → system cap), so it is not a
 * new concept to learn:
 *
 *   • **system cap** (`INVITE_REDEMPTION_SYSTEM_CAP`) — nothing, from any circle, on any build, may
 *     admit more than this on one code. It is the value a circle cannot argue with.
 *   • **circle ceiling** (`rules.inviteMaxRedemptions`) — chosen in the create wizard, pre-filled
 *     from the circle kind's template. The most any single invite of this circle may permit.
 *   • **the invite** (`membership-code.source.maxRedemptions`) — chosen when the code is minted,
 *     clamped into `[1, ceiling]`. An invite can be stricter than its circle; never looser.
 *
 * ── Where it is enforced, and why there ─────────────────────────────────────────────────────────
 * At **redemption, on the ISSUER's device** — `verifyMembershipCodeForPeer` (the admin validating a
 * peer's redeem) and `redeemMembershipCode` (the same-store local path). Per the enforceability test
 * (`docs/conventions/enforceability.md`): the joiner's app is not a party we can rely on, so a
 * check in the join wizard would be a convention with a progress bar. The refusal has to come from
 * the side that writes the membership, because that write is the thing being limited.
 *
 * ── Counting DISTINCT identities, not redemptions ───────────────────────────────────────────────
 * The count is over distinct `redeemedBy` on this code's trail, so re-scanning a QR cannot burn the
 * ceiling down. That is the same fact that makes a repeat redeem by the same identity an idempotent
 * success rather than a refusal (see `redeemersOfCode`).
 */

/**
 * The system cap: the most redemptions ANY invite may permit, whatever a circle asks for.
 *
 * 100 is a judgement, not a derivation: it is comfortably above a real neighbourhood circle and
 * comfortably below "a code that leaked can enrol a crowd". Raising it is a one-line change here;
 * lowering it below an existing circle's ceiling silently tightens that circle at its next mint,
 * which is the safe direction.
 */
export const INVITE_REDEMPTION_SYSTEM_CAP = 100;

/**
 * The ceiling for a circle whose rules do not state one — every circle created before 2026-08-02,
 * and any rules blob that lost the field.
 *
 * **This is the transitional value, and it is deliberately not 1.** Strict-by-default is right for a
 * NEW circle (the wizard asks, and the templates answer), but applying it retroactively would make
 * every existing invite a single-use code the moment this shipped — the second member of an existing
 * dev circle would be refused by a rule nobody had ever been shown. 5 is small enough to bound a
 * leak and large enough that no existing circle breaks. → `plans/DECISIONS-FOR-REVIEW.md` 2026-08-02.
 */
export const INVITE_CEILING_FALLBACK = 5;

/** Clamp any number into `[1, INVITE_REDEMPTION_SYSTEM_CAP]`, or null when it is not a usable number. */
function clampToSystem(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 1) return 1;
  return Math.min(i, INVITE_REDEMPTION_SYSTEM_CAP);
}

/**
 * The CIRCLE's ceiling, from its rules blob.
 *
 * @param {object|null|undefined} rules  `group-rules` → `source.rules`
 * @returns {number} 1…INVITE_REDEMPTION_SYSTEM_CAP
 */
export function circleInviteCeiling(rules) {
  return clampToSystem(rules?.inviteMaxRedemptions) ?? INVITE_CEILING_FALLBACK;
}

/**
 * The value an INVITE may carry, given what was asked for and what the circle allows.
 *
 * A request above the ceiling is clamped down rather than refused: the admin minting the code is the
 * same person who set the ceiling, so the honest reading of "give me 50 on a circle capped at 10" is
 * a stale form, not an attack. What must never happen is the invite carrying the larger number.
 *
 * Absent/invalid request ⇒ the ceiling itself. The strictness decision for this circle was already
 * made, once, in the create wizard; asking again per invite would be ceremony.
 *
 * @param {number|undefined|null} requested
 * @param {number} ceiling
 * @returns {number}
 */
export function clampInviteMaxRedemptions(requested, ceiling) {
  const cap = clampToSystem(ceiling) ?? INVITE_CEILING_FALLBACK;
  const want = clampToSystem(requested);
  if (want === null) return cap;
  return Math.min(want, cap);
}

/**
 * What ONE minted code permits, read back off the item.
 *
 * A code minted before 2026-08-02 carries no `maxRedemptions`. Treating that as "unlimited" would
 * keep the bug alive for exactly the codes that are already in the wild, so it reads as the circle's
 * ceiling instead — the strictest interpretation that does not invent a number.
 *
 * @param {object} codeItem   a `membership-code` item
 * @param {number} ceiling    the circle's ceiling (`circleInviteCeiling`)
 * @returns {number}
 */
export function inviteMaxRedemptionsOf(codeItem, ceiling) {
  return clampInviteMaxRedemptions(codeItem?.source?.maxRedemptions, ceiling);
}

/**
 * The DISTINCT identities that have already redeemed one code.
 *
 * Matched on `codeId` when the trail carries it (every peer-path row does) and on the code STRING
 * otherwise, so a same-store local redeem is counted against the same invite. Returns a Map so a
 * caller can both count and ask "is this webid already in?" from one pass.
 *
 * @param {object} a
 * @param {Array<object>} a.redemptions  `membership-redemption` items (any group)
 * @param {string} a.groupId
 * @param {string|null} [a.codeId]
 * @param {string|null} [a.code]
 * @returns {Map<string, object>} redeemer webid → the earliest redemption item for them
 */
export function redeemersOfCode({ redemptions = [], groupId, codeId = null, code = null } = {}) {
  const out = new Map();
  for (const it of Array.isArray(redemptions) ? redemptions : []) {
    const src = it?.source ?? {};
    if (src.groupId !== groupId) continue;
    const sameCode = (codeId && src.codeId === codeId) || (code && src.code === code);
    if (!sameCode) continue;
    const who = typeof src.redeemedBy === 'string' && src.redeemedBy ? src.redeemedBy : null;
    if (!who || out.has(who)) continue;
    out.set(who, it);
  }
  return out;
}

/** The refusal reason an over-ceiling redemption returns. One string, both redeem paths. */
export const INVITE_LIMIT_REACHED = 'invite-redemption-limit-reached';

export default circleInviteCeiling;
