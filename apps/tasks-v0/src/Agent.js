/**
 * TasksAgent — composition of substrates for H4 V0.
 *
 * Wires:
 *   - `core.Agent` from `@onderling/core` — real SkillRegistry + dispatch.
 *     built once via `buildMeshAgent` (process-level shared agent).
 *   - L1b ItemStore (open/closed tasks, audit, role-policy gate at the
 *     item level via `buildStandardRolePolicy(roles)`)
 *   - L1h MemberMap (webid ↔ external-id resolution; resolveMember skill)
 *   - L1e OfferingMatch (claim flow via pubsub-of-skills) — optional
 *   - L1f Notifier (deadline reminders, daily digest) — optional
 *
 * Skills register ONCE via `wireSkills` against a per-process
 * meshAgent. The minimal CircleState that V0 builds carries just the
 * itemStore + dataSource + roles + members; richer wiring (chat,
 * bot, metrics) is left null and surfaced by `createCircleAgent`.
 *
 * Apps that want HTTP exposure call `mountLocalUi(bundle.agent)` from
 * `@onderling/agent-ui`; that wraps `core.A2ATransport` on 127.0.0.1.
 */

import {
  MemorySource,
  TaskGrantManager,
} from '@onderling/core';
import { CircleItemStore, createTaskStore } from '@onderling/item-store';
import { MemberMap } from '@onderling/identity-resolver';
import { OfferingMatch } from '@onderling/offering-match';

import { buildStandardRolePolicy } from './rolePolicy.js';
import { buildMeshAgent } from './MeshAgent.js';
import { wireSkills } from './wireSkills.js';
import { singleCircleResolver } from './bundleResolver.js';

const V0_DEFAULT_CIRCLE_ID = 'household';

/**
 * High-level tasks-agent factory.
 *
 * @param {object} args
 * @param {object} [args.itemBackend]
 * @param {object} [args.localStoreBundle]
 * @param {Object<string, string>} args.roles
 * @param {Array<object>} [args.members]
 * @param {object} [args.pod]
 * @param {object} args.pod.client
 * @param {string} args.pod.configUri
 * @param {Array<object>} [args.pod.fallback]
 * @param {object} [args.offeringMatch]
 * @param {object} [args.notifier]
 * @param {object} [args.identity]
 * @param {object} [args.transport]
 * @param {string} [args.label='TasksAgent']
 * @param {() => object} [args.circleProvider]
 *   When supplied, the CircleState's `liveCircle` getter delegates
 *   to this. Used by `createCircleAgent` so its richer config is the
 *   one observed by the registered skills.
 * @param {string} [args.identityVault]
 * @returns {Promise<{
 *   agent: object, itemStore: object, members: MemberMap,
 *   notifier: object | null, offeringMatch: OfferingMatch | null,
 *   localStore: object | null, _circleState: object,
 * }>}
 *   `_circleState` is exposed so `createCircleAgent` can enrich the
 *   per-circle wiring (chat / bot / metrics) without a second
 *   skill-registration pass.
 */
