/**
 * Roster read/write/announce — the three roster-facing operations lifted verbatim
 * out of stoop's `buildSkills` so the roster access gate, the persona-property
 * write, and the roster-updated fan live once in the circles substrate and cannot
 * drift across callers (invariant 3 — logic lives once).
 *
 * Pure lift via dependency injection: this module is self-contained given its
 * `deps` and imports NOTHING — not from an app (packages never depend UP on apps)
 * and not from `@onderling/agent-registry` (the release-key diff `changedReleaseKeys`
 * is injected instead, keeping the package dep surface minimal, exactly as the
 * fan-out core injects `toWireRefEnvelope` rather than depending on item-store).
 *
 * The shared helpers `readCircleExits`/`isExited` (stoop's `lib/circleExits.js`)
 * and `rosterCallerIsForeign` (stoop's `lib/rosterAccessGate.js`) are used by many
 * skills — including ones that stay in stoop — so they are INJECTED here rather than
 * moved, keeping the package's dependency surface minimal and avoiding a
 * bidirectional stoop↔package coupling.
 */

/**
 * `listCircleRoster(deps, args)` — return the routing addresses this device knows
 * for the calling actor's circle peers, drawn from `membership-redemption` items.
 * The chat layer uses this to fan out `/post` envelopes over the mesh.
 *
 * Two sources collapse into the same list:
 *   - On the ADMIN side: rows written via `verifyMembershipCodeForPeer` carry
 *     `redeemedBy = joinerPeerAddr`.
 *   - On the JOINER side: rows written via `recordRemoteRedemption` carry
 *     `confirmedBy = adminPeerAddr`.
 *
 * We collect every non-self, non-empty `redeemedBy` + `confirmedBy` for the group,
 * exit-filter, dedupe, and return as a flat `{addr, role}` list.
 *
 * FOREIGN-CALLER GATE: the circle's routing addresses are functional data for
 * MEMBERS. A FOREIGN caller (one acting as a webid other than this device's own)
 * gets them only if they are themselves in this circle's trail — otherwise a
 * handshaked stranger could map a circle they have no part in. Local calls (acting
 * as our own webid) are unchanged. Same gate `listGroupMembers` applies, one circle
 * at a time — where the data is, not in the caller's shell.
 *
 * @param {object} deps
 * @param {object} deps.store                 the circle's ItemStore.
 * @param {Function} deps.readCircleExits      the circle's exit-set reader (shared — injected).
 * @param {Function} deps.isExited             the exit predicate (shared — injected).
 * @param {Function} deps.rosterCallerIsForeign the local/foreign caller discriminator (shared — injected).
 * @param {Function} deps.simulateSync          the `_sync` shape producer.
 * @param {object} args
 * @param {object} args.a           the parsed skill data (`{groupId}`).
 * @param {string} args.from        the authenticated caller (acting webid).
 * @param {?string} args.localActor this device's own webid (the local/foreign discriminator).
 * @returns {Promise<object>} `{ groupId, members:[{addr, role}], _sync }` | `{ error }` | `{ groupId, members:[], reason }`.
 */
