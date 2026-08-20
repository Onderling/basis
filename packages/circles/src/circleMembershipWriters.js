import { hasHumanRules } from './circleRulesDoc.js';
/**
 * Key-coupled membership WRITERS — pure-body lift out of stoop's `buildSkills` (the §8c migration, slice-b).
 * These persist a circle's membership STATE transitions as typed `store.addItems([{type}])` items
 * (`membership-redemption` / `group-leave` / `group-removal`) — validation, redemption-ceiling, the
 * cross-circle-link proof, the admin gate, the roster upsert, the deletePosts loop. The state body is entirely
 * KEY-FREE.
 *
 * The one key-coupled step in each writer — the single trailing group-key grant/revoke — is left as an
 * INJECTED `grantKey`/`revokeKey` callback. Stoop binds it to `grant/revokePodAccess(controlAgent, …)`; the
 * key custodian (`controlAgent` + the sealing/keyStore handle) therefore NEVER enters this package. This keeps
 * `@onderling/circles` key-custody-agnostic and free of any `@onderling/pod-client` dependency (invariant 5,
 * the pure-DI rule in `index.js`).
 *
 * Each writer ALSO emits its membership transition onto the circle's SIGNED spine — the per-author, hash-chained
 * log the roster folds deterministically (join · leave · evict). That, too, is an INJECTED hook (`emitSpine`),
 * for the same reason the key step is: signing needs the acting device's circle-scoped identity + the chain
 * primitive, neither of which may enter this pure package. Stoop (and the journey harness) bind it to
 * `createSpineAppender({ store, signer })` from `@onderling/core`. The hook is OPTIONAL — absent, the writer
 * behaves exactly as before (the typed item is still written), so this is purely additive.
 *
 * Pure DI: imports NOTHING — every collaborator (store, members, metrics, simulateSync, notifier, the key hook,
 * and the validation helpers `codeRedeemableNow` · `inviteRedemptionVerdict` · `verifyCircleLink` ·
 * `withHandleClaim` · `collectCircleHandles` · `findHandleCollision` · `isCircleAdmin`, plus the
 * `INVITE_LIMIT_REACHED` constant) is passed in. Byte-identical to the pre-lift skill bodies; the caller's
 * test suite is the safety net.
 */

/**
 * redeemMembershipCode(deps, {a, from})
 *   — Phase 25.4 same-device redeem. Validates the presented code (current or within its 24h grace window),
 *   enforces the invite ceiling, records a `membership-redemption` audit item (binding the joiner's
 *   authenticated identity + any PROVEN per-circle address), upserts the roster, then grants pod access.
 *   `a` is the parsed skill args; `from` is the authenticated caller (the joiner).
 *
 * @returns {Promise<object>} `{redemptionId, groupId, validUntil, _sync}` (or `{…, alreadyRedeemed:true}` on
 *   an idempotent repeat), or `{error}`.
 */

/**
 * RULES-GATED ADMISSION (the rules-acceptance decision, sitting 2026-08-20 — added when the
 * modified-client journey proved fold-only gating toothless: the
 * post-join address announce seeds a roster row on every device regardless of the spine, so refusal
 * must ALSO happen at the ADMITTING device, before any announce fires). A circle with a rules doc
 * refuses a redeem that carries no accepted version, or an unknown one — {1..current}, versions being
 * monotonic integers, so acceptance of a then-current version stays valid after a rules change.
 * A circle WITHOUT a rules doc admits exactly as before. The joiner does not control this device.
 */