export async function createTasksAgent({
  itemBackend,
  localStoreBundle,
  roles,
  members:    initialMembers,
  pod:        podCfg,
  offeringMatch: offeringMatchOpts,
  notifier:   providedNotifier,
  identity,
  transport,
  label = 'TasksAgent',
  circleProvider,
  circleMutator: externalMutator,
  identityVault,
  // Multi-circle runtime (2026-05-14, Tasks V2 sixth slice) —
  // a pre-built `core.Agent` to reuse across circle bundles; when
  // truthy, `registerSkills` defaults to false so the CLI owns the
  // single wireSkills call.
  agent: sharedAgent,
  registerSkills,
  // Multi-circle runtime — per-circle item-store rootContainer. When
  // multiple circles share a single localStoreBundle, each needs its
  // own URI prefix so addTask writes don't leak across circles. The
  // legacy `'mem://tasks/'` is preserved as the default for the
  // single-circle path.
  itemStoreRoot,
  // One-store-per-circle — an EXTERNAL per-circle CircleItemStore to use
  // instead of constructing our own. When the host already owns a circle
  // store (basis' household store), injecting it here means tasks and the
  // circle's other items live in ONE store, syncing over ONE mirror. Absent
  // ⇒ tasks-v0 constructs its own store (single-circle / standalone path).
  circleStore: injectedCircleStore,
}) {
  if (!roles || typeof roles !== 'object') {
    throw new TypeError('createTasksAgent: roles map required');
  }
  if (podCfg && initialMembers) {
    throw new TypeError('createTasksAgent: pass either `pod` or `members`, not both');
  }
  if (itemBackend && localStoreBundle) {
    throw new TypeError('createTasksAgent: pass either `itemBackend` or `localStoreBundle`, not both');
  }

  // ── Substrates ─────────────────────────────────────────────────────────────
  const policy    = buildStandardRolePolicy(roles);
  const dataSource = localStoreBundle?.cache ?? itemBackend ?? new MemorySource();
  // migration step 2 (2026-07-18) — the LIVE store is now the converged
  // `CircleItemStore` (generic typed CRUD + type index + causal/CAS writes),
  // with the task lifecycle/CRUD supplied by the ported functions-over-store and
  // exposed through `createTaskStore` — the thin ItemStore-compatible surface
  // (Emitter + audit + inbound-sync) the ~26 call sites already speak. No
  // registry is injected: tasks-v0 stores several non-canonical types
  // (`subtask-proposal` / `subtask-request` / `inbox-item`), so validation-on-
  // write stays off — exact parity with the class ItemStore, which validated
  // separately (warn-only) rather than rejecting on write.
  // enforce hard subtask dependencies: parent can't close while any of
  // its `dependencies[]` is still open (threaded into the task-store ctx).
  // The injected host store (one-store-per-circle) wins; else construct our own.
  const circleStore = injectedCircleStore ?? new CircleItemStore({
    dataSource,
    rootContainer:        itemStoreRoot ?? 'mem://tasks/',
  });
  const itemStore = createTaskStore(circleStore, {
    rolePolicy:           policy,
    enforceDependencies:  true,
  });

  const members = podCfg
    ? await MemberMap.fromPodConfig({
        podClient: podCfg.client,
        configUri: podCfg.configUri,
        fallback:  podCfg.fallback,
      })
    : new MemberMap({ initial: initialMembers ?? [] });

  const notifier = providedNotifier ?? null;

  // ── MeshAgent (process-level shared agent) ────────────────────────
  const { meshAgent: agent, vault, identity: id } = await buildMeshAgent({
    identity,
    transport,
    localStoreBundle,
    identityVault,
    label,
    // This circle's issuer-side revocation truth (its taskGrantManager + the botAgentRegistry
    // Circle.js parks on it later) reaches the engine THROUGH the CircleState, which is built a
    // little further down — hence the provider. With a shared agent this is ignored on purpose:
    // that agent's engine was built by the multi-circle host over ITS map of circle states, which
    // this circle joins.
    circleStates: () => [circleState],
    agent: sharedAgent,
  });

  // ── TaskGrantManager ("authority travels with the task") ────────────
  // The agent's OWN identity is the granter/token-issuer. `attachTaskGrant`
  // (skills/index.js) issues an attenuated, task-scoped cap-token per member;
  // completeTask/removeTask revoke every grant materialized for the task, so a
  // grant's authority expires WITH the task. OFF BY DEFAULT: a freshly-built
  // manager has granted nothing — a task carries authority ONLY after an
  // explicit attach. The manager is a revocation SOURCE: the agent's PolicyEngine reads it through
  // this circle's CircleState (see the `circleStates` provider above), so a revoked grant fails
  // `checkInbound` at the verifier even if the holder still has the token stored.
  // `store: vault` is what makes a revoke outlive the process. Without it the manager keeps its
  // revocation set in memory only, so a restart re-admits holders it had already cut off while their
  // tokens are still signed and unexpired — and it says so loudly on construction rather than
  // degrading in silence.
  const taskGrantManager = new TaskGrantManager({ identity: id, store: vault });

  // OfferingMatch (Phase 4.2 — composes core.Agent + pubSub directly).
  let offeringMatch = null;
  if (offeringMatchOpts?.group) {
    offeringMatch = new OfferingMatch({
      agent,
      peers:      offeringMatchOpts.peers ?? [],
      group:      offeringMatchOpts.group,
      localActor: offeringMatchOpts.localActor ?? null,
    });
    await offeringMatch.start();
  }

  // ── CircleState ─────────────────────────────────────────────────────
  // V0 zero-config path — internal liveCircle + mutator (implicit household).
  // V1+ path (createCircleAgent) — passes its own circleProvider + circleMutator
  // so its richer config is the one observed by skills + the one its own
  // wiring (rewireCalendarEmission, rewireInvoicing, etc.) reads from.
  const useExternalCircle = typeof circleProvider === 'function';
  const useExternalMutator = typeof externalMutator === 'function';
  let internalLiveCircle = Object.freeze({
    circleId:     V0_DEFAULT_CIRCLE_ID,
    name:       'Household',
    kind:       'household',
    members:    initialMembers ?? [],
    customRoles: [],
  });
  const circleState = {
    get circleId() {
      const lc = useExternalCircle ? circleProvider() : internalLiveCircle;
      return lc?.circleId ?? V0_DEFAULT_CIRCLE_ID;
    },
    get liveCircle() {
      return useExternalCircle ? circleProvider() : internalLiveCircle;
    },
    circleMutator(patch) {
      if (useExternalMutator) {
        externalMutator(patch);
      } else {
        internalLiveCircle = Object.freeze({ ...internalLiveCircle, ...patch });
      }
    },
    roles,
    itemStore,
    // The UNDERLYING CircleItemStore, alongside the task-store wrapper above. Exposed so a host can
    // attach a peer mirror to it (`wireStoreMirror`) — the wrapper has no `setSyncHook`, so without
    // this a circle's tasks can be written and read but never SYNCED, which is exactly what happened
    // (2026-08-03: the circle's mirror was wired and paired, and the tasks lived in a store it could
    // not see).
    circleStore,
    dataSource,
    members,
    // task-scoped grants — the granting authority skills reach via the
    // resolved CircleState (like `itemStore`). Present on every path.
    taskGrantManager,
    // V1+ wiring slots — left null on the V0 path; createCircleAgent
    // sets these post-construction.
    chatController:    null,
    botAgentRegistry:  null,
    metricsTracker:    null,
    notifierChannels:  null,
    onCalendarEmissionChange: null,
    onCompensationChange:     null,
  };

  // ── Skills (single registration via wireSkills) ───────────────────
  // Default behaviour: register skills here (single-circle path).
  // Multi-circle runtime (Tasks V2 sixth slice): when `registerSkills:
  // false` or when a shared `agent` is supplied (and the caller didn't
  // override), skip — the CLI calls wireSkills ONCE with a
  // multi-circle bundleResolver.
  const shouldRegisterSkills = typeof registerSkills === 'boolean'
    ? registerSkills
    : !sharedAgent;
  if (shouldRegisterSkills) {
    wireSkills({
      meshAgent: agent,
      bundleResolver: singleCircleResolver(circleState),
      members,
      // ONE reader for every authority gate. A single-circle agent is composed with an EXPLICIT
      // `roles` map — the caller stating who administers this circle — so that map is the honest
      // answer here. A multi-circle host injects its own reader instead (the circle's folded
      // roster). Either way the gate asks one question of one source and refuses when it has none,
      // rather than reaching into whatever member list happens to be nearby.
      circleRoleOf: async (_circleId, webid) => (webid ? (roles?.[webid] ?? null) : null),
    });
  }

  if (!sharedAgent) {
    await agent.start();
  }

  return {
    agent,
    itemStore,
    circleStore,   // see above — the mirror attaches here, not to the task-store wrapper
    members,
    notifier,
    offeringMatch,
    taskGrantManager,
    localStore: localStoreBundle ?? null,
    _circleState: circleState,
  };
}

export { buildStandardRolePolicy } from './rolePolicy.js';
export { computeStatus, detectCycle } from './dag.js';