export async function listCircleRoster(
  { store, readCircleExits, isExited, rosterCallerIsForeign, simulateSync },
  { a, from, localActor },
) {
  if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
  const all = await store.listOpen({ type: 'membership-redemption' });
  const forGroup = all.filter(i => i?.source?.groupId === a.groupId);
  // The circle's routing addresses are functional data for MEMBERS. A FOREIGN caller (one acting
  // as a webid other than this device's own) gets them only if they are themselves in this
  // circle's trail — otherwise a handshaked stranger could map a circle they have no part in.
  // Local calls (acting as our own webid) are unchanged. Same gate `listGroupMembers` applies,
  // one circle at a time — where the data is, not in the caller's shell.
  if (rosterCallerIsForeign(from, localActor)) {
    const isMember = forGroup.some((i) => {
      const s = i?.source ?? {};
      return s.redeemedBy === from || s.confirmedBy === from;
    });
    if (!isMember) return { groupId: a.groupId, members: [], reason: 'not-a-member' };
  }
  // The same per-circle exit rule the roster projection uses. Without it, household-sync
  // pairing keeps re-adding a removed member as a peer for this circle on every circle-open.
  const exits = await readCircleExits({ store, groupId: a.groupId });
  const joinedAt = new Map();
  for (const it of forGroup) {
    const w = it?.source?.redeemedBy;
    const at = typeof it?.source?.redeemedAt === 'number' ? it.source.redeemedAt : 0;
    if (w && at > (joinedAt.get(w) ?? 0)) joinedAt.set(w, at);
  }
  const seen = new Map();   // addr → role
  for (const it of forGroup) {
    const src = it.source ?? {};
    // `redeemedBy` is a joiner (the actor who presented the code).
    if (src.redeemedBy && src.redeemedBy !== from && !isExited(exits, src.redeemedBy, joinedAt.get(src.redeemedBy) ?? 0)) {
      if (!seen.has(src.redeemedBy)) seen.set(src.redeemedBy, 'member');
    }
    // `confirmedBy` is the admin's address as recorded on the
    // joiner side (peer-bridge channel only).
    if (src.confirmedBy && src.confirmedBy !== from && src.channel === 'peer'
      && !isExited(exits, src.confirmedBy, 0)) {
      seen.set(src.confirmedBy, 'admin');
    }
  }
  return {
    groupId: a.groupId,
    members: [...seen.entries()].map(([addr, role]) => ({ addr, role })),
    _sync:   simulateSync(),
  };
}

/**
 * `recordMemberPersonaProperties(deps, args)` — property layer, "share to this
 * circle" (POST-join disclosure push). The admin-side write that lands an
 * already-joined member's freshly-disclosed persona properties onto the roster. The
 * general/post-join counterpart of the join-time `verifyMembershipCodeForPeer`
 * roster-write: same `members.addMember` merge + the SAME durable backing (patch the
 * member's `membership-redemption` item source) so the update survives a roster
 * rebuild, exactly like `personaProperties` recovered in `listGroupMembers`.
 *
 * `memberWebid` defaults to the caller (`from`) for a LOCAL self-update (the admin
 * adjusting their own row); the peer handler passes `memberWebid: fromAddr` — the
 * authenticated peer address (webid == the mesh signing address here, so a member can
 * only speak for their own row, never overwrite another's). Only updates an EXISTING
 * member (never mints a phantom). An empty `personaProperties` ({}) is a valid "I now
 * share nothing here" and clears the slot.
 *
 * DIFF-GATED (profile-update propagation): the roster is the source of truth, so it is
 * also the diff authority. When the row already says exactly this, NOTHING is written
 * and the answer is `{ok:true, unchanged:true, changedKeys:[]}` — the caller then
 * announces no "pull-me" and the circle stays quiet. A real change answers with
 * `changedKeys` (key NAMES only), which is what the silent pull-me entry carries.
 *
 * @param {object} deps
 * @param {object} deps.store               the circle's ItemStore.
 * @param {object} deps.members             the MemberMap.
 * @param {Function} deps.changedReleaseKeys the release-key diff (from `@onderling/agent-registry` — injected).
 * @param {Function} deps.simulateSync       the `_sync` shape producer.
 * @param {object} args
 * @param {object} args.a           the parsed skill data (`{groupId, memberWebid?, personaProperties, circleAddress?}`).
 * @param {string} args.from        the authenticated caller (envelope sender).
 * @param {?string} args.localActor this device's own webid (the LOCAL-carrier discriminator).
 * @returns {Promise<object>} `{ ok:true, groupId, memberWebid, keys, changedKeys, unchanged? }` | `{ ok:false, reason }`.
 */