async function rulesAcceptanceRefusal(store, groupId, rulesAccepted) {
  let latest = null;
  try {
    const rules = await store.listOpen({ type: 'group-rules' });
    for (const it of rules ?? []) {
      if (it?.source?.groupId !== groupId) continue;
      if (typeof it?.source?.rules !== 'object' || !it.source.rules) continue;
      if (!latest || (it.addedAt ?? 0) > (latest.addedAt ?? 0)
        || ((it.addedAt ?? 0) === (latest.addedAt ?? 0) && it.id > latest.id)) latest = it;
    }
  } catch { latest = null; }
  if (!latest || !hasHumanRules(latest.source?.rules)) return null;   // operational-only doc → nothing to accept
  const current = Number.parseInt(latest.source?.version ?? latest.source?.rules?.version ?? 1, 10);
  const top = Number.isFinite(current) && current >= 1 ? current : 1;
  const v = typeof rulesAccepted === 'string' ? Number.parseInt(rulesAccepted, 10) : NaN;
  if (Number.isFinite(v) && v >= 1 && v <= top) return null;    // accepted a version this circle has had
  return { error: 'rules-acceptance-required', currentRulesVersion: String(top) };
}

export async function redeemMembershipCode({
  store, members, metrics, simulateSync, grantKey, emitSpine,
  codeRedeemableNow, inviteRedemptionVerdict, INVITE_LIMIT_REACHED, verifyCircleLink,
}, { a, from } = {}) {
  if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
  if (typeof a.code    !== 'string' || !a.code)    return { error: 'code required' };

  const all = await store.listOpen({ type: 'membership-code' });
  const forGroup = all.filter(i => i?.source?.groupId === a.groupId);
  const now = Date.now();
  const valid = forGroup.find(i => i.source.code === a.code && codeRedeemableNow(i, now));
  if (!valid) return { error: 'invalid-or-expired-code' };
  // Rules-gated admission (task #80) — refused BEFORE any row, key grant, announce or spine entry exists.
  const rulesRefusal = await rulesAcceptanceRefusal(store, a.groupId, a.rulesAccepted);
  if (rulesRefusal) return rulesRefusal;

  // The invite ceiling, checked on the store that HOLDS the code (this path is the same-device
  // redeem, so the issuer and the redeemer are the same store). A repeat by the same identity is
  // an idempotent success returning the original redemption; a new identity beyond the invite's
  // limit is refused here rather than admitted and counted afterwards.
  const limit = await inviteRedemptionVerdict({
    store, groupId: a.groupId, codeItem: valid, requesterWebid: from,
  });
  if (!limit.allow) return { error: INVITE_LIMIT_REACHED, used: limit.used, max: limit.max };
  if (limit.already) {
    return {
      redemptionId: limit.already.id,
      groupId:      a.groupId,
      validUntil:   valid.source.expiresAt,
      alreadyRedeemed: true,
      _sync:        simulateSync(),
    };
  }

  // ── Signing pubKey capture (circle fan-out fix) ────────────────────────
  // Bind the joiner's SIGNING pubKey to the AUTHENTICATED sender of the
  // redeem — `from` is the skill-invocation actor (= `envelope._from`,
  // stamped by the transport AFTER signature-verify), NOT a body field the
  // joiner could spoof.  In this architecture a member's webid IS their
  // secure-mesh signing address (basis binds `localActor` +
  // `members[].webid` to `chatId.pubKey`; the peer-bridge sets
  // `requesterWebid` from the authenticated NKN `fromAddr`), so the
  // authenticated identity for the joiner is `from` itself.  We DO NOT read
  // any body-supplied pubKey for the binding — a self-asserted key would let
  // a joiner claim another member's routing address.  Recording it lets
  // circle fan-out (`wireChat.send` → `MemberMap.resolveByWebid(webid).pubKey`)
  // route to a code-redeemer instead of returning `recipient-pubkey-unknown`.
  const signingPubKey = (typeof from === 'string' && from) ? from : null;
  // Wave B (SENSITIVE — cross-circle linkability): a presented per-circle address must be
  // PROVEN, not asserted. "Continue as an existing self" = present the address you already
  // use in another circle; anyone who has SEEN that address (a co-member there) could assert
  // it, so we require a signature by the key BEHIND the address over a challenge bound to
  // THIS join (Decision B — the signing proof). Deny-by-default: an unproven or forged
  // address is DROPPED — the join still succeeds, just WITHOUT the cross-circle linkage.
  const verifiedCircleAddress = (a.circleAddress
    && verifyCircleLink({ groupId: a.groupId, address: a.circleAddress, proof: a.circleAddressProof }))
    ? a.circleAddress : null;
  const [item] = await store.addItems([{
    type:       'membership-redemption',
    text:       `${from} redeemed membership code for ${a.groupId}`,
    source:     {
      groupId:   a.groupId,
      code:      a.code,
      codeId:    valid.id,
      redeemedBy: from,
      redeemedAt: now,
      expiresAt:  valid.source.expiresAt,
      // Sealing public key the joiner publishes so the household control-agent can wrap the
      // group key to them (distinct from their transport identity).
      ...(a.sealingPublicKey ? { sealingPublicKey: a.sealingPublicKey } : {}),
      // Signing pubKey (the joiner's transport/chat-agent identity) — mirror
      // of sealingPublicKey but for the OTHER key family: fan-out routing.
      ...(signingPubKey ? { signingPublicKey: signingPubKey } : {}),
      // Per-circle ADDRESS the joiner presents in THIS circle (identity step 5B/C —
      // deriveCircleAddress). Recorded ONLY when the signing proof verified above
      // (`verifiedCircleAddress`): a "continue as an existing self" linkage is provable,
      // never a bare claim a co-member could forge. Unproven ⇒ omitted (join still succeeds).
      ...(verifiedCircleAddress ? { circleAddress: verifiedCircleAddress } : {}),
      // …and the PROOF itself (2026-08-02). Kept, not discarded, because it is what lets this
      // device later RELAY the fact to a member who was not here — the receiver re-verifies it,
      // so carrying it grants the carrier nothing (`circleAddressAnnouncement.js`).
      ...(verifiedCircleAddress ? { circleAddressProof: a.circleAddressProof } : {}),
      // Property layer — the coarse background values the joiner CHOSE to disclose in THIS circle when
      // joining AS a persona (getPersonaRelease). Self-asserted like circleAddress; opt-in (absent = shared
      // nothing). A map {key: coarseValue}.
      ...(a.personaProperties && Object.keys(a.personaProperties).length ? { personaProperties: a.personaProperties } : {}),
      // Handle the joiner presented in THIS circle (Wave B). Recorded on the
      // JOINER's own redemption too so `listMyHandles` can surface it as a prior
      // handle next time (your own info; self-asserted like circleAddress).
      ...(typeof a.peerDisplay === 'string' && a.peerDisplay ? { peerDisplay: a.peerDisplay } : {}),
    },
    visibility: 'household',
  }], { actor: from });
  metrics?.record?.('group-code-redeemed');
  // Populate the MemberMap with the joiner's signing pubKey so fan-out can
  // resolve them.  Best-effort + additive — never throws (back-compat: an
  // older/no-auth redeem with no `from`, or a bundle with no MemberMap,
  // simply skips this and the redemption item is still written).
  if (members && signingPubKey) {
    try {
      await members.addMember({
        webid: from,
        pubKey: signingPubKey,
        ...(verifiedCircleAddress ? { circleAddress: verifiedCircleAddress } : {}),
        ...(a.personaProperties && Object.keys(a.personaProperties).length ? { personaProperties: a.personaProperties } : {}),
      });
    }
    catch { /* roster upsert is best-effort — never block the redeem */ }
  }
  await grantKey({ webId: from, sealingPublicKey: a.sealingPublicKey, groupId: a.groupId, metrics });
  // ALSO record this JOIN on the circle's membership spine — the durable, per-author SIGNED log the roster
  // folds deterministically (identical on every device, no wall-clock). This is a same-device redeem, so the
  // acting device IS the joiner: the injected emitter signs `join` with the joiner's own identity (author =
  // subject = the joiner) and chains it to their frontier. Additive: the typed redemption item above is
  // unchanged. Optional — a caller that has not wired the spine simply skips it.
  // The join's authorization rides the SIGNED payload: the redemption row it stands on. The fold admits a
  // self-authored join only when that row exists (deny-favouring: a not-yet-arrived row defers, never forges).
  await emitSpine?.({ kind: 'join', circleId: a.groupId, subject: from, actor: from, payload: {
    redemptionRef: item.id,
    // Rules acceptance rides the SIGNED join (task #80): the version the joiner accepted, or absent —
    // and absence is what a rules-gated fold refuses, on every receiving device.
    ...(typeof a.rulesAccepted === 'string' && a.rulesAccepted ? { rulesAccepted: a.rulesAccepted } : {}),
  } });
  return {
    redemptionId: item.id,
    groupId:      a.groupId,
    validUntil:   valid.source.expiresAt,
    _sync:        simulateSync(),
  };
}

