/**
 * stoop — browser entry for canopy-chat composition.
 *
 * Lets canopy-chat boot a real Stoop NeighborhoodAgent inside its
 * own browser bundle, sharing an `InternalBus` so canopy-chat's
 * chatAgent can `.invoke(stoopAgent.address, skillId, parts)` to
 * reach every real stoop skill (postRequest, listFeed,
 * respondToItem, sendChatMessage, setMyHandle, ...).
 *
 * Slice 2b of `Project Files/canopy-chat/integration-plan-2026-05-23.md`.
 * Prerequisite: slice 2a (IndexedDBPersist) already shipped, so we
 * can compose Stoop in a browser without a `node:fs/promises` import
 * crashing the bundle.
 *
 * Boundary: imports ONLY platform-neutral parts of stoop — no bin
 * scripts, no node-only adapters, no testbed launcher.
 */

import { AgentIdentity, InternalTransport } from '@canopy/core';

import { createNeighborhoodAgent } from './Agent.js';

/**
 * Build a Stoop NeighborhoodAgent on the shared bus.
 *
 * @param {object} args
 * @param {InternalBus}    args.bus              shared bus (canopy-chat owns it)
 * @param {object}         args.identityVault    Vault for the stoop agent's
 *                                               identity (browser convention:
 *                                               VaultLocalStorage prefixed
 *                                               separately from chat identity)
 * @param {string}         args.localActor       webid-shaped identifier for
 *                                               the local user (canopy-chat
 *                                               passes its synthetic
 *                                               'webid:local-demo-user' or
 *                                               the real WebID after sign-in)
 * @param {string}         [args.group='cc-default-buurt']  closed-group id
 * @param {Array}          [args.members]        seed roster; defaults to the
 *                                               local actor only
 * @param {object}         [args.persistDb]      `{dbName, storeName?}` for
 *                                               browser persistence (the IDB
 *                                               adapter from slice 2a);
 *                                               omit for in-memory only
 * @param {string}         [args.label='StoopAgent']
 * @param {object}         [args.controlAgent]   optional sealed-pod control-agent
 *                                               (`@canopy/pod-client` `createControlAgent`). When
 *                                               present, membership events drive the group-key flow:
 *                                               `redeemMembershipCode` → `addMember` (seal the group key
 *                                               to the joiner's sealing public key) and `leaveGroup` →
 *                                               `removeMember` (revoke + rotate). Absent on instances
 *                                               that don't run a sealed pod — the calls are simply
 *                                               skipped (non-breaking). canopy-chat uses Stoop as its
 *                                               circle-membership substrate, so this is the seam through
 *                                               which a circle's sealed-pod control-agent reaches the
 *                                               redeem/leave hooks the underlying agent already exposes.
 * @returns {Promise<{
 *   bundle: ReturnType<typeof createNeighborhoodAgent>,
 *   address: string,
 *   close:   () => Promise<void>,
 * }>}
 */
export async function createBrowserStoopAgent({
  bus,
  identityVault,
  localActor,
  group = 'cc-default-buurt',
  members,
  persistDb,
  label = 'StoopAgent',
  controlAgent,
}) {
  if (!bus)           throw new TypeError('createBrowserStoopAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserStoopAgent: identityVault required');
  if (!localActor)    throw new TypeError('createBrowserStoopAgent: localActor (webid) required');

  // Per-agent identity, persisted in the supplied vault.  Survives
  // page reloads when the vault is VaultLocalStorage / VaultIndexedDB.
  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  const seedMembers = Array.isArray(members) && members.length > 0
    ? members
    : [{ webid: localActor, displayName: 'me', role: 'admin' }];

  const bundle = await createNeighborhoodAgent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    members:   seedMembers,
    skillMatch: { group, localActor },
    persistDb,
    label,
    controlAgent,   // sealed-pod membership hooks (no-op when absent) — see the param doc above
  });

  return {
    bundle,
    address: identity.pubKey,
    close:   () => bundle.close?.(),
  };
}
