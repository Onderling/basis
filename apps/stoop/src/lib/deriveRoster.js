/**
 * deriveRoster — project a circle's membership FROM the durable, signed
 * redemption trail (the source of truth), left-joining the MemberMap for
 * optional DISPLAY fields only.
 *
 * Connectivity Phase 1, Part A (plans/DESIGN-connectivity-phase1-membership.md).
 * Fixes B1: `listGroupMembers` used to compute `MemberMap.list() ∩ trail`, and
 * the MemberMap is a lossy in-memory cache that reads EMPTY at runtime even
 * though the JOIN succeeded on the durable trail — so the roster (and the
 * fan-out recipients + mandate WIE that read it) went empty. This helper
 * INVERTS that: it starts from the trail and never lets the roster go empty
 * when the trail has members.
 *
 * The `membership-redemption` itemStore items carry, per member:
 *   { groupId, redeemedBy (webid), signingPublicKey, sealingPublicKey,
 *     circleAddress, circleAddressProof, personaProperties, confirmedBy?, channel?, redeemedAt }
 * — durable + signed + synced like any content (no pod required). Everything the
 * roster needs is already there:
 *   - `redeemedBy`  → a member (the joiner who presented the code, or a
 *                     mesh-introduced peer on `channel:'intro'`).
 *   - `confirmedBy` (on `channel:'peer'`) → the ADMIN, as recorded on the JOINER
 *                     side (the joiner's own trail never carries the admin's
 *                     `redeemedBy`, only `confirmedBy` — so this is how a joiner
 *                     sees the founder). Mirrors `listGroupRoster` (index.js).
 *
 * Founders never "redeem" their own circle, so the creator(s) are supplied
 * separately via `founderWebids` — derived durably from the circle's
 * `group-rules` author, plus (back-compat) any admin-role MemberMap entry. Their
 * role is forced to `admin`.
 *
 * The MemberMap is LEFT-JOINED for display fields (handle, displayName, avatar,
 * tags, …) and to backfill keys the trail happens to lack for a given row — it
 * is NEVER consulted for member EXISTENCE. Membership no longer depends on the
 * cache landing.
 *
 * @param {object} o
 * @param {Array<object>} [o.redemptions]         `membership-redemption` items for ONE group.
 * @param {Array<string>} [o.founderWebids]       webids to force role `admin` (creator + admins).
 * @param {Array<object>} [o.memberMapForDisplay] `MemberMap.list()` — display fields only.
 * @returns {Array<object>} one record per member, built from the trail + display left-join.
 */
export function deriveRoster({
  redemptions = [],
  founderWebids = [],
  memberMapForDisplay = [],
} = {}) {
  const displayByWebid = new Map();
  for (const m of memberMapForDisplay ?? []) {
    if (m && typeof m === 'object' && typeof m.webid === 'string' && m.webid) {
      displayByWebid.set(m.webid, m);
    }
  }

  /** webid → derived record, built FROM the trail. */
  const roster = new Map();

  const upsert = (webid, role, trailFields = {}) => {
    if (typeof webid !== 'string' || !webid) return;
    const prev = roster.get(webid) ?? { webid };
    // Never downgrade an admin to a member (admin wins on any conflict).
    const nextRole = prev.role === 'admin' ? 'admin' : (role ?? prev.role ?? 'member');
    const merged = { ...prev, webid, role: nextRole };
    // Trail fields only fill an empty slot — the first non-null wins, so a later
    // intro row can't blank an earlier redeem's captured keys. Null/absent values
    // are NOT stored (so unknown keys stay absent, not null).
    for (const [k, v] of Object.entries(trailFields)) {
      if (v != null && merged[k] == null) merged[k] = v;
    }
    roster.set(webid, merged);
  };

  for (const it of redemptions ?? []) {
    const src = (it && it.source) ?? {};
    const {
      redeemedBy, confirmedBy, confirmedByCircleAddress, confirmedByCircleAddressProof,
      channel, role, signingPublicKey, sealingPublicKey, circleAddress, circleAddressProof,
      personaProperties,
    } = src;
    if (redeemedBy) {
      upsert(redeemedBy, role ?? 'member', {
        pubKey:            signingPublicKey,
        sealingPublicKey,
        circleAddress,
        // The proof that came with the address. Carried onto the row so a member can RELAY this
        // member's announcement to someone who was not present when it was proven — the receiver
        // re-verifies it themselves, so relaying grants the relayer no authority
        // (`circleAddressAnnouncement.js`). Absent on a pre-2026-08-02 trail: the row is unchanged.
        circleAddressProof,
        personaProperties: (personaProperties && typeof personaProperties === 'object'
          && Object.keys(personaProperties).length) ? personaProperties : undefined,
      });
    }
    // The admin's address as recorded on the joiner side (peer-bridge only).
    if (confirmedBy && channel === 'peer') {
      upsert(confirmedBy, 'admin', {
        // The admin's PER-CIRCLE address, returned on the redeem response and proof-verified before it
        // was written (`recordRemoteRedemption`). This row is the joiner's ONLY view of the admin, so
        // without it every send to them falls through to the global signing key — refused outright when
        // the per-user address fallback is off. Absent on a pre-2026-07-30 trail: the row is unchanged.
        circleAddress:      confirmedByCircleAddress,
        circleAddressProof: confirmedByCircleAddressProof,
        // …and the admin's SIGNING key, which is `confirmedBy` itself: a basis circle binds
        // webid === the member's chat signing address (the same identity the redeem response was
        // authenticated under, and the same fact the address ladder's webid rung already relies on).
        // Named here because the pair {pubKey, circleAddress} is what `bindCircleAddressKeys` needs to
        // make the per-circle address sealable — a row with only the address is silently skipped.
        pubKey: confirmedBy,
      });
    }
  }

  // Founder(s) — the circle creator + any admin-role member; never redeem.
  for (const w of founderWebids ?? []) upsert(w, 'admin', {});

  // LEFT-JOIN the MemberMap for display fields; the trail wins on existence + keys.
  // Spread disp first, then the derived record: rec only carries keys it actually
  // has a value for, so a trail-captured key overrides the display cache while an
  // absent trail key falls back to the cache's value (or stays absent).
  const out = [];
  for (const rec of roster.values()) {
    const disp = displayByWebid.get(rec.webid) ?? {};
    out.push({ ...disp, ...rec });
  }
  return out;
}

export default deriveRoster;