/**
 * verifyMembershipCodeForPeer(deps, {a, from})
 *   — 2026-05-24 cross-instance redeem, ADMIN side. Validates the joiner-presented code in the admin's local
 *   store, enforces the ceiling + per-circle handle uniqueness (serialised per (circle, handle)), records the
 *   `membership-redemption` for `a.requesterWebid`, upserts the admin's roster, then grants pod access. Two
 *   grant sites (the idempotent-repeat branch and the main path). `from` is the admin (substrate runner).
 *
 * @returns {Promise<object>} `{redemptionId, codeId, groupId, validUntil, _sync}` (or `{…,
 *   alreadyRedeemed:true}`), or `{error}` (incl. `handle-taken`).
 */
export async function verifyMembershipCodeForPeer({
  store, members, metrics, simulateSync, grantKey, emitSpine,
  codeRedeemableNow, inviteRedemptionVerdict, INVITE_LIMIT_REACHED, verifyCircleLink,
  withHandleClaim, collectCircleHandles, findHandleCollision,
}, { a, from } = {}) {
  if (typeof a.groupId !== 'string' || !a.groupId)
    return { error: 'groupId required' };
  if (typeof a.code !== 'string' || !a.code)
    return { error: 'code required' };
  if (typeof a.requesterWebid !== 'string' || !a.requesterWebid)
    return { error: 'requesterWebid required' };

  const all = await store.listOpen({ type: 'membership-code' });
  const forGroup = all.filter(i => i?.source?.groupId === a.groupId);
  const now = Date.now();
  const valid = forGroup.find(i => i.source.code === a.code && codeRedeemableNow(i, now));
  if (!valid) return { error: 'invalid-or-expired-code' };
  // Rules-gated admission (task #80) — refused BEFORE any row, key grant, announce or spine entry exists.
  const rulesRefusal = await rulesAcceptanceRefusal(store, a.groupId, a.rulesAccepted);
  if (rulesRefusal) return rulesRefusal;

  // The invite-ceiling gate. This runs on the ADMIN's device, which is the device that writes the
  // membership; a joiner on any build, patched or not, cannot get past it, because getting in is
  // this function returning a row. A repeat by the same identity answers with the ORIGINAL
  // redemption id and writes nothing new (idempotent — re-scanning a QR must not punish anyone,
  // and a duplicate audit row is indistinguishable from a second person to anything counting).
  const limit = await inviteRedemptionVerdict({
    store, groupId: a.groupId, codeItem: valid, requesterWebid: a.requesterWebid,
  });
  if (!limit.allow) {
    metrics?.record?.('group-code-redeem-refused-limit');
    return { error: INVITE_LIMIT_REACHED, used: limit.used, max: limit.max };
  }

  // Wave B (SENSITIVE) — the peer path's copy of the cross-circle link proof check
  // (mirrors redeemMembershipCode): a presented per-circle address is recorded ONLY when
  // the joiner proved control of the key behind it. Deny-by-default; unproven ⇒ dropped.
  const verifiedCircleAddress = (a.circleAddress
    && verifyCircleLink({ groupId: a.groupId, address: a.circleAddress, proof: a.circleAddressProof }))
    ? a.circleAddress : null;

  // Per-circle handle uniqueness (Phase 4 Wave B — pinned rule: no duplicate
  // handles within a single circle), enforced HERE on the admin/host side —
  // the authority that owns the circle roster. The joiner's chosen handle
  // rides the redeem as `peerDisplay`; reject the join if another member of
  // THIS circle already holds it (case-folded, so `Jan`/`jan` collide),
  // rather than silently admitting a duplicate. The joiner re-presenting
  // their OWN handle (a re-send) is not a collision — excluded by
  // `requesterWebid`. Absent `peerDisplay` = no handle claimed → skip.
  // Signing pubKey for the peer path — the joiner's authenticated identity
  // is `requesterWebid`, which the admin-side basis handler
  // (`makeHandleGroupRedeemRequest`) sets from the AUTHENTICATED NKN
  // `fromAddr` of the group-redeem-request envelope, NOT from a
  // joiner-supplied claim.  A malicious joiner controls the request body
  // (code/shareCard/…) but not `fromAddr`, so they cannot bind another
  // member's key.  In this architecture webid == the secure-mesh signing
  // address, so the joiner's signing pubKey IS `requesterWebid`.
  // Declared OUTSIDE the handle-claim section below, which it outlives (roster upsert reads it).
  const peerSigningPubKey = a.requesterWebid;

  // The same identity, again: no second membership row. Their pod access + display row are
  // still refreshed below (both idempotent, and a reinstalled joiner may have a new sealing key),
  // so the repeat is a no-op in the ledger and a refresh everywhere it is safe to be one.
  if (limit.already) {
    if (members && a.requesterWebid) {
      try {
        await members.addMember({
          webid: a.requesterWebid,
          pubKey: a.requesterWebid,
          ...(verifiedCircleAddress ? { circleAddress: verifiedCircleAddress } : {}),
        });
      } catch { /* best-effort, exactly as on the first redeem */ }
    }
    await grantKey({ webId: a.requesterWebid, sealingPublicKey: a.sealingPublicKey, groupId: a.groupId, metrics });
    return {
      redemptionId: limit.already.id,
      codeId:       valid.id,
      groupId:      a.groupId,
      validUntil:   valid.source.expiresAt,
      alreadyRedeemed: true,
      _sync:        simulateSync(),
    };
  }

  // SERIALISED per (circle, handle) — the uniqueness check and the redemption write are separated by
  // awaits, so two joiners redeeming the same invite and both claiming `@jan` each read a roster with
  // no `jan` and each wrote one (story 2.1: three concurrent claims produced three members named jan).
  // The lock is per (circle, handle), so unrelated joins still run concurrently.
  const claimed = await withHandleClaim(store, a.groupId, a.peerDisplay, async () => {
    if (typeof a.peerDisplay === 'string' && a.peerDisplay) {
      const takenHandles = await collectCircleHandles({ store, members, groupId: a.groupId });
      if (findHandleCollision({ candidate: a.peerDisplay, claimantWebid: a.requesterWebid, taken: takenHandles })) {
        return { error: 'handle-taken', reason: 'handle-taken' };
      }
    }

    const [item] = await store.addItems([{
      type:       'membership-redemption',
      text:       `${a.requesterWebid} redeemed (via peer) membership code for ${a.groupId}`,
      source:     {
        groupId:        a.groupId,
        code:           a.code,
        codeId:         valid.id,
        redeemedBy:     a.requesterWebid,
        redeemedAt:     now,
        expiresAt:      valid.source.expiresAt,
        confirmedBy:    from,
        channel:        'peer',
        // Signing pubKey (fan-out routing) — see note above; mirrors sealingPublicKey.
        ...(peerSigningPubKey ? { signingPublicKey: peerSigningPubKey } : {}),
        // joiner's mesh-consent token.
        // When true, admin propagates this peer's address to
        // other members (+ propagates other consenting members'
        // addresses to this joiner).  When false, the joiner
        // stays star-routed via admin.
        ...(a.shareCard ? { shareCard: true } : {}),
        ...(typeof a.peerDisplay === 'string' && a.peerDisplay ? { peerDisplay: a.peerDisplay } : {}),
        // The joiner's sealing public key (forwarded by the peer bridge) → the control-agent wraps
        // the group key to them. Admin-side: this is where the sealed household pod grants access.
        ...(a.sealingPublicKey ? { sealingPublicKey: a.sealingPublicKey } : {}),
        // Per-circle ADDRESS the joiner presents in THIS circle (identity step 5B/C) —
        // forwarded by the peer bridge, recorded ONLY when its cross-circle link proof verified.
        ...(verifiedCircleAddress ? { circleAddress: verifiedCircleAddress } : {}),
        // …and its PROOF (2026-08-02), so the ADMIN can relay this member's address on to the
        // other members — who verify it themselves rather than taking the admin's word.
        ...(verifiedCircleAddress ? { circleAddressProof: a.circleAddressProof } : {}),
        // Property layer — the joiner's disclosed persona properties (forwarded by the peer bridge).
        ...(a.personaProperties && Object.keys(a.personaProperties).length ? { personaProperties: a.personaProperties } : {}),
      },
      visibility: 'household',
    }], { actor: from });
    return { item };
  });
  if (claimed?.error) return claimed;
  const item = claimed.item;
  metrics?.record?.('group-code-redeemed-peer');
  // Populate the admin's MemberMap so the admin (and, via mesh-intro
  // propagation, other members) can fan out to the new joiner.  Best-effort.
  if (members && peerSigningPubKey) {
    try {
      await members.addMember({
        webid: a.requesterWebid,
        pubKey: peerSigningPubKey,
        ...(verifiedCircleAddress ? { circleAddress: verifiedCircleAddress } : {}),
        ...(a.personaProperties && Object.keys(a.personaProperties).length ? { personaProperties: a.personaProperties } : {}),
      });
    }
    catch { /* roster upsert is best-effort — never block the redeem */ }
  }
  await grantKey({ webId: a.requesterWebid, sealingPublicKey: a.sealingPublicKey, groupId: a.groupId, metrics });
  // ALSO record this JOIN on the circle's membership spine (as `redeemMembershipCode` does). This is the
  // ADMIN's device confirming a REMOTE joiner, who is not here to sign — so the ADMIN signs `join` with their
  // own identity (author = admin, subject = the joiner). Admin authorship is sound: the admin is the authority
  // that validated the code + enforced the ceiling, and a join needs no authority in the fold anyway. Additive.
  await emitSpine?.({ kind: 'join', circleId: a.groupId, subject: a.requesterWebid, actor: from, payload: {
    redemptionRef: item.id,
    // The remote joiner's acceptance, forwarded from the redeem request (task #80). The admin signs the
    // join; the acceptance value is the joiner's — recorded verbatim, refused-at-fold when absent on a
    // rules-gated circle.
    ...(typeof a.rulesAccepted === 'string' && a.rulesAccepted ? { rulesAccepted: a.rulesAccepted } : {}),
  } });
  return {
    redemptionId: item.id,
    codeId:       valid.id,
    groupId:      a.groupId,
    validUntil:   valid.source.expiresAt,
    _sync:        simulateSync(),
  };
}

