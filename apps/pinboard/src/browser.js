/**
 * pinboard — browser entry for basis composition.
 *
 * Lets basis boot a real Pinboard NeighbourhoodAgent inside its
 * own browser bundle, sharing an `InternalBus` so basis's
 * chatAgent can `.invoke(pinboardAgent.address, skillId, parts)` to
 * reach every real pinboard skill (postRequest, listFeed,
 * respondToItem, sendChatMessage, setMyHandle, ...).
 *
 * of `Project Files/basis/integration-plan-2026-05-23.md`.
 * Prerequisite: (IndexedDBPersist) already shipped, so we
 * can compose Pinboard in a browser without a `node:fs/promises` import
 * crashing the bundle.
 *
 * Boundary: imports ONLY platform-neutral parts of pinboard — no bin
 * scripts, no node-only adapters, no testbed launcher.
 */

import { AgentIdentity, InternalTransport } from '@onderling/core';
import { SolidPodSource } from '@onderling/pod-client';

import { createNeighbourhoodAgent } from './Agent.js';
import { attachPodToBundle, detachPodFromBundle } from './lib/attachPodToBundle.js';

/**
 * Build a Pinboard NeighbourhoodAgent on the shared bus.
 *
 * @param {object} args
 * @param {InternalBus}    args.bus              shared bus (basis owns it)
 * @param {object}         args.identityVault    Vault for the pinboard agent's
 *                                               identity (browser convention:
 *                                               VaultLocalStorage prefixed
 *                                               separately from chat identity)
 * @param {string}         args.localActor       webid-shaped identifier for
 *                                               the local user (basis
 *                                               passes its synthetic
 *                                               'webid:local-demo-user' or
 *                                               the real WebID after sign-in)
 * @param {string}         [args.group='cc-default-circle']  closed-group id
 * @param {Array}          [args.members]        seed roster; defaults to the
 *                                               local actor only
 * @param {object}         [args.persistDb]      `{dbName, storeName?}` for
 *                                               browser persistence (the IDB
 *                                               adapter from);
 *                                               omit for in-memory only
 * @param {string}         [args.label='PinboardAgent']
 * @param {object}         [args.controlAgent]   optional sealed-pod control-agent
 *                                               (`@onderling/pod-client` `createControlAgent`). When
 *                                               present, membership events drive the group-key flow:
 *                                               `redeemMembershipCode` → `addMember` (seal the group key
 *                                               to the joiner's sealing public key) and `leaveGroup` →
 *                                               `removeMember` (revoke + rotate). Absent on instances
 *                                               that don't run a sealed pod — the calls are simply
 *                                               skipped (non-breaking). basis uses Pinboard as its
 *                                               circle-membership substrate, so this is the seam through
 *                                               which a circle's sealed-pod control-agent reaches the
 *                                               redeem/leave hooks the underlying agent already exposes.
 * @returns {Promise<{
 *   bundle: ReturnType<typeof createNeighbourhoodAgent>,
 *   address: string,
 *   close:   () => Promise<void>,
 * }>}
 */
