/**
 * Per-circle ADDRESS announcing — the receive half (`recordCircleAddress`) and
 * the send half (`fanCircleAddresses`). Lifted verbatim out of stoop's
 * `buildSkills` so the address record/patch logic, the release (persona
 * properties) propagation, its change-detector, and the fan assembly live once
 * in the circles substrate and cannot drift across callers (invariant 3 — logic
 * lives once).
 *
 * A join teaches exactly two devices about each other: the joiner proves its
 * per-circle address to the admin, and the admin's proven address rides back on
 * the redeem response. Two JOINERS were never taught each other's, so in a
 * circle of three, admin↔joiner delivery worked and joiner↔joiner silently did
 * not. These two functions are where that missing fact lands and where it is
 * fanned.
 *
 * Pure lift via dependency injection: this module is self-contained given its
 * `deps` and imports NOTHING — not from an app (packages never depend UP on
 * apps) and not from `@onderling/core` (the verify helpers + the announce kind
 * are injected instead, keeping the package dep surface minimal, exactly as the
 * fan-out core injects `toWireRefEnvelope` rather than depending on item-store).
 */

/**
 * Record a member's PROVEN per-circle address (the receive half of address
 * announcing).
 *
 * PROOF, not claim. The announcement is verified with the same deny-by-default
 * `verifyCircleLink` the join uses, via the injected `verifyCircleAddressAnnouncement`.
 * An unproven or forged address writes NOTHING and answers
 * `{ok:false, reason:'unproven-address'}` — an honest refusal, never a silent no-op.
 *
 * WHOSE row may this write? A
 * REMOTE caller may only ever write their OWN row (`memberWebid` ignored, `from`
 * wins) and may only UPDATE a row that already exists — a stranger cannot
 * announce themselves into a circle. The LOCAL path (the peer bridge, which
 * substitutes the authenticated envelope sender, and the admin relaying a
 * member's announcement on) may name a member and may create their row: the same
 * carrier position `recordPeerIntro` already occupies.
 *
 * It PATCHES the durable trail rather than appending a second row, because
 * `deriveRoster` merges trail rows first-non-null-wins: a second row carrying a
 * NEW address would lose to the stale one it was meant to replace. Both shapes
 * are patched — the member's own `circleAddress` and, when they are the admin we
 * joined through, `confirmedByCircleAddress`. A patch never EVICTS a previously
 * proven address: the new one takes the primary slot and the prior proven
 * {address, proof} pairs are kept beside it (`circleAddresses` /
 * `confirmedByCircleAddresses`), so a member reachable on two addresses (a
 * second device, a restored profile) stays reachable — and authorized — on both.
 *
 * @param {object} deps
 * @param {object} deps.store                            the circle's ItemStore.
 * @param {Function} deps.verifyCircleAddressAnnouncement the deny-by-default proof verifier.
 * @param {Function} deps.simulateSync                    the `_sync` shape producer.
 * @param {object} args
 * @param {object} args.a          the parsed skill data (`{groupId, memberWebid?, circleAddress, circleAddressProof, personaProperties?}`).
 * @param {string} args.from       the authenticated caller (envelope sender).
 * @param {?string} args.localActor this device's own webid (the LOCAL-carrier discriminator).
 * @returns {Promise<object>} `{ ok:true, groupId, memberWebid, circleAddress, patched, created, unchanged }`
 *          | `{ ok:false, reason }`.
 */
