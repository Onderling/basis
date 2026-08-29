/**
 * tasks-v0 — browser entry for basis composition.
 *
 * Lets basis boot a real tasks-v0 Circle agent inside its own
 * browser bundle, sharing an `InternalBus` so basis's
 * chatAgent can `.invoke(circleAgent.address, skillId, parts)` to
 * reach every real task skill (addTask / claimTask / submitTask /
 * approveTask / listMyInbox / ...).
 *
 * Why this file
 *   The bin/<app>-ui.js launchers boot tasks-v0 as a node process
 *   for the multi-member testbed UX.  basis doesn't need
 *   that scaffolding — it already owns the bus, the identity vault,
 *   and the chat-shell surface.  It just needs the real tasks
 *   substrate composed in-process.  This factory does that.
 *
 * Boundary: this file imports ONLY the platform-neutral parts of
 * tasks-v0 — no node:fs / node:crypto / no bin scripts / no agent-ui
 * mount.  Per the architectural-layering convention.
 *
 * See `Project Files/basis/integration-plan-2026-05-23.md`
 * for the full per-app integration plan; this is.
 */

import {
  AgentIdentity, InternalTransport,
} from '@onderling/core';

import { buildBundle }     from './storage/buildBundle.js';
import { createCircleAgent } from './Circle.js';
import { buildMeshAgent }  from './MeshAgent.js';
import { wireSkills }      from './wireSkills.js';
import { multiCircleResolver, argsFromParts } from './bundleResolver.js';
import { buildMultiCircleOnboardingSkills }   from './skills/multiCircleOnboarding.js';

/**
 * Build a tasks-v0 Circle agent on the shared bus.
 *
 * @param {object} args
 * @param {InternalBus}    args.bus           shared bus (basis owns it)
 * @param {object}         args.identityVault Vault for the circle agent's identity;
 *                                            separate from the chat vault so
 *                                            circles don't pollute chat identity
 * @param {object}         args.circleConfig    {circleId, name, kind, members}
 * @param {object}         [args.persistDb]   Pass-through to `buildBundle`'s
 *                                            `persistDb` opt; mirrors stoop's
 *                                            `createBrowserStoopAgent`.  Pass
 *                                            `{dbName, storeName?}` (IDB
 *                                            browser path) or `{dbName,
 *                                            asyncStorage}` (RN).  Omit for
 *                                            in-memory only.
 * @param {string}         [args.label='TasksCircle']
 * @returns {Promise<{
 *   circle:    ReturnType<typeof createCircleAgent>,
 *   address: string,
 *   close:   () => Promise<void>,
 * }>}
 */
export async function createBrowserTasksAgent({
  bus,
  identityVault,
  circleConfig,
  persistDb,
  label = 'TasksCircle',
}) {
  if (!bus) throw new TypeError('createBrowserTasksAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserTasksAgent: identityVault required');
  if (!circleConfig?.circleId) throw new TypeError('createBrowserTasksAgent: circleConfig.circleId required');

  // Per-circle identity, persisted in the supplied vault.  Survives
  // page reloads when the vault is VaultLocalStorage / VaultIndexedDB.
  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  // Local-first item store.  When `persistDb` is provided, the cache
  // hydrates from prior state + auto-saves debounced (IDB on web,
  // AsyncStorage on RN, file on Node).  Without it, the cache stays
  // Map-only (legacy behaviour).
  const localStoreBundle = persistDb
    ? await buildBundle({ persistDb })
    : buildBundle();

  const circle = await createCircleAgent({
    circleConfig,
    localStoreBundle,
    vault: identityVault,   // persistent on both shells — the grant managers' durable store
    // 2026-05-24 — flipped to true so basis's /invite + /redeem-invite
    // slashes (A9) and /join-group wizard (C2) actually reach
    // registered issueInvite / redeemInvite skills.  Earlier comment
    // "no invite issuance from chat-shell V0" predates A9 / C2.
    wireOnboardingSkills: true,
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    label,
  });

  return {
    circle,
    address: identity.pubKey,
    close:   () => circle.close?.(),
  };
}

/**
 * Build a MULTI-circle tasks-v0 runtime on basis's shared bus.
 *
 * Mirrors `buildMultiCircleRuntime` (the CLI / test fixture) but composes
 * onto a caller-owned `bus` + identity vault instead of generating its
 * own.  One `meshAgent` owns the skill registry; a `circlesMap` of
 * CircleStates is dispatched by `multiCircleResolver` from `args.circleId` /
 * `args._scope`.  Each circle gets its own item-store root
 * (`mem://tasks/circles/<circleId>/`), so storage is split per circle — and
 * since `circleId ≡ circleId` (CIRCLE_ID_IS_CREW_ID_ALIAS), per circle.
 *
 * basis addition over the CLI runtime:
 *   - `ensureCircle(circleId)` lazily spawns a circle the first time a circle
 *     is touched (no pre-saved config needed — it inherits the primary
 *     circle's members so the local actor stays recognised).
 *   - the resolver falls back to the PRIMARY circle for unscoped calls,
 *     preserving the legacy single-circle behaviour every existing
 *     chat-shell flow + test relies on.
 *
 * @param {object} args
 * @param {InternalBus} args.bus               shared bus (basis owns it)
 * @param {object}      args.identityVault      Vault for the mesh agent identity
 * @param {object}      args.primaryCircleConfig  {circleId, name, kind, members}
 * @param {object}      [args.persistDb]        Pass-through to `buildBundle`'s
 *                                              `persistDb` opt for restart-
 *                                              survival.  All circles — primary
 *                                              + spawned via `ensureCircle` —
 *                                              share the SAME
 *                                              `localStoreBundle` (the same
 *                                              `CachingDataSource`); a single
 *                                              persistDb covers them all.
 *                                              Each circle namespaces its items
 *                                              under
 *                                              `mem://tasks/circles/<circleId>/`
 *                                              so the shared cache stays
 *                                              collision-free.
 * @param {string}      [args.label='TasksMeshAgent(cc)']
 * @returns {Promise<{
 *   agent:   object,            // the shared meshAgent (invoke target)
 *   address: string,            // meshAgent pubKey
 *   circlesMap: Map<string, object>,
 *   ensureCircle: (circleId: string, cfg?: object) => Promise<object|null>,
 *   primaryCircleState: object,
 *   close: () => Promise<void>,
 * }>}
 */
