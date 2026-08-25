/**
 * basis v2 — circle member directory (shared web + mobile, F-5.1).
 *
 * The ONE canonical circle **Member** + its declared projections
 * (peer-connectivity Phase 0/1, the "one Member" collapse — the sibling of
 * C10's `chatEnvelope`). A circle member used to exist in TWO hand-maintained
 * roster shapes kept in sync by copy-paste reshapers, and that drift was the
 * risk:
 *
 *   1. the RAW stoop roster row (`listGroupMembers` → `deriveRoster`)
 *        `{ webid, handle, displayName, role, sealingPublicKey, circleAddress, … }`
 *   2. the CHAT-SHELL projected item (`basis realAgent` `listGroupMembers`
 *      reshape → `{ id, type:'member', webid, label, handle, role, circleAddress? }`)
 *      where `label` = `displayName ?? handle ?? webid` (the displayName is
 *      COLLAPSED into a single label).
 *
 * `normalizeCircleMembers` bridged both by hand into the `circleViewAs` shape
 * `{ id, handle, realName, reveals }`, un-collapsing the label inline. This
 * module makes shapes 1 & 2 PROJECTIONS of one canonical Member so the reshape
 * lives in one place:
 *
 *   • `memberFrom`        — either roster shape (1 or 2) → canonical Member.
 *   • `memberToChatItem`  — Member → the chat-shell item (shape 2) that
 *                           `basis realAgent` used to hand-build.
 *   • `memberToViewAs`    — Member → the `{ id, handle, realName, reveals }`
 *                           View-as shape `circleViewAs` consumes.
 *
 * and `normalizeCircleMembers` becomes the single composition
 * `memberToViewAs(memberFrom(row))` rather than a two-branch hand-reshape.
 * Every projector is pure and proven byte-identical to what its producer /
 * consumer emitted before (see `test/circleMembers.test.js`).
 *
 * Placement (CLAUDE.md invariant 5): the canonical Member lives here in
 * `@onderling/kring-host` alongside `circleMembers.js` — the roster substrate
 * both basis shells (web + mobile) already depend on for `normalizeCircleMembers`.
 * The trail projection `deriveRoster` (stoop) births shape 1 and the chat-shell
 * reshape (basis) births shape 2; both now read the projector rather than
 * re-shaping a member by hand.
 *
 * (`reveals` — the pairwise reveal list — IS surfaced by `listGroupMembers` as a
 * VIEWER-SCOPED projection (Wave B): a member row carries `reveals:[viewerWebid]`
 * iff the calling viewer has opted (via their own `Reveals` store) to see that
 * member's real name; else `[]`, which means View-as hides real names under
 * pairwise unless the policy is 'open'. Default-withhold; no new network exposure.)
 *
 * @typedef {object} Member
 * @property {string|null} webid        the member's WebID (roster identity).
 * @property {string|null} handle       the `@handle`, or null.
 * @property {string|null} displayName  the real/display name, or null. Recovered
 *   from a shape-2 `label` only when the label is DISTINCT from the handle/webid.
 * @property {string}      role         circle role; defaults to `'member'`.
 * @property {string}      [adminVia]   HOW an admin holds the role — `'founder'` · `'role'` ·
 *   `` `caretaker:<hash>` `` (see `memberAdminStatus`). Absent unless the roster projection can say.
 * @property {string[]}    reveals      pairwise reveal list; defaults to `[]`.
 * @property {string}      [circleAddress]  per-circle address (additive; absent
 *   for pre-substrate members).
 */

/**
 * `memberFrom` — project EITHER roster shape onto the canonical Member.
 * Tolerates shape 1 (raw `{ webid, handle, displayName, role }`) and shape 2
 * (chat-shell `{ id, webid, label, handle, role }`) via the same field
 * fallbacks the old hand-reshape used, so both shapes normalise identically.
 *
 * @param {object} entry  a roster row (shape 1 or shape 2)
 * @returns {Member}
 */