export async function recordMemberPersonaProperties(
  { store, members, changedReleaseKeys, simulateSync },
  { a, from, localActor },
) {
  if (typeof a.groupId !== 'string' || !a.groupId) return { ok: false, reason: 'groupId-required' };
  // WHOSE row may this call write?
  //
  // The doc above states the invariant — "a member can only speak for their own row, never overwrite
  // another's" — but it was enforced only by CONVENTION at one call site: the admin's peer handler
  // substitutes the authenticated `fromAddr`. This skill is `visibility:'authenticated'`, so it is also
  // reachable DIRECTLY over the wire, where `from` is the remote caller and `memberWebid` is whatever
  // they typed. A member could therefore overwrite ANOTHER member's disclosed persona on the admin's
  // roster — a forgery, not just a lost update.
  //
  // So: a REMOTE caller may only ever write their own row (`memberWebid` is ignored, `from` wins). The
  // LOCAL path keeps honouring `memberWebid`, because that is exactly where the trusted substitution
  // happens: the admin's `handlePersonaPropsUpdate` passes the authenticated peer address, and the
  // admin adjusting their own row passes their own. Deny-by-default: when we cannot tell, use `from`.
  const isLocalCall = !!localActor && from === localActor;
  const requested = (typeof a.memberWebid === 'string' && a.memberWebid) ? a.memberWebid : null;
  const webid = (isLocalCall && requested) ? requested : from;
  if (!webid) return { ok: false, reason: 'member-unresolved' };
  if (requested && requested !== webid) {
    return { ok: false, reason: 'may-only-write-own-row' };   // honest refusal, never a silent no-op
  }
  const props = (a.personaProperties && typeof a.personaProperties === 'object' && !Array.isArray(a.personaProperties))
    ? a.personaProperties : null;
  if (props === null) return { ok: false, reason: 'personaProperties-required' };
  if (!members) return { ok: false, reason: 'roster-unavailable' };

  // An empty disclosure ({}) is "I now share nothing here" — normalise to the SAME `null`
  // absent-state a never-disclosed member carries, so the roster never holds an empty object
  // downstream code has to special-case (back-compat with the join-time capture).
  const stored = Object.keys(props).length ? props : null;

  // 1. Live row — merge onto the EXISTING member (read-modify-write, like setMySkills). A
  //    non-member gets no phantom row: only someone the admin already recorded can be updated.
  const me = await members.resolveByWebid(webid);
  if (!me) return { ok: false, reason: 'not-a-member' };

  // The DURABLE backing of this row (the redemption item `listGroupMembers` recovers from) —
  // read up-front because it is BOTH the diff's left-hand side and the patch target below.
  // The live MemberMap row is a lossy cache (it can read empty after a rebuild), so the
  // durable value wins when the two disagree: never call a real change "unchanged".
  let durableItem = null;
  try {
    const all = await store.listOpen({ type: 'membership-redemption' });
    durableItem = all.find((i) => i?.source?.redeemedBy === webid && i?.source?.groupId === a.groupId) ?? null;
  } catch { durableItem = null; }
  const previous = me.personaProperties ?? durableItem?.source?.personaProperties ?? null;

  // DIFF-GATE — an unchanged save is a true no-op: no write, no durable patch, no changed
  // keys for the caller to announce. (A `circleAddress` refresh alone is bookkeeping, not a
  // disclosure change, so it rides along on a real change only.)
  const changedKeys = changedReleaseKeys(previous, stored);
  if (changedKeys.length === 0) {
    return {
      ok: true, unchanged: true, groupId: a.groupId, memberWebid: webid,
      keys: Object.keys(props), changedKeys: [], _sync: simulateSync(),
    };
  }

  await members.addMember({
    ...me,
    personaProperties: stored,
    ...(typeof a.circleAddress === 'string' && a.circleAddress ? { circleAddress: a.circleAddress } : {}),
  });

  // 2. Durable backing — patch the member's redemption item source so `listGroupMembers`
  //    recovers the fresh value after a rebuild (the admin's OWN row has no redemption item —
  //    the patch simply finds nothing and the live row stands, matching createGroupV2).
  try {
    const item = durableItem;
    if (item) {
      await store.update(item.id, {
        source: {
          ...item.source,
          personaProperties: stored,
          ...(typeof a.circleAddress === 'string' && a.circleAddress ? { circleAddress: a.circleAddress } : {}),
        },
      }, { actor: from });
    }
  } catch { /* durable patch is best-effort — the live row already reflects the change */ }

  return {
    ok: true, groupId: a.groupId, memberWebid: webid,
    keys: Object.keys(props), changedKeys, _sync: simulateSync(),
  };
}

