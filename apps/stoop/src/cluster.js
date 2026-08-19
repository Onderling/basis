/**
 * createNeighbourhoodCluster — multi-group bring-up for a single user.
 *
 * H5 V2 product item #3 (group switcher). Per
 * `Project Files/coding-plans/H5-V2-product-items.md`, V0 picks model
 * (b) "one core.Agent per group with shared identity" — fits the
 * existing substrates without protocol changes:
 *
 *   - One `AgentIdentity` is shared across N agents (stable pubkey).
 *   - Each group gets its own `core.Agent` with its own OfferingMatch.
 *   - Each agent registers separately at the relay (today the relay's
 *     `register` accepts one `groupProof` per connection, so one connection
 *     per group is the V0 contract).
 *
 * The cluster is otherwise just a thin wrapper around N
 * `createNeighbourhoodAgent` calls — each per-group bundle is the same
 * shape `{agent, itemStore, members, offeringMatch, notifier}` that
 * single-group consumers already get, so apps can keep treating each
 * group's bundle as an independent neighbourhood agent.
 *
 * Returns:
 *   {
 *     identity:       AgentIdentity,                 // shared across all groups
 *     groups:         Map<groupId, bundle>,
 *     defaultGroupId: string,
 *   }
 */
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from './Agent.js';

/**
 * @param {object} args
 * @param {Array<{
 *   groupId:    string,
 *   localActor: string,
 *   peers?:     Array<{pubKey: string}>,
 *   skills?:    string[],
 *   posture?:   Record<string, 'always'|'negotiable'|'never'>,
 *   members?:   Array<object>,
 *   pod?:       {client, configUri, fallback?},     // pod-backed roster (alternative to members[])
 * }>} args.groups
 * @param {AgentIdentity}          [args.identity]            shared identity (default: fresh)
 * @param {InternalBus}            [args.bus]                 shared in-process bus for tests (default: fresh InternalBus)
 * @param {(opts: {identity: AgentIdentity}) => any}
 *                                  [args.transportFactory]   per-group transport factory; default builds one InternalTransport on `bus` per agent
 * @param {string}                  [args.label='H5-cluster']
 * @returns {Promise<{
 *   identity:       AgentIdentity,
 *   groups:         Map<string, object>,
 *   defaultGroupId: string,
 *   stop:           () => Promise<void>,
 * }>}
 */
export async function createNeighbourhoodCluster({
  groups,
  identity,
  bus,
  transportFactory,
  label = 'H5-cluster',
}) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new TypeError('createNeighbourhoodCluster: groups[] required (at least one)');
  }
  for (const g of groups) {
    if (!g.groupId || !g.localActor) {
      throw new TypeError('createNeighbourhoodCluster: each group needs {groupId, localActor}');
    }
  }
  if (new Set(groups.map(g => g.groupId)).size !== groups.length) {
    throw new TypeError('createNeighbourhoodCluster: duplicate groupId in groups[]');
  }

  const sharedIdentity = identity ?? await AgentIdentity.generate(new VaultMemory());
  const sharedBus      = bus      ?? new InternalBus();
  const tx = transportFactory ?? (() =>
    new InternalTransport(sharedBus, sharedIdentity.pubKey)
  );

  const bundles = new Map();
  for (const g of groups) {
    const bundle = await createNeighbourhoodAgent({
      identity:  sharedIdentity,
      transport: tx({ identity: sharedIdentity, groupId: g.groupId }),
      label:     `${label}-${g.groupId}`,
      ...(g.pod
        ? { pod: g.pod }
        : { members: g.members }),
      offeringMatch: {
        group:      g.groupId,
        localActor: g.localActor,
        peers:      g.peers   ?? [],
        skills:     g.skills,
        posture:    g.posture,
      },
    });
    bundles.set(g.groupId, bundle);
  }

  /**
   * Convenience: stop all OfferingMatch subscriptions across the cluster.
   * Apps that wired their own additional teardown should chain it after.
   */
  const stop = async () => {
    for (const b of bundles.values()) {
      try { await b.offeringMatch?.stop?.(); } catch { /* swallow */ }
    }
  };

  return {
    identity:       sharedIdentity,
    groups:         bundles,
    defaultGroupId: groups[0].groupId,
    stop,
  };
}