export function memberFrom(entry) {
  const m = entry && typeof entry === 'object' ? entry : {};
  const webid = m.webid ?? m.id ?? null;
  const handle = m.handle ?? null;
  // Shape 1 carries `displayName`; shape 2 collapses it into `label`
  // (= displayName ?? handle ?? webid) — only recover a real name from `label`
  // when it's distinct from the handle/webid.
  let displayName = m.displayName ?? null;
  if (displayName == null && m.label != null && m.label !== handle && m.label !== webid) {
    displayName = m.label;
  }
  const out = {
    webid,
    handle,
    displayName,
    role: m.role ?? 'member',
    // The member's per-circle RELEASE — what they chose to disclose to this circle (captured at
    // join or by a later persona share). This is the fact the reveal ladder gates on: a name is
    // visible because its OWNER released it here, never because a viewer opted in to seeing it.
    // Was dropped by this projection for a while, which made the release invisible to every
    // downstream consumer and left the ladder leaning on a viewer-side marker instead.
    personaProperties: (m.personaProperties && typeof m.personaProperties === 'object')
      ? m.personaProperties : null,
  };
  if (m.circleAddress != null) out.circleAddress = m.circleAddress;
  // Rules acceptance (visibility): which rules version this member accepted (their signed join /
  // re-accept, folded) and the circle's CURRENT version, both stamped by `deriveRoster` on gated
  // circles only. Carried so `memberRulesStatus` can compute the display state from the Member alone.
  if (m.rulesAccepted != null) out.rulesAccepted = String(m.rulesAccepted);
  if (m.rulesCurrentVersion != null) out.rulesCurrentVersion = String(m.rulesCurrentVersion);
  // HOW this member came to be an admin — the fold's own word, stamped on the roster row by
  // `deriveRoster` and carried so `memberAdminStatus` can compute the display line from the Member
  // alone. Additive: absent on every member who is not an admin, and on every admin the projection
  // cannot explain (an unexplained admin must not borrow someone else's reason).
  if (m.adminVia != null) out.adminVia = String(m.adminVia);
  // …and whether a caretaker has signed for the appointment. An appointment nobody has acknowledged
  // is a circle whose new custodian may not know they have it, which is the half another member can
  // actually act on — they can go and tell them.
  if (m.adminViaAcknowledged === true) out.adminViaAcknowledged = true;
  return out;
}

/**
 * `memberAdminStatus` — HOW someone holds the admin role, for the one line both shells paint next
 * to it (neither computes it). There are three ways in, and until now all three rendered as the
 * same word "admin": you made the circle, someone decided to promote you, or the circle was left
 * without an admin and the projection handed it to you. The third is the one nobody chose — not the
 * person, not any admin — and it is the one most worth saying out loud.
 *
 * The roster row carries the projection's word; this turns it into the plain one, once:
 *
 *   'founder'           → `founder`    they made the circle
 *   'role'              → `appointed`  an admin promoted them: a decision a person took
 *   `caretaker:<hash>`  → `caretaker`  nobody appointed them; a departure or a step-down emptied the
 *                                      admin set and the fold handed it over. `appointment` names the
 *                                      statement that emptied it, so the same handover has the same
 *                                      name on every device and a NEW one gets a NEW name.
 *
 * `null` when there is nothing to say: a plain member, an admin whose row carries no provenance
 * (a circle this device can only read from its older records), or a word this version does not
 * know. Absent beats guessed — an unexplained admin renders as an admin, never as a founder.
 *
 * @param {Member|object} member
 * A caretaker's label also depends on whether they have SIGNED for the appointment
 * (`adminViaAcknowledged`): handed the circle and knowing it, versus handed it and possibly not.
 *
 * @returns {{ via: 'founder'|'appointed'|'caretaker', labelKey: string, acknowledged?: boolean,
 *   appointment?: string }|null}
 */
export function memberAdminStatus(member) {
  const m = member && typeof member === 'object' ? member : {};
  const raw = typeof m.adminVia === 'string' ? m.adminVia : '';
  if (!raw) return null;
  if (raw === 'founder') return { via: 'founder', labelKey: 'circle.admin_via.founder' };
  if (raw === 'role') return { via: 'appointed', labelKey: 'circle.admin_via.appointed' };
  if (raw.startsWith('caretaker:')) {
    const appointment = raw.slice('caretaker:'.length);
    // TWO caretaker labels, because there are two states worth telling apart. The circle handing
    // itself to someone says nothing about whether that someone has noticed — and a member who can
    // see "nobody has confirmed this" can go and tell them, which is the only repair available.
    const acknowledged = m.adminViaAcknowledged === true;
    return {
      via: 'caretaker',
      acknowledged,
      labelKey: acknowledged ? 'circle.admin_via.caretaker' : 'circle.admin_via.caretaker_unseen',
      ...(appointment ? { appointment } : {}),
    };
  }
  return null;
}

/**
 * `memberRulesStatus` — the ONE compute for the member-card "rules" line (web ≡ mobile paint it,
 * neither computes it). Returns `null` when there is nothing to show: an ungated circle, or a row
 * with no recorded acceptance (founders and pre-gate members never accepted — silence, not blame).
 * Otherwise `{ accepted, current, stale }`: `stale` iff the circle's current version is known and
 * newer than the accepted one — "accepted v1, current v2", visible and valid, never a lockout.
 *
 * @param {Member|object} member
 * @returns {{ accepted: string, current: string|null, stale: boolean }|null}
 */
export function memberRulesStatus(member) {
  const m = member && typeof member === 'object' ? member : {};
  const accepted = m.rulesAccepted != null ? String(m.rulesAccepted) : null;
  if (!accepted) return null;
  const current = m.rulesCurrentVersion != null ? String(m.rulesCurrentVersion) : null;
  const a = Number.parseInt(accepted, 10);
  const c = current != null ? Number.parseInt(current, 10) : NaN;
  const stale = Number.isFinite(a) && Number.isFinite(c) && a < c;
  return { accepted, current, stale };
}

