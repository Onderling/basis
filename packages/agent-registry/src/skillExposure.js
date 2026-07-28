/**
 * skillExposure — which of an agent's skills are ADVERTISED, per circle.
 *
 * ── What this is, and what it deliberately is NOT ────────────────────────────────────────────────────
 * Exposure is a **discovery filter**, not access control. Hiding a skill removes it from the cards and
 * catalogs other people read; it does not — and cannot — stop a dispatch. Someone running a modified
 * client who already knows the skill id can call it anyway, so presenting "hidden" as protection would
 * be a lie in the UI (the enforceability test, CLAUDE.md). What actually holds is the **grant/token
 * check at dispatch** (`grants[]` + `CapabilityToken`): that is where an unauthorised call is refused,
 * and it is unchanged by anything here.
 *
 * So the honest framing, which the surfaces must repeat: *this decides what people SEE, not what they
 * may DO.*
 *
 * ── Who decides (Frits, 2026-07-29) ──────────────────────────────────────────────────────────────────
 * Two tiers, composing rather than competing — the same shape as default-strict + circle-ceiling:
 *
 *   1. **The OWNER decides the agent's own policy.** Ownership is the owner KEY: the agent stores the
 *      owner's public key (`ownerFingerprint` on the registry entry, bound at provisioning) and an
 *      agent-wide change must be signed by it. This is what answers *"who owns an agent that sits in
 *      no circle?"* — the key does, with no circle involved. Handover is a signed rotation.
 *   2. **A circle can only narrow, never widen.** A circle admin may HIDE one of the agent's skills in
 *      THEIR circle; they can never expose one the owner hid. Otherwise joining circle B would let B's
 *      admins reveal what the owner keeps hidden in circle A — a cross-circle authority leak.
 *
 * Default is EXPOSED inside a circle the agent belongs to. Adding an agent to a circle is the
 * deliberate act; requiring a second opt-in per skill would make every freshly added agent look broken,
 * and the list of things an agent can do is not a secret the way personal properties are. Outside its
 * circles nothing is advertised at all — that is the scope, not a setting.
 */

/** The empty policy: nothing hidden anywhere. */
export const EMPTY_EXPOSURE = Object.freeze({ hidden: Object.freeze([]), perCircle: Object.freeze({}) });

/**
 * Normalise a stored exposure policy into `{hidden: string[], perCircle: {circleId: string[]}}`.
 * Anything unrecognised degrades to "nothing hidden" — a corrupt policy must not silently hide an
 * agent's whole skill set (which would read as the agent being broken).
 *
 * @param {object} [stored]
 * @returns {{hidden: string[], perCircle: object}}
 */
export function normalizeExposure(stored) {
  const ids = (v) => (Array.isArray(v)
    ? [...new Set(v.filter((s) => typeof s === 'string' && s !== ''))].sort()
    : []);
  const perCircle = {};
  const raw = stored && typeof stored.perCircle === 'object' && stored.perCircle ? stored.perCircle : {};
  for (const [circleId, list] of Object.entries(raw)) {
    if (typeof circleId !== 'string' || circleId === '') continue;
    const hidden = ids(list);
    if (hidden.length) perCircle[circleId] = Object.freeze(hidden);
  }
  return Object.freeze({
    hidden: Object.freeze(ids(stored?.hidden)),
    perCircle: Object.freeze(perCircle),
  });
}

/**
 * Is this skill advertised in this circle?
 *
 * Owner-hidden wins everywhere (the ceiling): a circle cannot un-hide it. A per-circle hide applies
 * only there. `circleId` omitted ⇒ the agent-wide answer (used by surfaces that show the owner their
 * own policy).
 *
 * @param {object} a
 * @param {object} [a.exposure]   the agent's policy (any shape — normalised here)
 * @param {string} a.skillId
 * @param {string} [a.circleId]
 * @returns {boolean}
 */
export function isSkillExposed({ exposure, skillId, circleId = null } = {}) {
  if (typeof skillId !== 'string' || skillId === '') return false;
  const pol = normalizeExposure(exposure);
  if (pol.hidden.includes(skillId)) return false;
  if (circleId != null && (pol.perCircle[circleId] ?? []).includes(skillId)) return false;
  return true;
}