export async function recordCircleAddress(
  { store, verifyCircleAddressAnnouncement, simulateSync },
  { a, from, localActor },
) {
  if (typeof a.groupId !== 'string' || !a.groupId) return { ok: false, reason: 'groupId-required' };

  const isLocalCall = !!localActor && from === localActor;
  const requested = (typeof a.memberWebid === 'string' && a.memberWebid) ? a.memberWebid : null;
  const webid = (isLocalCall && requested) ? requested : from;
  if (!webid) return { ok: false, reason: 'member-unresolved' };
  if (requested && requested !== webid) return { ok: false, reason: 'may-only-write-own-row' };

  const proven = verifyCircleAddressAnnouncement({
    circleId:           a.groupId,
    memberWebid:        webid,
    circleAddress:      a.circleAddress,
    circleAddressProof: a.circleAddressProof,
    personaProperties:  a.personaProperties,
    // the declared ceremony commitment (core ceremonyCommitment.js) rides with its circle-key signature
    ceremonyCommitment:      a.ceremonyCommitment,
    ceremonyCommitmentProof: a.ceremonyCommitmentProof,
  }, a.groupId);
  if (!proven) return { ok: false, reason: 'unproven-address' };
  // The member's RELEASE rides the (proof-verified) address, carried under the same roster-level
  // trust as the webid attribution. Written only onto the member's OWN row below, never merged
  // blindly: a plain object or nothing. This is what makes a released name reach a co-member.
  const releasedProps = (proven.personaProperties && typeof proven.personaProperties === 'object'
    && !Array.isArray(proven.personaProperties)) ? proven.personaProperties : null;

  let all = [];
  try { all = await store.listOpen({ type: 'membership-redemption' }); } catch { all = []; }
  const forGroup = (all ?? []).filter((i) => i?.source?.groupId === a.groupId);

  let patched = 0;
  let unchanged = 0;
  // THE PRIMARY CONTACT ADDRESS IS THE MEMBER'S CHOICE (2026-09-17, sync-policy §12). A newly proven address
  // never EVICTS one already on the row — both belong to the member (a second device, a restored profile) and
  // delivery + sender authorization keep accepting the whole set — and it never DISPLACES the primary either:
  // until then the last device to announce (every boot re-announces) took the primary slot, so enrolling a
  // box made the box the primary the moment it booted. Now the primary slot changes hands only when the
  // announcement says so (`primary: true` — the member tapped "make this my primary contact address" on that
  // device) or when the row has no proven primary yet (the address that joined). A plain announce ADDS its
  // address behind the primary, in announce order. Only pairs carrying their proof survive — an address that
  // cannot be re-proven downstream never enters the set (deny-by-default, the same rule `deriveRoster` applies).
  const choosePrimary = a.primary === true;
  const orderSet = (pairs, first) => {
    const kept = [];
    const seen = new Set([first]);
    for (const p of pairs) {
      if (!p || typeof p.address !== 'string' || !p.address) continue;
      if (typeof p.proof !== 'string' || !p.proof) continue;
      if (seen.has(p.address)) continue;
      seen.add(p.address);
      kept.push({ address: p.address, proof: p.proof });
    }
    return kept;
  };
  /** The next `{ primary, primaryProof, rest }` for a row holding `{ primary, primaryProof, rest }` — or null when nothing moves. */
  const placeAddress = (curPrimary, curPrimaryProof, curRest) => {
    const have = [{ address: curPrimary, proof: curPrimaryProof }, ...(Array.isArray(curRest) ? curRest : [])];
    const known = have.some((p) => p?.address === proven.circleAddress && p?.proof === proven.circleAddressProof);
    if (choosePrimary || !curPrimary) {
      if (curPrimary === proven.circleAddress && curPrimaryProof === proven.circleAddressProof) return null;
      return { primary: proven.circleAddress, primaryProof: proven.circleAddressProof, rest: orderSet(have, proven.circleAddress) };
    }
    if (known) return null;
    return { primary: curPrimary, primaryProof: curPrimaryProof, rest: [...orderSet(have, curPrimary), { address: proven.circleAddress, proof: proven.circleAddressProof }] };
  };
  for (const it of forGroup) {
    const src = it.source ?? {};
    let next = null;
    if (src.redeemedBy === webid) {
      // Unchanged only when NEITHER the address NOR the release moved — an announcement that
      // carries a NEW release for an already-known address must still patch the row, or a
      // released name would never land on a device that already had the address.
      const releaseChanged = !!releasedProps
        && JSON.stringify(src.personaProperties ?? null) !== JSON.stringify(releasedProps);
      const commitmentNew = !!proven.ceremonyCommitment && !src.ceremonyCommitment;
      const placed = placeAddress(src.circleAddress, src.circleAddressProof, src.circleAddresses);
      if (!placed && !releaseChanged && !commitmentNew) { unchanged += 1; continue; }
      const kept = placed ? placed.rest : orderSet([...(Array.isArray(src.circleAddresses) ? src.circleAddresses : [])], src.circleAddress);
      next = {
        circleAddress:      placed ? placed.primary : src.circleAddress,
        circleAddressProof: placed ? placed.primaryProof : src.circleAddressProof,
        // THE CEREMONY COMMITMENT: who may retire this member's addresses — their owner root, at a
        // ceremony (core `ceremonyCommitment.js`). Declared and circle-key-signed in the announcement,
        // verified before this point. First-write-wins: a member's root does not change.
        ...((!src.ceremonyCommitment && proven.ceremonyCommitment) ? { ceremonyCommitment: proven.ceremonyCommitment } : {}),
        // …the previously proven addresses SURVIVE beside the new primary (the set — task above).
        ...((kept.length || src.circleAddresses) ? { circleAddresses: kept } : {}),
        // A row learned from an intro carries no key at all; without one
        // `bindCircleAddressKeys` skips the address it was just given. webid IS the member's
        // signing address in a basis circle (the same fact the ladder's webid rung relies on).
        ...(src.signingPublicKey ? {} : { signingPublicKey: webid }),
        // …and the member's release, when the announcement carried one — completing the roster
        // projection so a released name reaches this device. Absent → the row's release is left
        // exactly as it was (an announcement without a release never ERASES one).
        ...(releasedProps ? { personaProperties: releasedProps } : {}),
      };
    } else if (src.confirmedBy === webid && src.channel === 'peer') {
      const placed = placeAddress(src.confirmedByCircleAddress, src.confirmedByCircleAddressProof, src.confirmedByCircleAddresses);
      const mirrorCommitmentNew = !!proven.ceremonyCommitment && !src.confirmedByCeremonyCommitment;
      if (!placed && !mirrorCommitmentNew) { unchanged += 1; continue; }
      const kept = placed ? placed.rest : orderSet([...(Array.isArray(src.confirmedByCircleAddresses) ? src.confirmedByCircleAddresses : [])], src.confirmedByCircleAddress);
      next = {
        confirmedByCircleAddress:      placed ? placed.primary : src.confirmedByCircleAddress,
        confirmedByCircleAddressProof: placed ? placed.primaryProof : src.confirmedByCircleAddressProof,
        ...((!src.confirmedByCeremonyCommitment && proven.ceremonyCommitment) ? { confirmedByCeremonyCommitment: proven.ceremonyCommitment } : {}),
        ...((kept.length || src.confirmedByCircleAddresses) ? { confirmedByCircleAddresses: kept } : {}),
      };
    }
    if (!next) continue;
    try {
      await store.update(it.id, { source: { ...src, ...next } }, { actor: from });
      patched += 1;
    } catch { /* one unwritable row must not cost the others their update */ }
  }

  let created = 0;
  if (patched === 0 && unchanged === 0) {
    // Nobody by this webid on the trail yet. Only the LOCAL carrier may introduce them — see the
    // "whose row" note above; a remote self-announce from a non-member is refused outright.
    if (!isLocalCall) return { ok: false, reason: 'not-a-member' };
    const [item] = await store.addItems([{
      type:       'membership-redemption',
      text:       `${webid} announced a per-circle address for ${a.groupId}`,
      source:     {
        groupId:            a.groupId,
        redeemedBy:         webid,
        signingPublicKey:   webid,
        circleAddress:      proven.circleAddress,
        circleAddressProof: proven.circleAddressProof,
        ...(proven.ceremonyCommitment ? { ceremonyCommitment: proven.ceremonyCommitment } : {}),
        channel:            'announce',
        announcedAt:        Date.now(),
        ...(releasedProps ? { personaProperties: releasedProps } : {}),
      },
      visibility: 'household',
    }], { actor: from });
    created = item ? 1 : 0;
  }

  return {
    ok: true,
    groupId:       a.groupId,
    memberWebid:   webid,
    circleAddress: proven.circleAddress,
    patched, created,
    unchanged: patched === 0 && created === 0,
    _sync: simulateSync(),
  };
}