export async function createBrowserPinboardAgent({
  bus,
  identityVault,
  localActor,
  group = 'cc-default-circle',
  members,
  persistDb,
  label = 'PinboardAgent',
  controlAgent,
  // Optional host-injected reliable cross-peer sender (basis wires
  // `sa.peer.sendTo(..., {guarantee:'hold-forward'})`). Threaded straight into
  // the bundle so circle chat fan-out inherits failover + offline hold-forward.
  reliableSend,
  // Connectivity Phase 2 (G1/G2) — OPTIONAL host-injected data-move resolver
  // `(circleId) => 'fan-out-full'|'pod-signal'|'pod-only'` (basis derives it
  // from the circle's `policy.pod` via `circleDataMove`). Absent → fan-out-full.
  circleDataMove,
  // Connectivity Phase 3 SEAM — OPTIONAL real shared-pod writer (see Agent.js).
  podWrite,
  // Connectivity Phase 3 SEAM — OPTIONAL real shared-pod reader (see Agent.js).
  // The per-user address-fallback setting (value or `() => boolean`), threaded to the circle fan.
  allowAddressFallback,
  // Circle-scoped spine signer resolver `(circleId) => {identity, ref}` — threaded to the skills' spine
  // emitter + roster projection (principle 5). Absent → the legacy global-identity signer.
  circleSignerFor,
  // The membership rider: device-log emitter + verified reader (absent → the store-based spine path).
  membershipEmit,
  membershipRead,
  currentPersonKey = null,
  // The person's own profile (handle, display name, availability, place) — host-injected over the persona record
  // (lib/selfProfile.js); absent → held in memory.
  selfProfile = null,
  // The rules-update rider: a rules-doc edit also fans a signed statement on the governance lane
  // (absent → store-local only, the pre-propagation behaviour).
  rulesUpdateEmit,
  selfWebidFor = null,
  selfCard = null,      // whom this device's own card and requests name — absent → this agent's own identity
  hostCircles = null,    // the host's circles: given, a post lives in its circle's own store (lib/routedStore.js)
  matchesMine = null,   // the host's "a post matches what I offer" (a local closure) — see createNeighbourhoodAgent
  mutedSet,
  // This device's content-seal strategy: the member map (the contact book, every roster row, the name a
  // person shows) and the posts persist under it. Absent → the persisted copy is written in the clear,
  // which is what happened until 2026-09-18 — the host handed it in and this factory dropped it here.
  contentSeal = null,
  // The push registry's own device-local medium (`{read, write}`) — never the persisted store above.
  pushStore = null,
}) {
  if (!bus)           throw new TypeError('createBrowserPinboardAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserPinboardAgent: identityVault required');
  if (!localActor)    throw new TypeError('createBrowserPinboardAgent: localActor (webid) required');

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
    : [{ webid: localActor, role: 'admin' }];

  const bundle = await createNeighbourhoodAgent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    members:   seedMembers,
    offeringMatch: { group, localActor },
    persistDb,
    label,
    controlAgent,   // sealed-pod membership hooks (no-op when absent) — see the param doc above
    reliableSend,   // host-injected hold-forward sender for circle chat fan-out (absent → chat.send fallback)
    circleDataMove, // Phase 2 G1/G2 — host-injected data-move resolver (absent → fan-out-full)
    podWrite,       // Phase 3 seam — real shared-pod writer (absent → pod-signal/pod-only degrade)
    allowAddressFallback,  // per-user setting → the circle fan's address ladder (absent → allowed, unchanged)
    circleSignerFor,       // circle-scoped spine signing (absent → legacy global-identity signer, unchanged)
    membershipEmit,        // the membership rider's device-log emitter (absent → store-based, unchanged)
    membershipRead,        // the rider's verified reader for the roster fold
    currentPersonKey,      // the person key announced on a join/create (absent → none announced)
    selfProfile,           // the person's own profile over the persona record (absent → in memory)
    mutedSet,              // the SHELL's block set — this app reads it, never writes it
    rulesUpdateEmit,       // the rules-update rider's governance-lane emitter (absent → store-local only)
    selfWebidFor,          // who this device is per circle (its persona) — absent → the default throughout
    selfCard,              // whom this device's own card and requests name — absent → this agent's own identity
    hostCircles,
    matchesMine,
    contentSeal,           // the persisted store is sealed under this device's content key
    pushStore,             // push subscriptions: device-local, never synced
  });

  return {
    bundle,
    address: identity.pubKey,
    close:   () => bundle.close?.(),
    /**
     * Route this pinboard agent's items to a REAL Solid pod, using a host-supplied
     * authenticated `fetch` (e.g. basis's signed-in session) + the discovered
     * `podRoot`. Builds a `SolidPodSource` + activates the (already-built) pod-routing
     * write-through. Idempotent-ish; best-effort provisioning. Pass `podRoot: null` (or
     * call `detachPod`) to revert to local-only. No-op on a bundle without a cache.
     */
    async attachPod({ podRoot, webid, fetch: authedFetch } = {}) {
      if (!podRoot || typeof authedFetch !== 'function' || !bundle?.cache?.attachInner) return { ok: false };
      try {
        const source = new SolidPodSource({ podUrl: podRoot, fetch: authedFetch });
        await attachPodToBundle({ bundle, source, podRoot, webid, fetch: authedFetch });
        return { ok: true, podRoot };
      } catch (err) { return { ok: false, error: err?.message ?? String(err) }; }
    },
    detachPod() { try { detachPodFromBundle({ bundle }); } catch { /* swallow */ } },
  };
}