export async function createBrowserMultiCircleTasksAgent({
  bus,
  identityVault,
  primaryCircleConfig,
  persistDb,
  label = 'TasksMeshAgent(cc)',
  // The caller's role in a circle, answered by the HOST's membership head. Threaded to the
  // authority gates; absent, they refuse rather than fall back to this bundle's own member list
  // (which is composed locally and carries this device as admin).
  circleRoleOf = null,
  // One-store-per-circle — the host's per-circle store factory, threaded to
  // every circle (primary + lazily-spawned). Absent ⇒ each circle self-wires
  // its own store, exactly as before.
  circleStoreFor,
}) {
  if (!bus) throw new TypeError('createBrowserMultiCircleTasksAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserMultiCircleTasksAgent: identityVault required');
  if (!primaryCircleConfig?.circleId) {
    throw new TypeError('createBrowserMultiCircleTasksAgent: primaryCircleConfig.circleId required');
  }

  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  // Shared cache across primary + all spawned circles (each namespaces
  // items under mem://tasks/circles/<circleId>/).  When `persistDb` is set,
  // one persistence adapter covers them all.
  const localStoreBundle = persistDb
    ? await buildBundle({ persistDb })
    : buildBundle();

  const { meshAgent } = await buildMeshAgent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    localStoreBundle,
    label,
    // The agent's revocation truth: every circle in the map, asked at verify time. The engine takes
    // ONE resolver at construction, so a circle spawned later must be REACHABLE from it rather than
    // pushing itself in — the map is that reach.
    circleStates: () => circlesMap.values(),
  });

  const primaryBundle = await createCircleAgent({
    circleConfig:           primaryCircleConfig,
    localStoreBundle,
    vault:                  identityVault,   // persistent on both shells — the grant managers' durable store
    identity,
    transport:            meshAgent.transport,
    agent:                meshAgent,
    registerSkills:       false,   // wireSkills owns registration below
    wireOnboardingSkills: false,
    circleStoreFor,
  });
  const primaryCircleState = primaryBundle._circleState;
  const circlesMap = new Map([[primaryCircleState.circleId, primaryCircleState]]);

  // Members inherited by lazily-spawned circle circles so the local actor
  // (chat agent pubKey, registered admin on the primary circle) is
  // recognised — and not denied by RolePolicy — in every circle.
  const inheritedMembers = primaryCircleConfig.members ?? [];

  async function ensureCircle(circleId, cfg = {}) {
    if (typeof circleId !== 'string' || !circleId) return null;
    if (circlesMap.has(circleId)) return circlesMap.get(circleId);
    const spawned = await createCircleAgent({
      circleConfig: {
        circleId,
        name:    cfg.name    ?? circleId,
        kind:    cfg.kind    ?? primaryCircleConfig.kind ?? 'circle',
        members: cfg.members ?? inheritedMembers,
      },
      localStoreBundle,
      identity,
      transport:            meshAgent.transport,
      agent:                meshAgent,
      registerSkills:       false,
      wireOnboardingSkills: false,
      circleStoreFor,
    });
    const cs = spawned._circleState;
    circlesMap.set(circleId, cs);
    return cs;
  }

  // cc dispatch resolver: a scoped call (circleId/_scope) routes to that
  // circle; an unscoped call falls back to the primary circle (the legacy
  // single-circle path).  A scoped-but-unspawned circleId returns null —
  // the caller `ensureCircle()`s before dispatch, so this stays a guard
  // against silent cross-circle leaks rather than a hot path.
  const baseResolver = multiCircleResolver(circlesMap);
  function ccBundleResolver(parts, ctx) {
    const hit = baseResolver(parts, ctx);
    if (hit) return hit;
    const args = argsFromParts(parts);
    const scoped =
      (typeof args.circleId === 'string' && args.circleId) ||
      (typeof args._scope === 'string' && args._scope);
    return scoped ? null : primaryCircleState;
  }

  wireSkills({
    meshAgent,
    bundleResolver: ccBundleResolver,
    circlesProvider:  () => circlesMap.values(),
    members:        primaryBundle.members,
    circleRoleOf,
  });

  for (const def of buildMultiCircleOnboardingSkills({ bundleResolver: ccBundleResolver })) {
    meshAgent.skills.register(def);
  }

  await meshAgent.start();

  return {
    agent:   meshAgent,
    address: identity.pubKey,
    circlesMap,
    ensureCircle,
    primaryCircleState,
    close:   () => meshAgent.close?.(),
  };
}