/**
 * Fan proven per-circle ADDRESS announcements to a circle (the send half).
 * Circle-scoped fan-out plumbing,
 * subtype `circle-address-announce`.
 *
 * It carries a LIST because one mechanism serves all three moments:
 *   • a member RE-ANNOUNCING their own address  → one announcement, unnarrowed fan;
 *   • the admin telling the circle about a NEW member → one announcement, unnarrowed fan;
 *   • the admin telling that new member about EVERYONE → many announcements, `to:[joiner]`.
 * The third is what actually closes the joiner↔joiner gap: a fresh joiner cannot
 * yet address the other members, so the fact has to travel from someone who can
 * reach both — and it can, without trusting them, because every announcement
 * carries its own proof.
 *
 * Verified BEFORE it is fanned, not only on arrival: nothing unprovable should
 * occupy the wire, and a caller who assembled the list wrongly finds out here
 * rather than in silence.
 *
 * Never wakes a device (silent lane): learning where to send is housekeeping,
 * not news.
 *
 * @param {object} deps
 * @param {Function} deps.verifyCircleAddressAnnouncements the list proof verifier.
 * @param {Function} deps.broadcastToCircle                the circle fan-out core.
 * @param {string} deps.announceKind                       the announce subtype (`CIRCLE_ADDRESS_ANNOUNCE_KIND`).
 * @param {object} args
 * @param {object} args.a          the parsed skill data (`{groupId?, announcements, to?, msgId?, ts?}`).
 * @param {?string} args.groupId   the bundle's active-circle default.
 * @param {string} args.from       the authenticated caller (fan-out sender).
 * @returns {Promise<object>} the fan result, or `{error}`.
 */
export async function fanCircleAddresses(
  { verifyCircleAddressAnnouncements, broadcastToCircle, announceKind },
  { a, groupId, from },
) {
  const _groupId = a.groupId ?? groupId;
  if (!_groupId) return { error: 'groupId-required' };
  const announcements = verifyCircleAddressAnnouncements(a.announcements, _groupId);
  if (!announcements.length) return { error: 'no-proven-announcements' };
  const ts = typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : Date.now();
  const msgId = (typeof a.msgId === 'string' && a.msgId)
    ? a.msgId
    : `ca-${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // `to` NARROWS the fan to named members (the admin's "here is everyone, for you alone" send).
  const only = Array.isArray(a.to) ? a.to.filter((x) => typeof x === 'string' && x) : null;
  return broadcastToCircle({
    circleId: _groupId, kind: announceKind, from,
    extras: { circleId: _groupId, msgId, ts, announcements },
    metric: 'circle-address-announce-fanout',
    noWake: true,
    only,
  });
}
