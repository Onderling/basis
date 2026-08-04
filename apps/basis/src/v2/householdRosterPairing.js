/**
 * basis v2 — household roster → no-pod sync pairing (OBJ-2).
 *
 * A circle's members are recorded as stoop `membership-redemption` items; `listGroupRoster` flattens
 * them to `[{addr, role}]`. To make a circle's items sync peer-to-peer with no pod, each device adds
 * every OTHER member's transport address as a household-sync peer (`agent.addHouseholdPeer`). When both
 * devices do this on circle-open (and after a join), they become mutual sync peers — so subsequent
 * writes fan out across the circle.
 *
 * Shared web + mobile (one source, each shell just passes its `agent`) — the structure invariant.
 *
 * @param {{ agent: object, circleId: string }} a
 * @returns {Promise<number>} how many peers were (re-)added (deduped by the agent).
 */

import { bindCircleAddressKeys } from './circleAddressKeys.js';
export async function feedHouseholdRoster({ agent, circleId } = {}) {
  if (!agent || typeof agent.addHouseholdPeer !== 'function' || !circleId) return 0;
  // BEFORE pairing: make sure this circle can RECEIVE. The store↔mirror sync used to be wired lazily,
  // on the first wired household op for the circle — which for the inbound half is a race the receiver
  // always loses. Pairing tells the other device it may publish to us; if our listener is not up yet,
  // what it publishes lands nowhere and nothing re-sends it. So listen first, then say you are ready.
  try { await agent.ensureCircleSync?.(circleId); } catch { /* best-effort, like everything else here */ }
  let r;
  try { r = await agent.callSkill('stoop', 'listGroupRoster', { groupId: circleId }); }
  catch { return 0; }   // not a group / no roster → household sync stays local
  // relay-only deployments expose the address as relay.address; NKN as peer.address; fall back to the
  // household self-address (the pubKey peers route to). Never pair with ourselves.
  const self = agent.peer?.address ?? agent.relay?.address ?? agent.householdSelfAddr ?? null;
  // The mute membrane's index rides the SAME roster read (one read, two consumers). The rows' `addr`
  // field is `redeemedBy`/`confirmedBy` — documented in deriveRoster as the WEBID (the person's stable
  // id; in basis it equals the canonical pubKey). It is NOT a per-circle address — those live in a
  // separate field and must never enter an alias index. The index is host-attached
  // (`agent._circleGroupsIndex`) so every existing call site feeds it without a signature change.
  const gidx = agent._circleGroupsIndex ?? null;
  let added = 0;
  for (const m of (Array.isArray(r?.members) ? r.members : [])) {
    // Per-circle (OBJ-2 Phase 6): pair the member into THIS circle's mirror, not a global roster.
    if (m?.addr && m.addr !== self) { try { agent.addHouseholdPeer(circleId, m.addr); added += 1; } catch { /* */ } }
    if (m?.addr && gidx) { try { gidx.add(circleId, m.addr); } catch { /* the index must never break pairing */ } }
  }
  // OBJ-2 convergence — re-push our current items to all (now-paired) peers. The live publish-on-write
  // only reaches peers subscribed at write-time, and per-peer catch-up fires only on a FRESH pair; so
  // without this re-push, an item added before the OTHER device opened the circle never arrives. Safe
  // (the receiver de-dupes by etag). Fires on every circle-open, both directions → both sides converge.
  try { await agent.resyncHouseholdCircle?.(circleId); } catch { /* best-effort */ }
  // G12 — bind each member's per-circle address to their identity key while we are here. This is the
  // moment both shells already learn a circle's membership, and it is the only moment the two facts are
  // in hand together; without the binding, routing to a per-circle address (G13 step C) throws
  // `No pubKey registered` above the transport and every message holds. Best-effort by design: a
  // roster read that fails must not break pairing, which is what this function is actually for.
  try { await bindCircleAddressKeysFor({ agent, circleId }); } catch { /* best-effort */ }
  // Say how many peers this circle actually paired. Every step above is best-effort and swallows its own
  // errors — correct, because a roster read that fails must not break pairing — but the result was that a
  // circle which paired NOBODY looked exactly like one that paired everybody. Items then simply never
  // fan out, with nothing anywhere saying why (2026-08-03, chasing exactly that).
  if (typeof console !== 'undefined') {
    console.info(`[household-sync] ${circleId}: paired ${added} peer(s) for item fan-out`);
  }
  return added;
}

