import { foldRoster, verifyCircleLink } from '@onderling/core';
import { hasHumanRules } from '@onderling/circles';
import { isExited } from './circleExits.js';

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
 * B4 (2026-08-02) — EXITS are part of the projection, per circle. A `group-removal` or
 * `group-leave` for THIS circle drops the member from THIS circle's roster and nothing else: the
 * trail is already circle-scoped, so removing someone here cannot touch a circle you share with them
 * elsewhere. An exit only counts while it is LATER than the member's most recent join, so a re-join
 * re-admits them rather than removal being permanent and unappealable. → `circleExits.js`.
 *
 * @param {object} o
 * @param {Array<object>} [o.redemptions]         `membership-redemption` items for ONE group.
 * @param {Array<string>} [o.founderWebids]       webids to force role `admin` (creator + admins).
 * @param {Array<object>} [o.memberMapForDisplay] `MemberMap.list()` — display fields only.
 * @param {Map<string, number>} [o.exits]         webid → latest exit ts (`collectCircleExits`).
 * @param {Array<object>} [o.spineStatements]     VERIFIED spine statement bodies (join/leave/evict/role) for
 *   THIS circle. When present, they are folded DENY-WINS on top of the trail-derived head — the spine may only
 *   STRENGTHEN it (drop a member, promote to admin), never re-admit or invent one (the safe cutover — see
 *   below). When absent, the trail projection stands alone (the legacy path).
 * @returns {Array<object>} one record per member, built from the trail + display left-join. An admin
 *   row also carries `adminVia` — the fold's word for HOW they hold it (`'founder'` · `'role'` ·
 *   `` `caretaker:<hash>` ``) — wherever the fold can say; absent otherwise, never guessed.
 */