/**
 * leaveGroup(deps, {a, from})
 *   — record a `group-leave` audit marker, revoke the leaver's pod ACL + rotate the group key (graceful:
 *   the leaver keeps content they already hold), then optionally delete the actor's own items + cancel any
 *   pending lend reminders. `from` is the leaving actor.
 *
 * @returns {Promise<{leaveMarkerId, deletedItems, _sync}|{error}>}
 */
export async function leaveGroup({
  store, simulateSync, notifier, revokeKey, emitSpine,
}, { a, from } = {}) {
  if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };

  const [marker] = await store.addItems(
    [{
      type:       'group-leave',
      text:       `${from} left ${a.groupId}`,
      source:     { groupId: a.groupId, leftBy: from, leftAt: Date.now() },
      visibility: 'household',
    }],
    { actor: from },
  );

  // Sealed household pod: revoke the leaver's ACL + rotate the group key (forward secrecy) + drop
  // them from the MemberMap so fan-out stops. A self-leave is 'graceful' — the leaver keeps access
  // to content they already had on their device.
  await revokeKey({ webId: from, policy: 'graceful', groupId: a.groupId });

  // ALSO record the LEAVE on the circle's membership spine. A leave is always self-authored (the fold only
  // honours a leave whose author IS its subject), so the acting device signs `leave` with its own identity
  // (author = subject = the leaver). Additive to the typed `group-leave` marker above; optional hook.
  await emitSpine?.({ kind: 'leave', circleId: a.groupId, subject: from, actor: from });

  let deleted = 0;
  if (a.deletePosts) {
    const myItems = (await store.listOpen({})).filter(i => i.addedBy === from && i.id !== marker.id);
    for (const it of myItems) {
      await store.removeItems([{ id: it.id }], { actor: from });
      // Also cancel any lend reminders the user had pending.
      if (notifier) {
        try { await notifier.cancel(`due:${it.id}`); } catch {}
      }
      deleted += 1;
    }
  }
  return { leaveMarkerId: marker.id, deletedItems: deleted, _sync: simulateSync() };
}

