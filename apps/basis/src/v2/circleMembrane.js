/**
 * basis v2 — the Agent membrane's ADMISSION wiring, shared by both shells (home: Agent · mixed zone).
 *
 * One function returns the `secureAgentOpts` fragment that makes mute/block actually BITE. Both shells
 * spread it into the opts they already pass — and the twin composes the SAME fragment, so the journey
 * proves the path the shells use, not a lookalike (the composition-and-paint rule: shells only call).
 *
 * Why each piece is what it is:
 *  - `identityResolver.memberMap` is the IDENTITY map over canonical keys: in basis, webid ≡ the
 *    canonical pubKey (a recorded fact), so "which person is this key" is the key itself. Strangers
 *    resolve too — enforcement then finds no shared circle in the index and lets them through, which is
 *    the documented fail-open.
 *  - the per-circle→canonical hop is NOT ours to solve here: `createSecureAgent` threads its own
 *    device-local `peerIdentityOf` as the resolver's first hop.
 *  - `circleEnforcement` hands the substrate's accessors in: the shared GroupsIndex (fed by the roster
 *    read in `householdRosterPairing`, host-attached as `agent._circleGroupsIndex`) and the override
 *    store the toggles already write.
 */
import { GroupsIndex } from './groupsIndex.js';

/** One index per agent — create in the shell, attach as `agent._circleGroupsIndex`, pass here. */
export function makeCircleGroupsIndex() { return new GroupsIndex(); }

/**
 * @param {object} a
 * @param {{get:(circleId:string)=>Promise<object|null>}} a.overrideStore  the per-circle override store
 * @param {import('./groupsIndex.js').GroupsIndex} a.groupsIndex
 * @returns {object} spread into `secureAgentOpts`
 */
export function makeCircleMembraneOpts({ overrideStore, groupsIndex } = {}) {
  if (!overrideStore || !groupsIndex) throw new Error('circleMembrane: overrideStore + groupsIndex required');
  return {
    identityResolver: {
      memberMap: {
        // webid ≡ canonical pubKey (basis). A stranger resolves to themselves; the INDEX decides scope.
        resolveByPubKey: async (pubKey) =>
          (typeof pubKey === 'string' && pubKey ? { webid: pubKey, pubKey } : null),
      },
    },
    circleEnforcement: {
      groupsIndex,
      getOverride: (circleId) => overrideStore.get(circleId),
    },
  };
}