/**
 * `fanRosterUpdated(deps, args)` — the roster "pull-me" signal. Sibling of the
 * `broadcastKring*` family (same fan-out plumbing, subtype `roster-updated`), with one
 * defining difference: it carries NO CONTENT. Only a member REF and the NAMES of the
 * properties that changed ride the wire; every receiver re-reads the changed rows from
 * the roster itself.
 *
 * Fired by the roster owner right after a REAL `recordMemberPersonaProperties` write
 * (an unchanged save announces nothing). Receivers route it to basis's
 * `makeRosterUpdatedPeerHandler`, which records a SILENT stream entry — no chat bubble,
 * and it never wakes an offline member — and refreshes the members view.
 *
 * Best-effort + fire-and-forget: per-peer failures land in the returned `errors[]`
 * array but never throw.
 *
 * @param {object} deps
 * @param {Function} deps.broadcastToCircle the circle fan-out core.
 * @param {object} args
 * @param {object} args.a         the parsed skill data (`{groupId?, memberRef, keys?, msgId, ts?}`).
 * @param {?string} args.groupId  the bundle's active-circle default.
 * @param {string} args.from      the authenticated caller (fan-out sender).
 * @returns {Promise<object>} the fan result, or `{error}`.
 */
export async function fanRosterUpdated(
  { broadcastToCircle },
  { a, groupId, from },
) {
  const _groupId = a.groupId ?? groupId;
  if (!_groupId)                                          return { error: 'groupId-required' };
  if (typeof a.memberRef !== 'string' || !a.memberRef)    return { error: 'memberRef-required' };
  if (typeof a.msgId !== 'string' || !a.msgId)            return { error: 'msgId-required' };

  const ts = typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : Date.now();
  // Key NAMES only — a value that somehow reached this arg is dropped here, at the boundary.
  const keys = Array.isArray(a.keys) ? a.keys.filter((k) => typeof k === 'string' && k) : [];

  return broadcastToCircle({
    circleId: _groupId, kind: 'roster-updated', from,
    extras: { circleId: _groupId, msgId: a.msgId, ts, memberRef: a.memberRef, keys },
    metric: 'roster-updated-fanout',
  });
}

/**
 * `listCircleMembers(deps, args)` — the full roster READ: return each member's row
 * for a circle, with the per-member release the only thing that decides which fields
 * ride. This is the read the members view uses; its sibling `listCircleRoster` returns
 * only routing addresses.
 *
 * TWO GATES, both enforced where the data is (this replying device), never in the
 * caller's shell:
 *   1. FOREIGN-CALLER — a caller whose acting webid is not this device's own
 *      (`rosterCallerIsForeign`) is a real peer. A foreign non-member is refused
 *      (`{members:[], reason:'not-a-member'}`); a foreign member gets the per-peer
 *      ALLOWLIST projection via `gateRosterReplyForPeer`, NEVER this device's private
 *      roster cache. A LOCAL call (acting as our own webid) is our own view and passes
 *      unchanged. The pre-trail fallback has no trail to prove membership against, so a
 *      foreign caller there is refused deny-by-default.
 *   2. RELEASE — which member fields a LOCAL viewer sees follows each member's own
 *      per-circle release (`personaProperties`, carried on the projected row) plus the
 *      viewer's OWN "show me names" preference (`reveals.decide`), which may only ever
 *      NARROW what a release shows. The peer allowlist (gate 1) is the release rule for
 *      a foreign member.
 *
 * Pure DI lift out of stoop's `listGroupMembersCore` — behaviour and wire strings are
 * byte-identical. The per-circle membership PROJECTION (`projectCircleRoster`), the
 * shared exit helpers (`readCircleExits`/`isExited`), and the foreign-caller + allowlist
 * gate helpers (`rosterCallerIsForeign`/`gateRosterReplyForPeer`) are INJECTED — the same
 * helpers stay in stoop for skills that do not move (and the gate has stoop + basis test
 * consumers by path), so injecting keeps the package's dependency surface minimal and
 * avoids a bidirectional stoop↔package coupling, exactly as `listCircleRoster` does.
 *
 * @param {object} deps
 * @param {object} deps.store                   the circle's ItemStore.
 * @param {object} deps.members                 the MemberMap.
 * @param {?object} deps.reveals                the VIEWER's local "show me names" store (release NARROWING only).
 * @param {Function} deps.projectCircleRoster    the per-circle membership projection (shared — injected).
 * @param {Function} deps.readCircleExits        the circle's exit-set reader (shared — injected).
 * @param {Function} deps.isExited               the exit predicate (shared — injected).
 * @param {Function} deps.rosterCallerIsForeign  the local/foreign caller discriminator (shared — injected).
 * @param {Function} deps.gateRosterReplyForPeer the peer allowlist gate (shared — injected).
 * @param {object} args
 * @param {object} args.a           the parsed skill data (`{groupId?}`).
 * @param {?string} args.from       the authenticated caller (acting webid).
 * @param {?string} args.localActor this device's own webid (the local/foreign discriminator).
 * @param {?string} args.groupId    the bundle's active-circle default.
 * @returns {Promise<object>} `{ groupId, members:[...] }` | `{ members:[] }` | `{ groupId, members:[], reason }`.
 */
