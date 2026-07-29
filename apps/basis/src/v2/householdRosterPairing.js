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
  let r;
  try { r = await agent.callSkill('stoop', 'listGroupRoster', { groupId: circleId }); }
  catch { return 0; }   // not a group / no roster → household sync stays local
  // relay-only deployments expose the address as relay.address; NKN as peer.address; fall back to the
  // household self-address (the pubKey peers route to). Never pair with ourselves.
  const self = agent.peer?.address ?? agent.relay?.address ?? agent.householdSelfAddr ?? null;
  let added = 0;
  for (const m of (Array.isArray(r?.members) ? r.members : [])) {
    // Per-circle (OBJ-2 Phase 6): pair the member into THIS circle's mirror, not a global roster.
    if (m?.addr && m.addr !== self) { try { agent.addHouseholdPeer(circleId, m.addr); added += 1; } catch { /* */ } }
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
 * @param {object} a
 * @param {object} a.agent      the host agent (needs `callSkill` + `registerPeerAddress`)
 * @param {string} a.circleId
 * @returns {Promise<{bound: number, skipped: number}>}
 */
export async function bindCircleAddressKeysFor({ agent, circleId } = {}) {
  if (!agent || typeof agent.callSkill !== 'function' || !circleId) return { bound: 0, skipped: 0 };
  if (typeof agent.registerPeerAddress !== 'function') return { bound: 0, skipped: 0 };
  let res;
  try { res = await agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId }); }
  catch { return { bound: 0, skipped: 0 }; }
  return bindCircleAddressKeys({
    members: Array.isArray(res?.members) ? res.members : [],
    registerPeerAddress: (address, pubKey) => agent.registerPeerAddress(address, pubKey),
    // Skip my own row — I never seal to myself, and binding it would be a harmless no-op at best.
    selfPubKey: agent.identity?.pubKey ?? agent.peer?.address ?? null,
  });
}