/**
 * removeMember(deps, {a, from})
 *   — admin-only. Records a `group-removal` audit item (naming the RESOLVED webid so the roster projection
 *   can match it), then rotates the group key + re-seals history per policy (graceful|ban) via the injected
 *   revoke hook (`force` overrides the ≥1-admin guard — the op's own admin gate is the authority). `from` is
 *   the admin.
 *
 * @returns {Promise<{removalId, revoked, policy}|{error}>}
 */
export async function removeMember({
  store, members, revokeKey, isCircleAdmin, emitSpine, defaultGroupId = null,
}, { a, from } = {}) {
  const _groupId = a.groupId ?? defaultGroupId;
  if (!_groupId) return { error: 'groupId required' };
  if (!a.memberStableId && !a.memberWebid) {
    return { error: 'memberStableId or memberWebid required' };
  }
  if (members) {
    const me = await members.resolveByWebid(from);
    const isAdmin = isCircleAdmin(me?.role);
    if (!isAdmin) return { error: 'admin-only' };
  }
  // Resolve the target's webid (webid === signing key). Prefer an explicit webid; fall back to a
  // stableId resolver if the MemberMap offers one.
  let memberWebid = a.memberWebid ?? null;
  if (!memberWebid && a.memberStableId && members && typeof members.resolveByStableId === 'function') {
    memberWebid = (await members.resolveByStableId(a.memberStableId))?.webid ?? null;
  }
  const policy = a.policy === 'ban' ? 'ban' : 'graceful';

  // The RESOLVED webid, not only what the caller happened to pass. An admin who removes by
  // stableId used to write a row naming nobody the roster projection could match, so the removal
  // was unprojectable and therefore inert. `memberStableId` is still recorded for the audit.
  const [item] = await store.addItems([{
    type:       'group-removal',
    text:       `${memberWebid ?? a.memberStableId} removed from ${_groupId} (${policy})`,
    visibility: 'household',
    source: {
      groupId:        _groupId,
      memberStableId: a.memberStableId ?? null,
      memberWebid:    memberWebid      ?? null,
      removedBy:      from,
      removedAt:      Date.now(),
      policy,
      reason:         a.reason ?? null,
    },
  }], { actor: from });

  // ACTUALLY revoke (not just record intent): rotate the group key + re-seal history per policy +
  // drop the member from the MemberMap (fan-out stops). `force` — an admin removal overrides the
  // ≥1-admin guard for a non-self target; the op's own admin-gate above is the authority.
  let revoked = false;
  if (memberWebid) {
    await revokeKey({ webId: memberWebid, force: true, policy, groupId: _groupId });
    revoked = true;
    // ALSO record the EVICT on the circle's membership spine. The admin authored the removal (their admin gate
    // above is the authority); they sign `evict` with their own identity (author = admin, subject = the removed
    // member). The roster fold re-derives WHO may evict (deny-wins) from the same statements on every device.
    // Additive to the typed `group-removal` item; optional hook. Only when the target webid resolved.
    await emitSpine?.({ kind: 'evict', circleId: _groupId, subject: memberWebid, actor: from });
  }
  return { removalId: item.id, revoked, policy };
}