/**
 * `memberToChatItem` — project a canonical Member onto the chat-shell list
 * item (shape 2) that `basis realAgent`'s `listGroupMembers` reshape used to
 * hand-build:
 *   `{ id, type:'member', webid, label, handle, role, circleAddress? }`
 * `label` re-collapses `displayName ?? handle ?? webid`; `circleAddress` is
 * appended only when truthy (matching the original additive guard).
 *
 * @param {Member} member
 */
export function memberToChatItem(member) {
  const m = member ?? {};
  return {
    id:     m.webid,
    type:   'member',
    webid:  m.webid,
    label:  m.displayName ?? m.handle ?? m.webid,
    handle: m.handle ?? null,
    role:   m.role ?? 'member',
    ...(m.circleAddress ? { circleAddress: m.circleAddress } : {}),
  };
}

/**
 * `memberToViewAs` — project a canonical Member onto the View-as directory
 * shape `circleViewAs` consumes: `{ id, handle, realName, released, ownDisplayName }`.
 *
 * `realName` comes from the member's RELEASE (`personaProperties.realName`) — the name their
 * disclosure choice put into this circle — never from the local display cache: revealing is the
 * discloser's act, and a name nobody released is a name the directory does not have. `released`
 * states that fact explicitly so the ladder never has to infer it from string presence.
 * `ownDisplayName` carries the local display-cache name for exactly ONE consumer: the viewer's
 * OWN row (you always see yourself; your device holds your name whether or not you released it).
 *
 * @param {Member} member
 */
export function memberToViewAs(member) {
  const m = member ?? {};
  const releasedName = (m.personaProperties && typeof m.personaProperties.realName === 'string'
    && m.personaProperties.realName) ? m.personaProperties.realName : null;
  return {
    id: m.webid ?? null,
    handle: m.handle ?? null,
    realName: releasedName,
    released: releasedName != null,
    ownDisplayName: m.displayName ?? null,
    // Carried for the sender-label index (an actor that never resolved past its transport address
    // still matches its roster row); display never reads it.
    ...(m.circleAddress != null ? { circleAddress: m.circleAddress } : {}),
    // The member-card "rules" line, computed HERE (shells only paint) — see memberRulesStatus.
    // ADDITIVE: the key exists only when there is something to show, so rows from ungated circles
    // (and every pre-acceptance consumer's expected shape) stay byte-identical.
    ...((() => { const r = memberRulesStatus(m); return r ? { rules: r } : {}; })()),
    // WHO RUNS THE CIRCLE. The role was being dropped here, so a member list could not say who its
    // admins were at all — the one governance fact a member looks at a member list to find. It rides
    // only when it is not the default 'member', so every plain row stays byte-identical.
    ...(m.role && m.role !== 'member' ? { role: m.role } : {}),
    // …and HOW they came by it — present only where the projection can say (see memberAdminStatus).
    ...((() => { const a = memberAdminStatus(m); return a ? { admin: a } : {}; })()),
  };
}

/**
 * Normalise a `listGroupMembers` result (either roster shape) into the View-as
 * member list `circleViewAs` consumes. Now the single projector
 * `memberToViewAs(memberFrom(row))` over whichever list the result carries.
 */
export function normalizeCircleMembers(result) {
  if (!result || typeof result !== 'object') return [];
  const raw = Array.isArray(result.members) ? result.members
    : Array.isArray(result.items) ? result.items
      : Array.isArray(result) ? result
        : [];
  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m) => memberToViewAs(memberFrom(m)))
    .filter((m) => m.id != null);
}

/** Member count from a listGroupMembers result (for launcher tiles). */
export function circleMemberCount(result) {
  return normalizeCircleMembers(result).length;
}

/**
 * share-policy — resolve a member's SEALING PUBLIC KEY from a circle roster. Pure + injectable so
 * `recipientSealKeyFor(circleId, webId)` (circleApp) and its mobile peer share ONE lookup and it's testable
 * without a live pod.
 *
 * Accepts either roster shape the target circle already holds:
 *   • stoop `listGroupMembers` → `[{ webid, sealingPublicKey }]` (the redemption trail — see
 *     `listGroupMembersCore`), or
 *   • the circle control-agent roster → `[{ webId, publicKey }]` (the group-key recipient keys).
 *
 * Returns the recipient's sealing pubkey, or `null` when they're not in THIS roster (→ deny-by-default: no
 * re-seal, the share to that recipient is refused). No publish, no WebID network resolution (per the advice).
 *
 * @param {Array<object>|{members?:Array<object>}} roster  a member list (or a `{members}` result)
 * @param {string} webId  the recipient's WebID
 * @returns {string|null}
 */
export function recipientSealKeyFromMembers(roster, webId) {
  if (!webId) return null;
  const list = Array.isArray(roster) ? roster
    : (roster && Array.isArray(roster.members) ? roster.members : []);
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const id = m.webid ?? m.webId ?? m.id ?? null;
    if (id !== webId) continue;
    const key = m.sealingPublicKey ?? m.publicKey ?? null;
    return (typeof key === 'string' && key.length > 0) ? key : null;
  }
  return null;
}