export function deriveRoster({
  redemptions = [],
  founderWebids = [],
  memberMapForDisplay = [],
  exits = null,
  spineStatements = [],
  // The membership-rider cutover switch: TRUE when the statements come from the RAIL's verified read
  // (bindings resolved against real per-circle keys) — the fold is then AUTHORITATIVE and the wall-clock
  // exit rule retires. FALSE (legacy store path / compositions where author==ref is the global-identity
  // convention) keeps the pre-rider semantics: wall-clock exits + the strengthen-only spine overlay.
  foldAuthoritative = false,
  // The circle's `group-rules` blob (latest, or null). Read for `maxDevicesPerMember` — the
  // per-member device ceiling, a CIRCLE policy ("some circles disallow multiple devices"),
  // enforced HERE because the fold is where the address set becomes authoritative: an address
  // beyond the cap simply never projects, on every member's device, whatever software announced it.
  rules = null,
  // task #80 — the circle's CURRENT rules version (see the caller). Only read to build the fold's
  // rules gate below; `null` (no rules item / legacy caller) leaves joins ungated.
  rulesVersion = null,
} = {}) {
  const displayByWebid = new Map();
  for (const m of memberMapForDisplay ?? []) {
    if (m && typeof m === 'object' && typeof m.webid === 'string' && m.webid) {
      displayByWebid.set(m.webid, m);
    }
  }

  /** webid → derived record, built FROM the trail. */
  const roster = new Map();

  /** webid → their most recent `redeemedAt`, so an exit can be compared against their latest join. */
  const joinedAt = new Map();

  /**
   * webid → the SET of per-circle addresses this member has PROVEN (a second device, a restored
   * profile, a re-announce). The single `circleAddress` slot used to be the whole story, so a second
   * proven address was silently lost and the member became unreachable on it. The set is projected
   * onto the row as `circleAddresses` (primary first) below.
   *
   * DENY-BY-DEFAULT ENTRY GATE: an address joins the set ONLY when its proof verifies here
   * (`verifyCircleLink` — the same check the join and the announce path use before writing). The
   * PRIMARY `circleAddress` slot keeps its existing trust (proof-verified before it was ever
   * written to the trail), so a legacy proofless row folds exactly as before — but it cannot grow
   * the set beyond itself.
   */
  const provenAddresses = new Map();
  const addProvenAddress = (webid, groupId, address, proof) => {
    if (typeof webid !== 'string' || !webid) return;
    if (typeof address !== 'string' || !address) return;
    if (!verifyCircleLink({ groupId, address, proof })) return;   // unproven ⇒ refused, never stored
    let set = provenAddresses.get(webid);
    if (!set) provenAddresses.set(webid, (set = new Set()));
    set.add(address);
  };

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
      const at = typeof src.redeemedAt === 'number' ? src.redeemedAt : 0;
      if (at > (joinedAt.get(redeemedBy) ?? 0)) joinedAt.set(redeemedBy, at);
      upsert(redeemedBy, role ?? 'member', {
        pubKey:            signingPublicKey,
        sealingPublicKey,
        // The handle the person chose at join rides the redemption row as `peerDisplay` (self-asserted
        // display, the same trust class as their circleAddress — the writer's own comment says so). It
        // was written on every admin's row and never projected, so the admin's roster showed a raw
        // address for someone who had typed a name (W10, measured on a live circle 2026-08-29). The
        // MemberMap's display fields still win where present — `upsert` never overwrites a set field.
        handle:            typeof src.peerDisplay === 'string' && src.peerDisplay ? src.peerDisplay : undefined,
        circleAddress,
        // THE CEREMONY ADDRESS (custody D1): the join-time address, pinned immutably — the key
        // class ceremony statements (address-revoke) must be signed with. An un-patched row's
        // primary IS join-time; a patched row carries the captured field (`recordCircleAddress`).
        // First-non-null-wins in the upsert keeps it stable across trail rows.
        ceremonyAddress: src.ceremonyAddress ?? circleAddress,
        // THE CEREMONY COMMITMENT (core ceremonyCommitment.js): who may retire this member's addresses — their
        // owner root, at a ceremony. Declared in the member's announcement, circle-key-signed, pinned first-write.
        ceremonyCommitment: typeof src.ceremonyCommitment === 'string' && src.ceremonyCommitment ? src.ceremonyCommitment : undefined,
        // The proof that came with the address. Carried onto the row so a member can RELAY this
        // member's announcement to someone who was not present when it was proven — the receiver
        // re-verifies it themselves, so relaying grants the relayer no authority
        // (`circleAddressAnnouncement.js`). Absent on a pre-2026-08-02 trail: the row is unchanged.
        circleAddressProof,
        personaProperties: (personaProperties && typeof personaProperties === 'object'
          && Object.keys(personaProperties).length) ? personaProperties : undefined,
      });
      // The member's address SET — every {address, proof} pair this row carries, each admitted only
      // when its proof verifies. A row holds extra pairs under `circleAddresses` when a later proven
      // address was recorded WITHOUT evicting the earlier one (`recordCircleAddress`); a second
      // redemption row with a different address feeds the same set.
      addProvenAddress(redeemedBy, src.groupId, circleAddress, circleAddressProof);
      for (const p of Array.isArray(src.circleAddresses) ? src.circleAddresses : []) {
        addProvenAddress(redeemedBy, src.groupId, p?.address, p?.proof);
      }
    }
    // The admin's address as recorded on the joiner side (peer-bridge only).
    if (confirmedBy && channel === 'peer') {
      upsert(confirmedBy, 'admin', {
        // …and the admin's display, which rides BACK on the redeem reply exactly as their per-circle
        // address does — so the joiner's roster names the person who let them in, instead of showing
        // their key (the other half of W10).
        handle:             typeof src.confirmedByDisplay === 'string' && src.confirmedByDisplay ? src.confirmedByDisplay : undefined,
        // The admin's PER-CIRCLE address, returned on the redeem response and proof-verified before it
        // was written (`recordRemoteRedemption`). This row is the joiner's ONLY view of the admin, so
        // without it every send to them falls through to the global signing key — refused outright when
        // the per-user address fallback is off. Absent on a pre-2026-07-30 trail: the row is unchanged.
        circleAddress:      confirmedByCircleAddress,
        circleAddressProof: confirmedByCircleAddressProof,
        // Same ceremony-address pin for the admin-as-seen-by-the-joiner shape (custody D1).
        ceremonyAddress: src.confirmedByCeremonyAddress ?? confirmedByCircleAddress,
        ceremonyCommitment: typeof src.confirmedByCeremonyCommitment === 'string' && src.confirmedByCeremonyCommitment ? src.confirmedByCeremonyCommitment : undefined,
        // …and the admin's SIGNING key, which is `confirmedBy` itself: a basis circle binds
        // webid === the member's chat signing address (the same identity the redeem response was
        // authenticated under, and the same fact the address ladder's webid rung already relies on).
        // Named here because the pair {pubKey, circleAddress} is what `bindCircleAddressKeys` needs to
        // make the per-circle address sealable — a row with only the address is silently skipped.
        pubKey: confirmedBy,
      });
      // The admin's address set, same gate: primary pair + any extra proven pairs on the row.
      addProvenAddress(confirmedBy, src.groupId, confirmedByCircleAddress, confirmedByCircleAddressProof);
      for (const p of Array.isArray(src.confirmedByCircleAddresses) ? src.confirmedByCircleAddresses : []) {
        addProvenAddress(confirmedBy, src.groupId, p?.address, p?.proof);
      }
    }
  }

  // Founder(s) — the circle creator + any admin-role member; never redeem.
  for (const w of founderWebids ?? []) upsert(w, 'admin', {});

  // B4 — the wall-clock exit drop. LEGACY PATH ONLY: with verified spine statements present the causal
  // fold below is AUTHORITATIVE and the wall-clock comparison retires (two skewed devices must agree on
  // who-is-in; `exitAt >= joinedAt` cannot give that — the deps-chain can). A circle with no statements
  // (pre-rail, or a composition without the rail) keeps the old rule unchanged.
  const authoritative = foldAuthoritative && Array.isArray(spineStatements) && spineStatements.length > 0;
  if (!authoritative && exits instanceof Map && exits.size > 0) {
    for (const webid of [...roster.keys()]) {
      if (isExited(exits, webid, joinedAt.get(webid) ?? 0)) roster.delete(webid);
    }
  }

  // ── The CAUSAL FOLD is AUTHORITATIVE (the membership rider cutover) ──────────────────────────────────
  // No data migration (the record decision for membership): the trail-derived roster above is the
  // materialised HEAD; the signed statements are the chained transitions — `head + fold(deltas)` IS the
  // membership. Same statements → same roster on every device (deps-chain order, no wall-clock, no
  // arrival-order dependence). The statements handed here are VERIFIED with their key↔ref bindings RESOLVED
  // (the rail's read, or the legacy store path's resolver) — the earlier strengthen-only interim existed
  // because the signer wasn't settled; it is (circle-scoped signing + verified bindings), so the fold now
  // ADMITS as well as removes: a causally-later re-join re-admits; a folded-in member the trail doesn't
  // know yet gets a minimal row (their trail row backfills display fields when it arrives).
  if (Array.isArray(spineStatements) && spineStatements.length > 0) {
    const seedMembers = [...roster.keys()];
    const seedAdmins  = [...roster.values()].filter((r) => r.role === 'admin').map((r) => r.webid);
    // RULES-GATED JOINS (the rules-acceptance decision, 2026-08-20) — only on the AUTHORITATIVE path
    // (the rail's verified statements are where the fold ADMITS; the legacy overlay never admits, so it
    // has nothing to gate). A circle with HUMAN rules requires a join statement to carry an accepted
    // version; the valid set is {1..current} because versions are monotonic integers — acceptance of a
    // then-current version stays valid forever (a rules change makes it STALE, visibly, never a
    // removal). The trail (redemption rows) still SEEDS the roster and seed members are not gated —
    // that half is closed at the ADMITTING device instead: the membership writers refuse a redeem
    // without acceptance (`rules-acceptance-required`) before any trail row exists, so nothing
    // acceptance-less reaches the seed. Two layers, reviewed and kept.
    let rulesGate = null;
    let rulesTop = null;
    if (foldAuthoritative && hasHumanRules(rules)) {
      const current = Number.parseInt(rulesVersion ?? rules.version ?? 1, 10);
      const top = Number.isFinite(current) && current >= 1 ? current : 1;
      rulesTop = String(top);
      const versions = [];
      for (let v = 1; v <= top; v++) versions.push(String(v));
      rulesGate = { versions };
    }
    const folded = foldRoster(spineStatements, {
      founders: founderWebids ?? [],
      seed: { members: seedMembers, admins: seedAdmins },
      ...(rulesGate ? { rulesGate } : {}),
    });
    const inMembers = new Set(folded.members);
    const inAdmins  = new Set(folded.admins);
    if (authoritative) {
      for (const webid of inMembers) {
        if (!roster.has(webid)) upsert(webid, 'member', {});      // folded in ahead of their trail row
      }
      for (const webid of [...roster.keys()]) {
        if (!inMembers.has(webid)) roster.delete(webid);          // folded out (deny-wins)
        // THE FOLD'S ANSWER WINS, IN BOTH DIRECTIONS. This used to keep the trail-derived role when
        // the fold said "not an admin" — `… : roster.get(webid).role` — which combined with the
        // upsert's never-downgrade rule to make the projection admin-STICKY: a demotion folded
        // correctly on every device and then could not be seen, because the row it had to change was
        // pinned. A promotion is not more true than a demotion; on the authoritative path the fold
        // is the head, and the head is what a row states.
        else roster.get(webid).role = inAdmins.has(webid) ? 'admin' : 'member';
      }
    } else {
      // Legacy strengthen-only overlay: the spine may drop a member or promote to admin, never admit.
      for (const webid of [...roster.keys()]) {
        if (!inMembers.has(webid)) roster.delete(webid);
        else if (inAdmins.has(webid)) roster.get(webid).role = 'admin';
      }
    }
    // ── HOW EACH ADMIN CAME TO BE ONE ─────────────────────────────────────────────────────────────
    // The fold names it (`adminProvenance`): they made the circle, an admin promoted them, or the
    // circle was left without an admin and the fold handed it over. All three used to render as the
    // same word, and the third — the one nobody chose — is the one a member most needs told. Riding
    // the roster row puts it on `listGroupMembers`, which is what the member lists read.
    //
    // Two deliberate silences, both "absent beats guessed":
    //   · Only a row the FOLD itself calls an admin gets one. The strengthen-only legacy overlay can
    //     raise a trail row to admin without the fold having said why, and such a row keeps nothing.
    //   · The fold reports a SEED admin as a founder — its seed IS the cutover roster. Here the seed
    //     is the trail head, where whoever admitted someone is an admin whether they founded the
    //     circle or were promoted into it. So `'founder'` is carried only for a DERIVED founder
    //     (`founderWebids`, from the admission structure + the creation statement); a seeded admin
    //     the trail cannot explain says nothing rather than claiming foundership.
    const derivedFounders = new Set(founderWebids ?? []);
    for (const [webid, via] of Object.entries(folded.adminProvenance ?? {})) {
      const rec = roster.get(webid);
      if (!rec || rec.role !== 'admin' || !inAdmins.has(webid)) continue;
      if (via === 'founder' && !derivedFounders.has(webid)) continue;
      rec.adminVia = via;
      // …and whether a caretaker has SIGNED for the appointment nobody made. "The log says you run
      // this circle" and "you know you run this circle" are different facts, and only the second is
      // any use to the people relying on it. Stamped only when the signature names THIS appointment,
      // so a signature for an older handover cannot vouch for the current one.
      if (via.startsWith('caretaker:')
        && folded.caretakerAcknowledged?.[webid] === via.slice('caretaker:'.length)) {
        rec.adminViaAcknowledged = true;
      }
    }

    // Rules acceptance: the fold projects each member's latest accepted rules version (from the
    // signed join, superseded by rules-accept statements). Riding the roster row puts it on
    // `listGroupMembers`, which is what the member card reads — "accepted v1, current v2" is this field
    // against the circle's CURRENT version, stamped alongside it so the display state is computable
    // from the row alone. Visibility only; the GATE is the fold's `rulesGate` option above.
    for (const [webid, v] of Object.entries(folded.rulesAccepted ?? {})) {
      if (roster.has(webid)) roster.get(webid).rulesAccepted = v;
    }
    if (rulesTop != null) {
      for (const rec of roster.values()) rec.rulesCurrentVersion = rulesTop;
    }
  }

  // ── ADDRESS REVOCATION (device revocation — the eviction machinery pointed inward) ────────────────
  // `address-revoke` statements arrive in the same verified spine feed (author already resolved to
  // the member ref). SELF-SUBJECT BY CONSTRUCTION: a member's revocations are keyed by the AUTHOR
  // and applied only to the author's own row below — a statement naming another member's address
  // lands in the author's own bucket and touches nothing. DENY-WINS: once revoked, an address never
  // projects again, whatever announces before or after (the statements live on the compaction-exempt
  // membership lane, so every future fold sees them).
  const revokedAddresses = new Map();   // webid → Set<address> (their OWN revoked device addresses)
  if (Array.isArray(spineStatements)) {
    for (const s of spineStatements) {
      if (s?.kind !== 'address-revoke') continue;
      if (typeof s.author !== 'string' || !s.author) continue;
      if (typeof s.subject !== 'string' || !s.subject) continue;
      let set = revokedAddresses.get(s.author);
      if (!set) revokedAddresses.set(s.author, (set = new Set()));
      set.add(s.subject);
    }
  }

  // LEFT-JOIN the MemberMap for display fields; the trail wins on existence + keys.
  // Spread disp first, then the derived record: rec only carries keys it actually
  // has a value for, so a trail-captured key overrides the display cache while an
  // absent trail key falls back to the cache's value (or stays absent).
  const out = [];
  for (const rec of roster.values()) {
    const disp = displayByWebid.get(rec.webid) ?? {};
    // Trail keys override the display cache — EXCEPT the display fields themselves. The trail now
    // carries the handle a person chose AT JOIN (`peerDisplay`); the MemberMap carries the handle they
    // have NOW (renames land there). A person who renamed must not be shown their join-time name, so
    // for `handle` / `displayName` a present cache value wins and the trail is the fallback.
    const merged = {
      ...disp, ...rec,
      ...(typeof disp.handle === 'string' && disp.handle ? { handle: disp.handle } : {}),
      ...(typeof disp.displayName === 'string' && disp.displayName ? { displayName: disp.displayName } : {}),
    };
    // `circleAddresses` — the member's full proven address SET, primary first. `circleAddress`
    // stays the primary slot (every existing consumer keeps working); the set is what sender
    // authorization accepts and what delivery tries in order. The primary leads even when it has
    // no in-fold-verifiable proof (the legacy row), because its trust was established at write.
    const primary = (typeof merged.circleAddress === 'string' && merged.circleAddress)
      ? merged.circleAddress : null;
    const proven = provenAddresses.get(rec.webid);
    let addressSet = primary ? [primary] : [];
    if (proven) for (const a of proven) { if (a !== primary) addressSet.push(a); }
    // Revocation applies FIRST (before the cap): a revoked device's slot frees up, and — the loss
    // takeover — a revoked PRIMARY hands the slot to the first surviving proven address, so the
    // member stays reachable on the devices they still hold.
    const revoked = revokedAddresses.get(rec.webid);
    if (revoked?.size) {
      addressSet = addressSet.filter((a) => !revoked.has(a));
      if (primary && revoked.has(primary)) {
        if (addressSet.length) merged.circleAddress = addressSet[0];
        else delete merged.circleAddress;
      }
    }
    // maxDevicesPerMember — the circle's per-member device ceiling. Deterministic on every fold:
    // primary first, then set insertion order (trail order), truncated at the cap — so the
    // EARLIEST-proven devices keep their place and a device beyond the cap never projects.
    // No cap declared → unlimited (the default; the knob is the circle's to set).
    const cap = Number.isInteger(rules?.maxDevicesPerMember) && rules.maxDevicesPerMember > 0
      ? rules.maxDevicesPerMember : null;
    if (cap && addressSet.length > cap) addressSet.length = cap;
    if (addressSet.length) merged.circleAddresses = addressSet;
    else delete merged.circleAddresses;
    out.push(merged);
  }
  return out;
}

export default deriveRoster;