export async function listCircleMembers(
  { store, members, reveals, projectCircleRoster, readCircleExits, isExited, rosterCallerIsForeign, gateRosterReplyForPeer },
  { a, from, localActor, groupId },
) {
  const _groupId = a.groupId ?? groupId;
  if (!members) return { members: [] };
  const list = await members.list();

  // The viewer's OWN "show me names" preference, surfaced under its honest name. This store is the
  // VIEWER's local choice (the same one that gates item-author display names via
  // `resolveMember`/`hydrateItem`) — it says nothing about what the MEMBER disclosed. For a while it
  // was projected as `reveals: [viewerWebid]`, which downstream gates read as "this member revealed
  // to me" — the inverse consent direction. The discloser-side fact rides `personaProperties` (the
  // member's per-circle release); this marker may only ever NARROW what a release shows.
  const viewerWebid = from ?? null;
  const withViewerReveals = (rows) => {
    if (!reveals || !viewerWebid || !Array.isArray(rows)) return rows;
    return rows.map((m) => {
      const wid = m?.webid ?? m?.id ?? null;
      if (!wid || wid === viewerWebid) return m;
      const show = !!reveals.decide({ peerWebid: wid, groupId: _groupId })?.showDisplayName;
      return show ? { ...m, viewerNameOptIn: true } : m;
    });
  };
  const scoped = await projectCircleRoster({ store, groupId: _groupId, memberMapList: list });
  const caller = from ?? null;
  const foreign = rosterCallerIsForeign(caller, localActor);
  // A foreign caller must PROVE membership of this circle from its durable trail — the fallback path
  // has no trail to prove it against, so a foreign caller there is refused (deny-by-default). A local
  // call keeps the fallback's pre-trail behaviour unchanged.
  if (!scoped) {
    if (foreign) return { groupId: _groupId, members: [], reason: 'not-a-member' };
    // Legacy back-compat: a group with NO redemption trail (a seeded single-buurt roster from before
    // code-minting) falls back to the full MemberMap so those setups are unchanged. Still
    // EXIT-FILTERED, or removal would silently do nothing on circles with no other representation.
    const exits = await readCircleExits({ store, groupId: _groupId });
    const kept = exits.size === 0 ? list : list.filter((m) => !isExited(exits, m?.webid ?? '', 0));
    return { groupId: _groupId, members: withViewerReveals(kept) };
  }
  if (foreign) {
    const gated = gateRosterReplyForPeer(scoped, caller);
    if (!gated.ok) return { groupId: _groupId, members: [], reason: 'not-a-member' };
    return { groupId: _groupId, members: gated.members };
  }
  return { groupId: _groupId, members: withViewerReveals(scoped) };
}
