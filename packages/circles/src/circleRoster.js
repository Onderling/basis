/**
 * Roster read — the roster-facing reads lifted verbatim out of stoop's `buildSkills`, so the roster access
 * gate lives once in the circles substrate and cannot drift across callers (invariant 3 — logic lives once).
 * (The persona-property write and the roster-updated fan stood here too until 2026-09-22; what a member
 * discloses is their own `member-props` statement on the circle's membership lane now.)
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
  { store, readCircleExits, isExited, rosterCallerIsForeign, simulateSync, projectCircleRoster = null },
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

  // ── A CIRCLE YOU ARE NO LONGER IN ANSWERS YOU LIKE ONE YOU NEVER JOINED ──────────────────────
  // Once the circle's own record says this device's person left or was removed, this device stops
  // serving that circle's live roster — the same `not-a-member` a stranger gets. Not because the
  // history can be taken away: it is on this disk and it stays (principle 2, "verwijderen kun je
  // vragen, niet afdwingen"). What ends is STANDING. The projection's contract is "who is in this
  // circle now", and that is no longer a question this person is owed an answer to.
  //
  // Until this, a removed device kept listing the circle's members — including, at the top, the
  // admin who removed them — from a projection it had no part in any more (F-011). Delivering the
  // eviction fixed the other half: they now know. This is what knowing should change.
  //
  // `joinedAt: 0` deliberately: an exit recorded at ANY time closes the read. The wall-clock
  // comparison the member list uses exists to place an exit against a RE-join; a caller asking
  // about their own standing has no such ambiguity to resolve.
  // Read from the FOLD, not from the exit items: the typed `group-removal` row is written on the
  // admin's device, while the person it removed learns it as a signed statement on their membership
  // lane. Asking the items here would answer "no exit" on the one device that most needs a yes.
  const selfWebid = localActor ?? from;
  let folded = null;
  if (selfWebid && typeof projectCircleRoster === 'function') {
    try { folded = await projectCircleRoster({ groupId: a.groupId }); } catch { folded = null; }
    const stillIn = Array.isArray(folded)
      && folded.some((r) => (r?.webid ?? r?.addr ?? r?.ref) === selfWebid);
    // Only when the circle HAS a folded answer: a null projection means this device holds no record
    // of the circle at all, which the paths below already answer, and must not be read as an exit.
    if (Array.isArray(folded) && folded.length > 0 && !stillIn) {
      return { groupId: a.groupId, members: [], reason: 'not-a-member' };
    }
  }

  // ── ONE HEAD, TWO SHAPES ─────────────────────────────────────────────────────────────────────────
  // This op answers the NARROW question — `{addr, role}` for everyone but the caller — and it used to
  // answer it by recomputing membership from the redemption rows below. That recomputation is the same
  // code as the head's trail half (`redeemedBy → member`, `confirmedBy` on the peer channel → `admin`),
  // and it is also STRICTLY LESS: no founders, and no membership spine at all. So a role change or an
  // eviction — both of which exist only as signed statements — were invisible here while the head had
  // already folded them, and the two reads disagreed about the same circle on the same device:
  //
  //     promote B, then read both      listGroupRoster  → B = "member"
  //                                    listGroupMembers → B = "admin"
  //
  // `catchUp` chooses the peers it asks from THIS read, which is how it kept asking a peer the spine
  // had already removed. `architecture.md`: reading it back is a projection, never a second store.
  //
  // The caller exclusion is kept, and it is load-bearing rather than cosmetic: `personaPropsUpdate`
  // reads "no admin in this list" as "the admin is me", and drives its local-vs-peer branch off it.
  // The redemption path below stays as the fallback for a composition with no projection wired.
  if (Array.isArray(folded)) {
    const members = [];
    for (const r of folded) {
      const addr = r?.webid ?? r?.addr ?? r?.ref ?? null;
      if (!addr || addr === selfWebid) continue;
      members.push({ addr, role: r?.role === 'admin' ? 'admin' : 'member' });
    }
    return { groupId: a.groupId, members, _sync: simulateSync() };
  }

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
  // THE ABSENCE RULE (M1a, 2026-08-23) — the projection returns null only when this device has NO
  // durable record of the circle: no redemption trail and no derivable founder. That is "I do not
  // know", and the honest answer to it is an empty roster, for every caller.
  //
  // What used to be here: a LOCAL caller fell back to the full MemberMap — the device's global
  // display cache, holding every member of every circle it ever admitted, keyed by nothing. So
  // asking about a circle you are not in returned exactly one member: yourself. It was labelled
  // back-compat for pre-code-minting circles, and this project keeps no back-compat (2026-08-08).
  //
  // A founder-only circle is NOT this case: the creator never redeems their own code, so the trail
  // is empty, but `projectCircleRoster` derives them from the circle's own rules authorship and
  // answers with them. Absence here means absence of the circle, not absence of joiners.
  if (!scoped) return { groupId: _groupId, members: [], reason: 'not-a-member' };
  if (foreign) {
    const gated = gateRosterReplyForPeer(scoped, caller);
    if (!gated.ok) return { groupId: _groupId, members: [], reason: 'not-a-member' };
    return { groupId: _groupId, members: gated.members };
  }
  return { groupId: _groupId, members: withViewerReveals(scoped) };
}
