/**
 * Zero-key membership writers — pure DI lift out of stoop's `buildSkills` (the §8c migration, slice-a). These
 * persist a circle's governance rules, and the join-time rules/privacy acceptance record; none touches key
 * material (the group content key bootstraps LAZILY on the first `controlAgent.addMember`), so they move
 * without the key-custody plumbing. Logic lives ONCE here (invariant 3); stoop keeps only a thin `defineSkill`
 * wrapper that injects `store` (+ `simulateSync` where the skill returned one) and passes the parsed args.
 *
 * Pure DI: imports NOTHING — not from an app (packages never depend UP on apps) and not from `@onderling/core`.
 * Byte-identical to the pre-lift skill bodies; the caller's test suite is the safety net.
 */

/**
 * createGroupWithRules({store, simulateSync}, {a, from})
 *   — persist a circle's governance rules (V1 admin wizard output). `a` is the parsed skill args
 *   (`{groupId, name, rules}`); `from` is the authenticated caller (the item's actor).
 *
 * @returns {Promise<{rulesId, groupId, _sync}|{error:string}>}
 */
export async function createGroupWithRules({ store, simulateSync, emitSpine = null }, { a, from } = {}) {
  if (typeof a?.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
  if (typeof a?.name    !== 'string' || !a.name)    return { error: 'name required' };
  if (typeof a?.rules   !== 'object' || a.rules === null) return { error: 'rules object required' };
  const [item] = await store.addItems(
    [{
      type:       'group-rules',
      text:       a.name,
      source:     { groupId: a.groupId, rules: a.rules, version: 1 },
      visibility: 'household',
    }],
    { actor: from },
  );
  // THE CIRCLE'S CREATION, on the membership spine — the creator's self-signed first statement and
  // the root of its authority. Injected like the other spine hooks in this package: signing needs
  // the acting device's circle-scoped identity, which must not enter a pure module.
  //
  // Why it exists at all: founders are otherwise derived from the admission trail (the admitters who
  // never redeemed), and a brand-new circle has admitted nobody — so its creator could not be
  // derived, and was locked out of the circle they had just made. This is the statement that says
  // "I made this", signed, on the lane, and fanned to everyone who later joins.
  //
  // It is NOT a licence to self-appoint: a receiver folds it as foundership only where its own trail
  // corroborates the author, or where it has no trail for the circle at all — which is exactly the
  // brand-new case. Best-effort, like every other spine hook here: the circle still exists without it.
  if (typeof emitSpine === 'function') {
    try { await emitSpine({ kind: 'create', circleId: a.groupId, subject: from, payload: {}, actor: from }); }
    catch { /* the typed item is written; the statement can be re-derived by a later ceremony */ }
  }
  return { rulesId: item.id, groupId: a.groupId, _sync: simulateSync() };
}

/**
 * redeemInviteWithGate({store}, {a, from})
 *   — Phase 17 join gate: verify privacy + rules acceptance, then persist a `rules-accept` record BEFORE the
 *   downstream redeem runs. `a` is `{invite, privacyAccepted, rulesAccepted}`; `from` is the accepting caller.
 *   Zero-key (the acceptance record is a plain typed item).
 *
 * @returns {Promise<{ok:true, groupId, acceptanceId}|{error:string}>}
 */
export async function redeemInviteWithGate({ store }, { a, from } = {}) {
  if (!a?.invite) return { error: 'invite required' };
  if (a.privacyAccepted !== true) return { error: 'privacy-not-accepted' };
  if (a.rulesAccepted   !== true) return { error: 'rules-not-accepted' };
  const groupId = a.invite?.groupId;
  if (!groupId) return { error: 'invite missing groupId' };
  const [item] = await store.addItems([{
    type:       'rules-accept',
    text:       `Accepted rules of ${groupId}`,
    source:     { groupId, acceptedBy: from, acceptedAt: Date.now(), gateVersion: 'phase-17' },
    visibility: 'household',
  }], { actor: from });
  return { ok: true, groupId, acceptanceId: item.id };
}

/**
 * createGroupV2(deps, {a, from})
 *   — Phase 25.3 self-create: the caller becomes admin; persists the rules (with rotation + storage config
 *   embedded) + mints an initial membership code (returned ONCE). Zero-key — the group content key bootstraps
 *   LAZILY on the first `controlAgent.addMember`, so this touches no key material.
 *
 * The stoop-local storage/code helpers, the invite-ceiling clamp + cap, and the best-effort pod-routing policy
 * push are INJECTED so this module stays pure (imports nothing from apps/core):
 *   `deps = {store, members, metrics, simulateSync, clampInviteMaxRedemptions, INVITE_REDEMPTION_SYSTEM_CAP,
 *            validateStoragePolicy, buildStoragePolicy, freshMembershipCode, setCirclePolicy}`.
 *
 * @returns {Promise<object|{error:string}>}  `{groupId, rulesId, codeId, code, expiresAt, keyRotationMode,
 *   rotationDays, storage, _sync}` on success.
 */
export async function createGroupV2({
  store, members, metrics, simulateSync,
  clampInviteMaxRedemptions, INVITE_REDEMPTION_SYSTEM_CAP,
  validateStoragePolicy, buildStoragePolicy, freshMembershipCode, setCirclePolicy,
  // The circle's creation statement — see `createGroupWithRules` above for what it is and why a
  // receiver cannot be crowned by one.
  emitSpine = null,
}, { a, from } = {}) {
  if (typeof a?.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
  if (typeof a?.name    !== 'string' || !a.name)    return { error: 'name required' };
  if (typeof a?.rules   !== 'object' || a.rules === null) return { error: 'rules object required' };

  const keyRotationMode = (a.keyRotationMode === 'peer-distributable') ? 'peer-distributable' : 'admin-only';
  const rotationDays = (typeof a.rotationDays === 'number' && a.rotationDays >= 1 && a.rotationDays <= 365)
    ? a.rotationDays : 30;
  // Admin-controlled membership-code lifetime (hours), decoupled from key rotation (short codes default to 1h
  // so ad-hoc shares don't leak a live join secret for weeks). Range 1–8760 (1h–1y).
  const inviteExpiresInHours = (typeof a.inviteExpiresInHours === 'number'
      && a.inviteExpiresInHours >= 1 && a.inviteExpiresInHours <= 8760)
    ? a.inviteExpiresInHours : 1;
  // The circle's CEILING on how many people one invite may admit (stored in the rules blob, clamped here to
  // the system cap — the one place a circle's number meets it).
  const inviteMaxRedemptions = clampInviteMaxRedemptions(a.inviteMaxRedemptions, INVITE_REDEMPTION_SYSTEM_CAP);

  // Storage policy (§II.2): default no-pod; centralised/hybrid require a groupPodUri.
  const storageErr = validateStoragePolicy(a.storagePolicy, a.groupPodUri);
  if (storageErr) return { error: storageErr };
  const storage = buildStoragePolicy(a.storagePolicy, a.groupPodUri);

  const rulesWithRotation = {
    ...a.rules, keyRotationMode, rotationDays, inviteExpiresInHours, inviteMaxRedemptions, storage, version: 1,
  };
  const [rulesItem] = await store.addItems(
    [{
      type:       'group-rules',
      text:       a.name,
      source:     { groupId: a.groupId, rules: rulesWithRotation, version: 1 },
      visibility: 'household',
    }],
    { actor: from },
  );

  // Mint the initial membership code.
  const code      = freshMembershipCode();
  const issuedAt  = Date.now();
  const expiresAt = issuedAt + inviteExpiresInHours * 60 * 60 * 1000;
  const [codeItem] = await store.addItems(
    [{
      type:       'membership-code',
      text:       `Membership code for ${a.groupId}`,
      source:     {
        groupId: a.groupId, code, issuedAt, expiresAt,
        issuedBy: from, rotationDays, keyRotationMode, inviteExpiresInHours,
        // What THIS invite permits, within the circle's ceiling. The first code takes the ceiling itself.
        maxRedemptions: clampInviteMaxRedemptions(a.inviteMaxRedemptions, inviteMaxRedemptions),
      },
      visibility: 'household',
    }],
    { actor: from },
  );

  // Promote the caller to admin in MemberMap (idempotent) + record their own per-circle address if supplied
  // (no proof gate — the creator IS the authority for a circle they own, unlike the redeem path).
  if (members) {
    const me = (await members.resolveByWebid(from)) ?? { webid: from };
    await members.addMember({
      ...me,
      role: 'admin',
      ...(a.circleAddress ? { circleAddress: a.circleAddress } : {}),
      ...(a.personaProperties && Object.keys(a.personaProperties).length ? { personaProperties: a.personaProperties } : {}),
    });
  }

  // Push the storage policy into pod-routing so substrate-mirror / notify honour it (best-effort — the
  // rules item is the source of truth; the injected closure carries the optional-chain over an absent bundle).
  try { await setCirclePolicy?.(a.groupId, storage); } catch { /* best-effort */ }

  metrics?.record?.('group-create-v2');
  // The creation statement — the signed root of this circle's authority. See the note on
  // `createGroupWithRules`: a receiver folds it as foundership only where its own trail corroborates
  // the author, or where it has no trail for the circle at all.
  if (typeof emitSpine === 'function') {
    try { await emitSpine({ kind: 'create', circleId: a.groupId, subject: from, payload: {}, actor: from }); }
    catch { /* best-effort, like every spine hook here */ }
  }
  return {
    groupId:         a.groupId,
    rulesId:         rulesItem.id,
    codeId:          codeItem.id,
    code,                          // returned ONCE so the caller can hand it out
    expiresAt,
    keyRotationMode,
    rotationDays,
    storage,
    _sync:           simulateSync(),
  };
}