/**
 * Bind every member of `circleId` to their per-circle address (G12).
 *
 * Reads `listGroupMembers` rather than `listGroupRoster`: the roster projection carries only
 * `{addr, role}`, while the member rows carry `{pubKey, circleAddress}` — the pair captured together at
 * join, where the joiner PROVED the address. Split out so a caller that only wants the binding (a roster
 * refresh, a post-removal re-bind) does not also re-run household pairing.
 *
 * The rows themselves come back with the counts, so a caller that needs to ASK something of the
 * roster it just caused to be read (does my own row still name the address I derive? — the address
 * announcing trigger) does not read it a second time. Two reads is how two views of one fact drift.
 *
 * @param {object} a
 * @param {object} a.agent      the host agent (needs `callSkill` + `registerPeerAddress`)
 * @param {string} a.circleId
 * @returns {Promise<{bound: number, skipped: number, members: Array<object>}>}
 */
export async function bindCircleAddressKeysFor({ agent, circleId } = {}) {
  if (!agent || typeof agent.callSkill !== 'function' || !circleId) return { bound: 0, skipped: 0, members: [] };
  if (typeof agent.registerPeerAddress !== 'function') return { bound: 0, skipped: 0, members: [] };
  let res;
  try { res = await agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId }); }
  catch { return { bound: 0, skipped: 0, members: [] }; }
  const members = Array.isArray(res?.members) ? res.members : [];
  // Decision 1 step 3 — the SAME rows also say who may speak in this circle. Recorded here rather
  // than from a second read, because the sealing binding and the authorize snapshot are two uses of
  // one fact, and a second read is how they come to disagree. Best-effort and never fatal: a device
  // that cannot record the snapshot falls back to accepting the circle's traffic unchecked (and says
  // so, loudly, from `realAgent`), which is the honest degradation — refusing on the strength of not
  // knowing would drop every message in the circle.
  try { await agent.recordCircleSenders?.({ circleId, members }); } catch { /* best-effort */ }
  return {
    ...bindCircleAddressKeys({
      members,
      registerPeerAddress: (address, pubKey, addrOpts) => agent.registerPeerAddress(address, pubKey, addrOpts),
      // Skip my own row — I never seal to myself, and binding it would be a harmless no-op at best.
      selfPubKey: agent.identity?.pubKey ?? agent.peer?.address ?? null,
    }),
    members,
  };
}

/**
 * Make a circle REACHABLE — the two steps that must follow a join, in one place.
 *
 * Joining puts you on the roster. It does not make anyone able to message you, and until 2026-07-30 nothing
 * closed that gap from the join itself:
 *
 *   1. **Register this device's per-circle address** for the circle, or peers dial an address the relay has
 *      never heard of. The roster carries it, so they *will* dial it.
 *   2. **Bind the other members' circle addresses to their keys** from the roster, or sealing to them throws
 *      `No pubKey registered` above the transport and every message holds.
 *
 * Both already existed — and both were reached only from `CircleLauncherScreen` (its circles-load effect and
 * its circle-open effect). So they ran when you browsed to the circle list and not when you joined, which
 * meant a join performed from anywhere else left a member unreachable until the app was relaunched. That is
 * dispatch logic living in a shell (invariant 1); it belongs here, where both shells and the programmatic
 * path can reach it.
 *
 * Best-effort per step, and independent: registering an address is useful even if the roster read fails, and
 * vice versa. Returns what happened so a caller can log it rather than guess.
 *
 * @param {object} a
 * @param {object} a.agent                       host agent (`callSkill` + `registerPeerAddress`)
 * @param {string} a.circleId
 * @param {(circleIds?: string[]) => any} [a.registerCirclePresence]
 *   the host's presence seam (mobile: `bundle.registerCirclePresence`). Called with no arguments so the host
 *   decides the full current circle list — this function knows about one circle, not all of them.
 * @returns {Promise<{registered: boolean, bound: number, skipped: number}>}
 */
export async function makeCircleReachable({ agent, circleId, registerCirclePresence } = {}) {
  let registered = false;
  if (typeof registerCirclePresence === 'function') {
    try { await registerCirclePresence(); registered = true; }
    catch (err) {
      // Best-effort, but NOT silent (review, 2026-07-30). A join that succeeds while registration fails
      // leaves the member on the roster at an address their own device never announced — reachable by
      // nobody until the next circles load, with nothing anywhere saying so. Failing the join would be
      // worse (the membership is real), so the join stands and the failure is stated instead.
      if (typeof console !== 'undefined') {
        console.warn(
          `[circle] joined ${circleId} but could not register this device's address — others may not `
          + `reach you until the app is reopened: ${err?.message ?? err}`,
        );
      }
    }
  }
  let bound = { bound: 0, skipped: 0 };
  try { bound = await bindCircleAddressKeysFor({ agent, circleId }); }
  catch { /* a roster read that fails must not undo the registration above */ }
  return { registered, bound: bound.bound ?? 0, skipped: bound.skipped ?? 0 };
}