/**
 * Filter a skill list down to what is advertised in `circleId`. Accepts skill cards (`{id}`) or bare
 * id strings and returns the same shape it was given, so it can sit directly in a card/catalog
 * projection.
 *
 * @param {object} a
 * @param {Array<object|string>} a.skills
 * @param {object} [a.exposure]
 * @param {string} [a.circleId]
 * @returns {Array<object|string>}
 */
export function filterExposedSkills({ skills, exposure, circleId = null } = {}) {
  const list = Array.isArray(skills) ? skills : [];
  return list.filter((s) => {
    const id = typeof s === 'string' ? s : s?.id;
    return isSkillExposed({ exposure, skillId: id, circleId });
  });
}

/**
 * The OWNER's edit: hide or expose a skill agent-wide, or within one circle.
 *
 * Gated on `bySigner` matching the agent's `ownerFingerprint` — the ownership rule. This is a real
 * gate for the agent's own stored policy (its device refuses a change it cannot attribute to the owner
 * key), and no more than that: it does not pretend to control what a modified client advertises about
 * itself. Returns the NEW policy; never mutates.
 *
 * @param {object} a
 * @param {object} [a.exposure]           current policy
 * @param {string} a.skillId
 * @param {boolean} a.exposed             true → advertise, false → hide
 * @param {string} [a.circleId]           scope the change to one circle (else agent-wide)
 * @param {string} a.ownerFingerprint     the agent's bound owner key fingerprint
 * @param {string} a.bySigner             the fingerprint that signed this change
 * @returns {{ok: true, exposure: object} | {ok: false, reason: string}}
 */
export function setSkillExposure({
  exposure, skillId, exposed, circleId = null, ownerFingerprint, bySigner,
} = {}) {
  if (typeof skillId !== 'string' || skillId === '') return { ok: false, reason: 'skill-required' };
  if (!ownerFingerprint || !bySigner) return { ok: false, reason: 'unsigned' };
  if (bySigner !== ownerFingerprint) return { ok: false, reason: 'not-owner' };
  return { ok: true, exposure: withHidden(exposure, skillId, !exposed, circleId) };
}

/**
 * A circle ADMIN's edit: hide a skill inside their own circle. Narrowing only — an admin asking to
 * EXPOSE is refused (`cannot-widen`) rather than silently ignored, because a control that appears to
 * work and does nothing is worse than one that says no. Un-hiding what the same circle hid is allowed
 * (that is undoing their own narrowing, not widening past the owner).
 *
 * @param {object} a
 * @param {object} [a.exposure]
 * @param {string} a.skillId
 * @param {boolean} a.exposed
 * @param {string} a.circleId
 * @param {boolean} a.isAdmin      the caller's admin role IN that circle (the existing role — not a new one)
 * @returns {{ok: true, exposure: object} | {ok: false, reason: string}}
 */
export function setCircleSkillExposure({ exposure, skillId, exposed, circleId, isAdmin } = {}) {
  if (typeof skillId !== 'string' || skillId === '') return { ok: false, reason: 'skill-required' };
  if (typeof circleId !== 'string' || circleId === '') return { ok: false, reason: 'circle-required' };
  if (!isAdmin) return { ok: false, reason: 'admin-only' };
  const pol = normalizeExposure(exposure);
  // The ceiling: what the OWNER hid agent-wide is not a circle's to reveal.
  if (exposed && pol.hidden.includes(skillId)) return { ok: false, reason: 'cannot-widen' };
  return { ok: true, exposure: withHidden(exposure, skillId, !exposed, circleId) };
}

/** Add/remove `skillId` from the hidden set (agent-wide or per-circle). Pure. */
function withHidden(exposure, skillId, hide, circleId) {
  const pol = normalizeExposure(exposure);
  if (circleId == null) {
    const hidden = hide
      ? [...new Set([...pol.hidden, skillId])].sort()
      : pol.hidden.filter((s) => s !== skillId);
    return normalizeExposure({ hidden, perCircle: pol.perCircle });
  }
  const cur = pol.perCircle[circleId] ?? [];
  const next = hide
    ? [...new Set([...cur, skillId])].sort()
    : cur.filter((s) => s !== skillId);
  return normalizeExposure({ hidden: pol.hidden, perCircle: { ...pol.perCircle, [circleId]: next } });
}
