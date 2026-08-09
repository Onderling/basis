/**
 * basis v2 — the circle-aware `peerScope` for the reachability oracle (G7, the adoption half).
 *
 * The oracle answers *"which peers can this device reach directly?"* — a signed list. That list is a contact
 * graph, so since 2026-07-27 the skill discloses nothing unless the host says what each CALLER may learn
 * (`packages/core/src/skills/reachablePeers.js`). This module is basis's answer to that question.
 *
 * **The rule: you learn only about peers you already share a circle with.**
 *
 * A caller who shares a circle with me already knows that circle's roster, so telling them *"I can reach
 * Bram directly"* about a co-member adds a reachability fact, not an identity. A caller who shares nothing
 * learns nothing — and, because a withheld peer is simply ABSENT rather than marked, they cannot tell
 * whether I have peers at all.
 *
 * Deny-by-default throughout: an unknown caller, an unreadable roster, or any error yields an EMPTY scope.
 * The failure mode of this function is "hop routing degrades", never "a graph leaks".
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** Cache lifetime for a roster read. Long enough to stop a chatty peer re-reading rosters on every claim,
 *  short enough that a removed member stops being disclosed about promptly. */
// Parameter register (#36) — roster-read cache TTL (scope:device, kind:internal). Caller-overridable via arg.
const DEFAULT_TTL_MS = param({ key: 'sharedPeerScope.ttlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });

/**
 * Build a `peerScope(callerPubKey, peers) → peers[]` bound to this device's circle memberships.
 *
 * @param {object} deps
 * @param {() => (string[]|Promise<string[]>)} deps.myCircleIds   circles this device is a member of
 * @param {(circleId: string) => Promise<Array<{addr?:string, webid?:string, pubKey?:string}>>} deps.rosterOf
 *   read one circle's roster (basis wires this to stoop's `listGroupRoster`)
 * @param {() => number} [deps.now]
 * @param {number} [deps.ttlMs]
 * @returns {(callerPubKey: string|null, peers: string[]) => Promise<string[]>}
 */
export function makeSharedCirclePeerScope({ myCircleIds, rosterOf, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  /** circleId → { members: Set<ref>, at: number } */
  const cache = new Map();

  async function membersOf(circleId) {
    const hit = cache.get(circleId);
    if (hit && (now() - hit.at) < ttlMs) return hit.members;
    let members = new Set();
    try {
      const roster = await rosterOf(circleId);
      for (const m of Array.isArray(roster) ? roster : []) {
        // A roster row names a member by any of these; collect them all, because the CALLER identifies
        // itself with its transport pubKey while a roster may key on webid.
        for (const ref of [m?.addr, m?.webid, m?.pubKey]) if (typeof ref === 'string' && ref) members.add(ref);
      }
    } catch {
      members = new Set();          // unreadable roster ⇒ disclose nothing for this circle
    }
    cache.set(circleId, { members, at: now() });
    return members;
  }

  return async function sharedCirclePeerScope(callerPubKey, peers) {
    if (typeof callerPubKey !== 'string' || !callerPubKey) return [];
    const all = Array.isArray(peers) ? peers.filter((p) => typeof p === 'string' && p) : [];
    if (all.length === 0) return [];

    let circleIds = [];
    try { circleIds = (await myCircleIds()) ?? []; } catch { return []; }

    // Only circles the CALLER is in count — my other circles are none of their business, and disclosing a
    // peer because *I* am in a circle with them would leak across the very boundary per-circle identity
    // exists to hold.
    const visible = new Set();
    for (const circleId of circleIds) {
      const members = await membersOf(circleId);
      if (!members.has(callerPubKey)) continue;
      for (const p of all) if (members.has(p)) visible.add(p);
    }
    // Never widen: only ever a subset of what this device can actually reach.
    return all.filter((p) => visible.has(p));
  };
}
