/**
 * Circle — Tasks V1 multi-tenant envelope around `createTasksAgent`.
 *
 * A Circle is a closed-group container for tasks, members, role
 * config, skill vocabulary, cadences, and DoD defaults. A user
 * belongs to N circles; one agent runs per circle (V1 path) or one
 * meshAgent runs per process and many CircleStates share it (
 * path — see `./MeshAgent.js` + `./wireSkills.js`).
 *
 * Circle kinds influence DEFAULTS only — the substrate doesn't behave
 * differently per kind. Apps surface the kind in UI labels.
 *
 * Pod schema (when a pod is configured; otherwise local-only):
 *   <circle-pod>/circles/<circleId>/
 *     config.json          — this CircleConfig object
 *     skills.json          — Phase 3: skill vocabulary
 *     cadences.json        — Phase 6: deadline / nudge / approver cadences
 *     members/             — Phase 2: per-member auto-persisted (MemberMapCache)
 *     tasks/               — the existing item-store layout
 *
 * Zero-config path: `createCircleAgent({})` with no `circleConfig` and no
 * `pod` returns an implicit-household circle that is identical to V0's
 * `createTasksAgent` defaults. V0 callers don't have to touch this.
 *
 * createCircleAgent calls createTasksAgent (which now wires the
 * single-agent + bundleResolver pattern) and then ENRICHES the
 * `_circleState` it returns with the V1+ wiring (chat, bot, metrics,
 * notifier-channels). Skills resolve their CircleState at dispatch
 * time, so post-construction enrichment Just Works.
 */

import { GroupManager, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { MemberMap, MemberMapCache, buildOnboardingSkills } from '@onderling/identity-resolver';
import { Notifier, InMemoryScheduleStore, PodScheduleStore, NoopChannel, PushChannel, PushPolicy } from '@onderling/notifier';
import { wireChat } from '@onderling/chat-p2p';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { registerAgentBundle } from '@onderling/agent-registry';

import { buildTasksSubstrateStack } from './lib/substrateStack.js';
import { wireTasksSubstrateMirror } from './substrateMirror.js';

import { createTasksAgent } from './Agent.js';
import { applyCustomRoles } from './skills/customRoles.js';
import { REQUEST_KIND as SUBTASK_REQUEST_KIND, PROPOSAL_KIND as SUBTASK_PROPOSAL_KIND, isInbox } from './skills/subtasks.js';
import { BotAgentRegistry } from './bot/BotAgentRegistry.js';
import { wireCalendarEmission } from './calendar/wireCalendarEmission.js';
import { recordInvoiceLine } from './skills/invoicing.js';
import { buildMetrics } from './observability/metrics.js';
import { wireIssuerNotifications } from './notifications/wireIssuerNotifications.js';
import { InAppInboxBridge } from './bridges/InAppInboxBridge.js';
import { loadSettings, updateSettings } from './storage/settings.js';

// ── Config defaults ────────────────────────────────────────────────────────

/**
 * @typedef {'household' | 'project' | 'team' | 'friends' | 'maintenance'} CircleKind
 *
 * @typedef CircleMember
 * @property {string} webid
 * @property {string} [displayName]
 * @property {string} [pubKey]              — base64url Ed25519 pubKey
 * @property {string} role                  — standard or custom role id
 *
 * @typedef CustomRoleDef
 * @property {string} id
 * @property {number} rank
 *
 * @typedef CircleConfig
 * @property {string} circleId
 * @property {string} name
 * @property {CircleKind} kind
 * @property {CircleMember[]} members
 * @property {CustomRoleDef[]} [customRoles]
 * @property {Array<object>} [skills]                — Phase 3 vocabulary
 * @property {object} [cadences]                     — Phase 6 cadence defaults
 * @property {object} [dodPolicy]                    — Phase 5 default approval mode
 * @property {object} [archivePolicy]                — Phase 10 archive policy
 * @property {number} [subtasksAdminApprovalDepth]   — Phase 7 escalation threshold (default 3)
 * @property {Object<string, string>} [pushTokens] — webid → device push token
 * @property {object} [pushPolicy] — PushPolicy options
 *   `{maxPerDay?: number, quietHours?: [number, number] | null}`
 */

/** @type {CircleConfig} */
export const IMPLICIT_HOUSEHOLD_CONFIG = Object.freeze({
  circleId:                       'household',
  name:                         'Household',
  kind:                         'household',
  members:                      [],
  customRoles:                  [],
  subtasksAdminApprovalDepth:   3,
  // Tasks V2 standardisation adoption (2026-05-14) — storage
  // policy mirrors Stoop V2's A3 picker. `no-pod` keeps V1 UX
  // parity. Centralised/hybrid need `groupPodUri` set on the circle
  // (validated by the V2 createCircleAgent / setCircleStoragePolicy
  // path). §II.2 of the standardisation plan.
  storage:                      Object.freeze({ policy: 'no-pod' }),
});

/** Storage policies recognised on `circleConfig.storage`. */
export const CIRCLE_STORAGE_POLICIES = Object.freeze(
  ['no-pod', 'centralised', 'decentralised', 'hybrid'],
);

/** Per-kind defaults for circle creation wizards. */
export const KIND_DEFAULTS = Object.freeze({
  household:    { subtasksAdminApprovalDepth: 3 },
  project:      { subtasksAdminApprovalDepth: 4 },
  team:         { subtasksAdminApprovalDepth: 3 },
  friends:      { subtasksAdminApprovalDepth: 2 },
  maintenance:  { subtasksAdminApprovalDepth: 3 },
});

// ── Config loader ──────────────────────────────────────────────────────────

/**
 * Load a CircleConfig from a Solid pod (or the local cache). Falls back
 * to the supplied object on NOT_FOUND so the implicit-household path
 * works without a pod.
 */
export async function loadCircleConfig({
  dataSource,
  circleId,
  fallback,
  rootContainer = 'mem://tasks/circles/',
}) {
  if (!dataSource?.read) {
    throw new TypeError('loadCircleConfig: dataSource with .read() required');
  }
  if (typeof circleId !== 'string' || !circleId) {
    throw new TypeError('loadCircleConfig: circleId required');
  }

  const path = `${rootContainer}${circleId}/config.json`;
  let raw;
  try {
    raw = await dataSource.read(path);
  } catch {
    raw = null;
  }

  if (raw == null) {
    return _normaliseConfig(fallback ?? { ...IMPLICIT_HOUSEHOLD_CONFIG, circleId });
  }

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return _normaliseConfig({ circleId, ...parsed });
}

/** Save a CircleConfig to its canonical pod path. */
export async function saveCircleConfig({
  dataSource,
  config,
  rootContainer = 'mem://tasks/circles/',
}) {
  if (!dataSource?.write) {
    throw new TypeError('saveCircleConfig: dataSource with .write() required');
  }
  const c = _normaliseConfig(config);
  const path = `${rootContainer}${c.circleId}/config.json`;
  await dataSource.write(path, c);
  return c;
}

function _normaliseConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('CircleConfig: object required');
  }
  if (typeof raw.circleId !== 'string' || !raw.circleId) {
    throw new TypeError('CircleConfig: circleId required');
  }
  const kind = KIND_DEFAULTS[raw.kind] ? raw.kind : 'household';
  // V2 standardisation adoption — `storage` carries one of four
  // §II.2 policies. Default `'no-pod'`. Centralised/hybrid validate
  // a `groupPodUri` (validation lives at the skill boundary so the
  // config loader doesn't reject older saved files).
  const storage = _normaliseStorage(raw.storage);
  return Object.freeze({
    circleId:                       raw.circleId,
    name:                         raw.name ?? raw.circleId,
    kind,
    storage,
    members:                      Array.isArray(raw.members) ? raw.members : [],
    customRoles:                  Array.isArray(raw.customRoles) ? raw.customRoles : [],
    skills:                       Array.isArray(raw.skills) ? raw.skills : [],
    cadences:                     raw.cadences ?? {},
    dodPolicy:                    raw.dodPolicy ?? { defaultApproval: 'self-mark' },
    archivePolicy:                raw.archivePolicy ?? {},
    subtasksAdminApprovalDepth:   Number.isFinite(raw.subtasksAdminApprovalDepth)
      ? raw.subtasksAdminApprovalDepth
      : (KIND_DEFAULTS[kind]?.subtasksAdminApprovalDepth ?? 3),
    paused:                       !!raw.paused,
    archived:                     !!raw.archived,
    bot:                          raw.bot && typeof raw.bot === 'object' ? {
      chatBindings: raw.bot.chatBindings && typeof raw.bot.chatBindings === 'object'
        ? { ...raw.bot.chatBindings }
        : {},
    } : { chatBindings: {} },
    pushTokens:  raw.pushTokens && typeof raw.pushTokens === 'object'
      ? { ...raw.pushTokens }
      : {},
    pushPolicy:  raw.pushPolicy && typeof raw.pushPolicy === 'object'
      ? { ...raw.pushPolicy }
      : {},
    calendarEmission: raw.calendarEmission && typeof raw.calendarEmission === 'object'
      ? { enabled: !!raw.calendarEmission.enabled, ...raw.calendarEmission }
      : { enabled: false },
    compensation: raw.compensation && typeof raw.compensation === 'object'
      ? {
          enabled:     !!raw.compensation.enabled,
          defaultRate: Number.isFinite(raw.compensation.defaultRate) ? raw.compensation.defaultRate : null,
          currency:    typeof raw.compensation.currency === 'string' ? raw.compensation.currency : null,
        }
      : { enabled: false, defaultRate: null, currency: null },
    availabilityHints: raw.availabilityHints && typeof raw.availabilityHints === 'object'
      ? {
          enabled:  !!raw.availabilityHints.enabled,
          optedIn:  Array.isArray(raw.availabilityHints.optedIn)
            ? [...raw.availabilityHints.optedIn]
            : [],
        }
      : { enabled: false, optedIn: [] },
  });
}

/**
 * Normalise the optional `storage` field of a CircleConfig. Tasks V2
 * standardisation adoption (2026-05-14). Pre-V2 configs that omit
 * the field default to `'no-pod'`. Unknown / malformed policies fall
 * back to `'no-pod'` (forward-additive policy).
 */
function _normaliseStorage(raw) {
  if (!raw || typeof raw !== 'object') {
    return Object.freeze({ policy: 'no-pod' });
  }
  const policy = CIRCLE_STORAGE_POLICIES.includes(raw.policy) ? raw.policy : 'no-pod';
  if (policy === 'centralised' || policy === 'hybrid') {
    const groupPodUri = typeof raw.groupPodUri === 'string' && raw.groupPodUri.length > 0
      ? raw.groupPodUri
      : null;
    return Object.freeze({ policy, groupPodUri });
  }
  return Object.freeze({ policy });
}

// ── Circle agent factory ────────────────────────────────────────────────────

/**
 * High-level Circle agent factory. Wraps `createTasksAgent` and adds:
 *
 *   - GroupManager (so the agent can issue/redeem invites for this circle)
 *   - MemberMapCache (auto-persists the member roster through the
 *     localStoreBundle's CachingDataSource — no "save" button)
 *   - Onboarding skills (`issueInvite`, `redeemInvite`) registered on
 *     the agent via `buildOnboardingSkills` from identity-resolver.
 *   enrichment of the `_circleState` returned by createTasksAgent
 *     with chatController, botAgentRegistry, metricsTracker, and
 *     onCalendarEmissionChange / onCompensationChange callbacks. The
 *     skills look these up at dispatch time, so enriching after
 *     skill registration is fine.
 */
export async function createCircleAgent({
  circleConfig,
  localStoreBundle,
  groupManager: providedGroupManager,
  wireOnboardingSkills = true,
  onSpawn,
  identity,
  vault,
  transport,
  label,
  roles: rolesOverride,
  offeringMatch,
  notifier,
  // Durable schedule (batch 7, Task #14's tail) — when BOTH are supplied and no `notifier` override
  // is, the fallback notifier persists its jobs to the pod instead of the in-memory store that
  // forgets them on restart. Absent ⇒ in-memory, exactly as before.
  podClient,
  scheduleStoreUri,
  pushSender,
  bus,
  circleBundlesProvider,
  // Multi-circle runtime (2026-05-14, Tasks V2 sixth slice) — when
  // supplied, share this `core.Agent` instead of building one per
  // circle. `registerSkills: false` (default when `agent` is given)
  // tells `createTasksAgent` to skip its single-circle wireSkills
  // call — the CLI owns the wireSkills invocation.
  agent: sharedAgent,
  registerSkills,
  // One-store-per-circle — a factory the host supplies to hand each circle
  // its ALREADY-OWNED store (basis: the household CircleItemStore). When it
  // resolves a store, tasks live in that one store and sync over the host's
  // one mirror; tasks-v0's own substrate mirror is skipped (the host owns the
  // single fan-out path). Absent / returns null ⇒ standalone self-wired store.
  circleStoreFor,
} = {}) {
  const circle = _normaliseConfig(circleConfig ?? { ...IMPLICIT_HOUSEHOLD_CONFIG });

  // Resolve the host-owned per-circle store, if any (one-store-per-circle).
  const injectedCircleStore = (typeof circleStoreFor === 'function')
    ? (circleStoreFor(circle.circleId) ?? null)
    : null;

  // boot-time re-register the circle's custom roles into the
  // process-global `core.Roles` registry, so a fresh CLI launch
  // honours roles persisted in `circle.customRoles`.
  if (Array.isArray(circle.customRoles) && circle.customRoles.length > 0) {
    applyCustomRoles(circle.customRoles);
  }

  // Build the per-webid role map from the circle's members unless the
  // caller overrode it (tests may want to wedge in different roles).
  const roles = rolesOverride ?? Object.fromEntries(
    circle.members.map((m) => [m.webid, m.role ?? 'member']),
  );

  // Identity + vault — created here so we can hand them to GroupManager.
  //
  // when the local-store bundle is supplied, we persist the
  // vault snapshot to a per-circle path so the tasks agent's pubKey is
  // stable across CLI restarts. Cap-tokens issued to bot agents
  // then survive without auto-rotate. First boot writes a
  // fresh snapshot; subsequent boots restore from it.
  const identityVaultPath = `mem://tasks/circles/${circle.circleId}/agent/identity-vault.json`;
  let v   = vault   ?? null;
  let id  = identity ?? null;
  let restoredFromSnapshot = false;
  if (!v && !id && localStoreBundle?.cache) {
    try {
      const raw = await localStoreBundle.cache.read(identityVaultPath);
      if (raw) {
        const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
        v  = VaultMemory.fromSnapshot(snap);
        id = await AgentIdentity.restore(v);
        restoredFromSnapshot = true;
      }
    } catch { /* fall through to generate */ }
  }
  if (!v) v  = new VaultMemory();
  if (!id) id = await AgentIdentity.generate(v);
  if (!restoredFromSnapshot && localStoreBundle?.cache && !identity) {
    try {
      await localStoreBundle.cache.write(identityVaultPath, JSON.stringify(v.snapshot()));
    } catch { /* persistence failure must not break boot */ }
  }

  // `liveCircle` is the mutable pointer that admin/coord skills swap
  // (frozen-copy pattern). createTasksAgent's CircleState reads it
  // via the supplied circleProvider + circleMutator below.
  let liveCircle = circle;
  const circleProvider = () => liveCircle;
  const circleMutator  = (patch) => { liveCircle = Object.freeze({ ...liveCircle, ...patch }); };

  // Build the underlying tasks agent. We pass the seed members so
  // the MemberMap starts populated; MemberMapCache then auto-persists
  // any future mutations.
  const bundle = await createTasksAgent({
    roles,
    members:    circle.members,
    localStoreBundle,
    offeringMatch,
    notifier,
    identity:     id,
    transport,
    label:        label ?? `Circle(${circle.circleId})`,
    circleProvider,
    circleMutator,
    agent:        sharedAgent,
    registerSkills,
    // One-store-per-circle — pass the host's store through when supplied.
    circleStore:  injectedCircleStore,
    // Multi-circle runtime — when a shared agent is supplied (the CLI's
    // multi-circle path), each circle bundle MUST use its own item-store
    // root so writes don't leak across circles on the same localStore.
    // Single-circle path preserves the legacy `mem://tasks/` root.
    // (Ignored when an external store is injected — it already owns its URI.)
    itemStoreRoot: sharedAgent
      ? `mem://tasks/circles/${circle.circleId}/`
      : undefined,
  });

  const circleState = bundle._circleState;

  // Optional GroupManager + onboarding skills.
  //
  // Multi-circle runtime (2026-05-14, Tasks V2 seventh slice) — always
  // build the GroupManager and stash it on `circleState` (plus the
  // optional `onSpawn` hook). The CLI's `--multi-circle` path skips the
  // per-circle skill registration (`wireOnboardingSkills: false`) and
  // instead registers `buildMultiCircleOnboardingSkills` once against
  // the meshAgent; that wrapper resolves the right groupManager from
  // the CircleState per call via the multi-circle bundleResolver.
  let groupManager = providedGroupManager ?? new GroupManager({ identity: id, vault: v });
  circleState.groupManager = groupManager;
  circleState.onSpawn      = onSpawn ?? null;
  circleState.circleIdForOnboarding = circle.circleId;
  if (wireOnboardingSkills) {
    for (const def of buildOnboardingSkills({
      groupManager,
      members: bundle.members,
      groupId: circle.circleId,
      onSpawn,
    })) {
      bundle.agent.skills.register(def);
    }
  }

  // MemberMapCache + V1+ wiring (enrich the CircleState).
  let memberMapCacheDetach = null;
  let notifierBundle       = null;
  let chatController       = null;
  let issuerNotifyDetach   = null;
  let metricsDetach        = null;
  let notifierChannels     = null;
  let botAgentRegistry     = null;
  let calendarEmissionDetaches = [];
  let invoicingDetach          = null;

  if (localStoreBundle?.cache) {
    memberMapCacheDetach = MemberMapCache.attach({
      map:           bundle.members,
      dataSource:    localStoreBundle.cache,
      rootContainer: `mem://tasks/circles/${circle.circleId}/`,
    });

    // Phase 6 — peer-to-peer chat substrate (for the appeal flow).
    chatController = wireChat({
      agent:         bundle.agent,
      itemStore:     bundle.itemStore,
      members:       bundle.members,
      muted:         new Set(),
      metrics:       null,
      localActor:    rolesOverride
        ? Object.keys(rolesOverride)[0] ?? null
        : (circle.members[0]?.webid ?? null),
      localStableId: id?.stableId ?? null,
    });
    circleState.chatController = chatController;

    // Phase 9 — observability metrics tracker (per-circle via CircleState).
    const m = buildMetrics({ itemStore: bundle.itemStore });
    bundle.metrics = m.tracker;
    metricsDetach  = m.detach;
    circleState.metricsTracker = m.tracker;

    // Phase 9 — userSettings bound for observability skills.
    const deviceId = id?.deviceId ?? id?.pubKey ?? 'local-device';
    circleState.userSettings = {
      loadShared:   async () => loadSettings({ dataSource: localStoreBundle.cache, deviceId }),
      updateShared: async (patch) => updateSettings({
        dataSource: localStoreBundle.cache, deviceId, patch,
      }),
    };

    // cap-token-bound bot agents. Bus is sourced from the
    // tasks agent's own InternalTransport (bot agents must share it
    // to dispatch through the real protocol stack).
    const sharedBus = bus
      ?? (bundle.agent?.transport && 'bus' in bundle.agent.transport
            ? bundle.agent.transport.bus
            : null);
    botAgentRegistry = sharedBus
      ? new BotAgentRegistry({
          bus:        sharedBus,
          tasksAgent: bundle.agent,
          dataSource: localStoreBundle.cache,
          circleId:     liveCircle.circleId,
        })
      : null;
    circleState.botAgentRegistry = botAgentRegistry;
    // BotAgentRegistry's constructor calls `policyEngine.setRevocationCheck`,
    // which CLOBBERS the task-grant revocation check createTasksAgent wired.
    // Re-install a UNION so BOTH bot-token and task-grant revocations are
    // honoured at the verifier (a single PolicyEngine has one revocation hook).
    const tgm = circleState.taskGrantManager;
    if (botAgentRegistry && tgm && typeof bundle.agent.policyEngine?.setRevocationCheck === 'function') {
      bundle.agent.policyEngine.setRevocationCheck(
        (tokenId) => botAgentRegistry.isRevoked(tokenId) || tgm.isRevoked(tokenId),
      );
    }
    if (botAgentRegistry?.persisting) {
      try {
        const r = await botAgentRegistry.restoreAll();
        if (r.restored > 0 || r.expired > 0 || r.failed > 0) {
          // eslint-disable-next-line no-console
          console.log(`[BotAgentRegistry] restored=${r.restored} expired=${r.expired} failed=${r.failed}`);
        }
      } catch { /* noop */ }
    }

    // wire the per-member emission loop when enabled. The
    // calendar-emission skill calls `circleState.onCalendarEmissionChange()`
    // when the toggle flips; we hook it here.
    function rewireCalendarEmission() {
      for (const d of calendarEmissionDetaches) try { d?.(); } catch { /* noop */ }
      calendarEmissionDetaches = [];
      if (!liveCircle.calendarEmission?.enabled) return;
      for (const m of liveCircle.members ?? []) {
        const wire = wireCalendarEmission({
          itemStore:  bundle.itemStore,
          dataSource: localStoreBundle.cache,
          circle:       liveCircle,
          member:     m.webid,
          path:       `mem://user/tasks/calendars/${encodeURIComponent(liveCircle.circleId)}-${encodeURIComponent(m.webid)}.ics`,
        });
        calendarEmissionDetaches.push(wire.detach);
      }
    }
    circleState.onCalendarEmissionChange = rewireCalendarEmission;
    rewireCalendarEmission();

    // invoicing item-completed listener. The setMemberCompensation /
    // setCompensationEnabled skills call `circleState.onCompensationChange()`
    // to re-attach the listener.
    function rewireInvoicing() {
      if (invoicingDetach) try { invoicingDetach(); } catch { /* noop */ }
      invoicingDetach = null;
      if (!liveCircle.compensation?.enabled) return;
      const handler = async (item) => {
        const completer = item?.completedBy ?? item?.assignee;
        if (!completer) return;
        const member = (liveCircle.members ?? []).find((m) => m?.webid === completer);
        if (!member?.compensated) return;
        await recordInvoiceLine({
          dataSource: localStoreBundle.cache,
          circleId:     liveCircle.circleId,
          member,
          task:       item,
        });
      };
      bundle.itemStore.on('item-completed', handler);
      invoicingDetach = () => bundle.itemStore.off?.('item-completed', handler);
    }
    circleState.onCompensationChange = rewireInvoicing;
    rewireInvoicing();

    // multi-circle dashboard. Default circlesProvider returns just THIS
    // CircleState (single-circle CLI). Multi-circle launches pass a closure
    // that returns every CircleState the launcher built.
    if (typeof circleBundlesProvider === 'function') {
      // External provider — wrap it into a CircleState iterator. Each
      // provided bundle exposes {circle, itemStore, roleOf} (shape).
      circleState._dashboardCirclesProvider = () => {
        const bundles = circleBundlesProvider() ?? [];
        return bundles.map((b) => ({
          get liveCircle() { return b.circle; },
          get itemStore() { return b.itemStore; },
          roles: typeof b.roleOf === 'function'
            ? new Proxy({}, { get: (_, k) => b.roleOf(k, b.circle) })
            : (b.roles ?? {}),
        }));
      };
    }

    // Phase 6 — notifier + issuer-notification jobs.
    if (!bundle.notifier) {
      notifierChannels = { silent: new NoopChannel() };
      // Durable when a pod is threaded in (batch 7): `PodScheduleStore` persists every job except its
      // `builder` closure; the resolver below RECONSTRUCTS the one job shape this app schedules — the
      // due-deadline nudge (`wireIssuerNotifications`, cancelKey `due:<itemId>`) — by re-reading the
      // item at fire time. An item that vanished meanwhile gets an honest placeholder, not a crash;
      // an unrecognised cancelKey falls through to the store's own "builder not restored" stub.
      const scheduleStore = (podClient && scheduleStoreUri)
        ? new PodScheduleStore({
          podClient,
          uri: scheduleStoreUri,
          builderResolver: (persisted) => {
            const m = /^due:(.+)$/.exec(persisted?.cancelKey ?? '');
            if (!m) return undefined;
            const itemId = m[1];
            return async () => {
              let item = null;
              try { item = await bundle.itemStore.get(itemId); } catch { /* fall through */ }
              return item
                ? { text: `Deadline missed: "${item.text}"`,
                  meta: { eventType: 'missed-deadline', itemId, dueAt: item.dueAt } }
                : { text: 'Deadline missed: (task no longer exists)',
                  meta: { eventType: 'missed-deadline', itemId } };
            };
          },
        })
        : new InMemoryScheduleStore();
      notifierBundle = new Notifier({
        channels: notifierChannels,
        store:    scheduleStore,
      });
      notifierBundle.scheduleStore = scheduleStore;
      await notifierBundle.start();
      bundle.notifier = notifierBundle;
    } else {
      notifierChannels = null;
    }
    circleState.notifierChannels = notifierChannels;

    if (notifierChannels) {
      // optional push side-channel.
      let pushBundle = null;
      const pushTokens = liveCircle.pushTokens && typeof liveCircle.pushTokens === 'object'
        ? liveCircle.pushTokens
        : {};
      if (pushSender && Object.keys(pushTokens).length > 0) {
        const pushChannel = new PushChannel({ pushSender });
        notifierChannels.push = pushChannel;
        const policyOpts = liveCircle.pushPolicy ?? {};
        const pushPolicy = new PushPolicy({
          send: ({ recipient, payload }) => pushChannel.sendReply({
            chatId: recipient,
            text:   payload.text ?? '',
            buttons: payload.buttons,
            meta:    { ...(payload.meta ?? {}), payload },
          }),
          ...(Number.isFinite(policyOpts.maxPerDay) ? { maxPerDay: policyOpts.maxPerDay } : {}),
          ...(Array.isArray(policyOpts.quietHours) ? { quietHours: policyOpts.quietHours } : {}),
        });
        pushBundle = {
          channel: pushChannel,
          policy:  pushPolicy,
          tokenFor: (webid) => liveCircle.pushTokens?.[webid] ?? null,
        };
      }

      issuerNotifyDetach = wireIssuerNotifications({
        notifier:    bundle.notifier,
        channels:    notifierChannels,
        itemStore:   bundle.itemStore,
        dataSource:  localStoreBundle.cache,
        ...(pushBundle ? {
          pushChannel: pushBundle.channel,
          pushPolicy:  pushBundle.policy,
          tokenFor:    pushBundle.tokenFor,
        } : {}),
      }).detach;

      // Phase 7 — when a subtask-request is filed (depth past
      // threshold), broadcast it to every admin / coordinator's
      // inbox.
      const adminBridges = new Map();
      function ensureAdminBridge(webid) {
        if (adminBridges.has(webid)) return adminBridges.get(webid);
        const channelId = `inbox:${webid}`;
        let bridge = notifierChannels[channelId];
        if (!bridge) {
          bridge = new InAppInboxBridge({
            itemStore: localStoreBundle.cache,
            recipient: webid,
            id:        channelId,
          });
          notifierChannels[channelId] = bridge;
        }
        adminBridges.set(webid, bridge);
        return bridge;
      }

      const subtaskListener = async (item) => {
        if (!isInbox(item, SUBTASK_REQUEST_KIND)) return;
        const adminWebids = Object.entries(roles)
          .filter(([, r]) => r === 'admin' || r === 'coordinator')
          .map(([webid]) => webid);
        for (const w of adminWebids) {
          const b = ensureAdminBridge(w);
          try {
            await b.sendReply({
              chatId:  w,
              text:    `Sub-task approval needed: ${item.text}`,
              buttons: [
                { id: `approveSubtaskRequest:${item.id}`, label: 'Approve' },
                { id: `declineSubtaskRequest:${item.id}`, label: 'Decline' },
              ],
              meta: {
                eventType:    'subtask-request',
                requestId:    item.id,
                parentTaskId: item.source?.parentTaskId,
                requestedBy:  item.source?.requestedBy,
                requestedDepth: item.source?.requestedDepth,
              },
            });
          } catch { /* non-fatal */ }
        }
      };
      bundle.itemStore.on('item-added', subtaskListener);

      // when a subtask-proposal is added, route it to the
      // parent's assignee's inbox with Approve/Decline buttons.
      const proposalListener = async (item) => {
        if (!isInbox(item, SUBTASK_PROPOSAL_KIND)) return;
        const target = item.source?.targetAssignee;
        if (!target) return;
        const b = ensureAdminBridge(target);
        try {
          await b.sendReply({
            chatId:  target,
            text:    `${item.text}\n\n(Approving rolls your submission back to claimed.)`,
            buttons: [
              { id: `approveSubtaskProposal:${item.id}`, label: 'Approve' },
              { id: `declineSubtaskProposal:${item.id}`, label: 'Decline' },
            ],
            meta: {
              eventType:    'subtask-proposal',
              proposalId:   item.id,
              parentTaskId: item.source?.parentTaskId,
              requestedBy:  item.source?.requestedBy,
            },
          });
        } catch { /* non-fatal */ }
      };
      bundle.itemStore.on('item-added', proposalListener);

      const prevDetach = issuerNotifyDetach;
      issuerNotifyDetach = () => {
        try { bundle.itemStore.off?.('item-added', subtaskListener); } catch { /* noop */ }
        try { bundle.itemStore.off?.('item-added', proposalListener); } catch { /* noop */ }
        try { prevDetach?.(); } catch { /* noop */ }
      };
    }
  }

  // Tasks V2 standardisation adoption (2026-05-14) —
  //   Phase 52.10: register the agent in
  //     `<pseudo-pod>/private/agent-registry`.
  //   • Phase 52.9.3 (Tasks V2 ninth slice): wire the substrate stack
  //     (`pseudoPod` + `podRouting` + `notifyEnvelope`) + the
  //     per-circle tasks-mirror so addTask writes fan-out cross-device.
  //
  // Both pieces are best-effort: a failure to build any of them
  // doesn't break bundle bring-up.
  const substrateDeviceId = id?.pubKey ?? bundle.agent?.address ?? 'tasks-device';
  let tasksSubstrate = null;
  try {
    tasksSubstrate = buildTasksSubstrateStack({
      agent:    bundle.agent,
      deviceId: substrateDeviceId,
    });
  } catch (_err) { /* fall through; agentRegistry still wires */ }
  bundle.pseudoPod         = tasksSubstrate?.pseudoPod ?? createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId: substrateDeviceId,
  });
  bundle.podRouting        = tasksSubstrate?.podRouting ?? null;
  bundle.notifyEnvelope    = tasksSubstrate?.notifyEnvelope ?? null;
  bundle.substrateDeviceId = substrateDeviceId;
  bundle._substrateStop    = tasksSubstrate?.stop ?? null;
  // M4: wire podRouting into the localStoreBundle's _podCtx so that
  // completePodSignIn → attachTasksBundle can activate routing at sign-in
  // time without needing a separate ref. The classify/reverse functions
  // are already on _podCtx from buildBundle; only podRouting is dynamic
  // (it comes from the substrate stack, built here).
  if (localStoreBundle?._podCtx && bundle.podRouting) {
    localStoreBundle._podCtx.podRouting = bundle.podRouting;
    localStoreBundle._podCtx.circleId     = localStoreBundle._podCtx.circleId ?? circle.circleId;
  }
  // Stash on CircleState so multi-circle skill bodies can access per-circle
  // substrate handles via bundleResolver. M4: also stash _podCtx so
  // completePodSignIn → attachTasksBundle can activate routing for
  // the circle's dataSource (the shared local-store bundle's cache).
  circleState.pseudoPod      = bundle.pseudoPod;
  circleState.notifyEnvelope = bundle.notifyEnvelope;
  circleState.substrateDeviceId = substrateDeviceId;
  circleState._podCtx        = localStoreBundle?._podCtx ?? null;
  circleState.podRouting     = bundle.podRouting;

  bundle.agentRegistry = await registerAgentBundle({
    pseudoPod:    bundle.pseudoPod,
    podDeviceId:  substrateDeviceId,
    agent:        bundle.agent,
    opts: {
      capabilities: ['tasks', 'tasks-v0', `circle:${circle.circleId}`],
      name:         circle.name,
    },
  });

  // Per-circle substrate mirror — fans out addTask writes to peers
  // and applies inbound task envelopes to the local itemStore. Only
  // wired when the full substrate stack came up (notifyEnvelope is
  // required). Selfless tests that don't need fan-out can still run.
  // One-store-per-circle — when the host injected its own circle store, the
  // host owns the SINGLE fan-out path (its store<->mirror wiring already
  // carries our task items). Wiring our own substrate mirror here would be a
  // second sync path over the same items → double-publish/ingest. Skip it.
  let tasksMirror = null;
  if (bundle.notifyEnvelope && !injectedCircleStore) {
    try {
      tasksMirror = await wireTasksSubstrateMirror({
        itemStore:       bundle.itemStore,
        notifyEnvelope:  bundle.notifyEnvelope,
        pseudoPod:       bundle.pseudoPod,
        circleId:          circle.circleId,
        peers:           (circle.members ?? []).filter(m => m?.pubKey).map(m => ({ pubKey: m.pubKey })),
        selfPubKey:      bundle.agent?.address ?? null,
      });
      circleState.tasksMirror = tasksMirror;
      bundle.tasksMirror    = tasksMirror;
    } catch (_err) { /* best-effort; addTask still works locally */ }
  }

  // Phase 52.2.x (mirror of Stoop A2, 2026-05-14) — register
  // `fetch-resource` skill with a `groupCheck` callback that admits
  // only current circle peers. Defensive: nothing in Tasks calls
  // fetch-resource against another Tasks peer today, but cross-app
  // refs (e.g. a Stoop post embedding a Tasks task) + future
  // envelope-only mode both want this gate in place. Multi-circle
  // single-agent setups: first circle wins; subsequent attaches see
  // the skill already registered and skip. The skill reads from
  // THIS circle's pseudoPod only.
  try {
    if (bundle.agent?.skills && !bundle.agent.skills.get?.('fetch-resource') && bundle.pseudoPod?.fetchResourceSkill) {
      const peersFor = () => {
        try { return new Set(tasksMirror?.getPeers?.() ?? []); }
        catch { return new Set(); }
      };
      const skill = bundle.pseudoPod.fetchResourceSkill({
        groupCheck: (_uri, ctx) => {
          if (typeof ctx?.from !== 'string' || !ctx.from) return false;
          return peersFor().has(ctx.from);
        },
      });
      bundle.agent.skills.register(skill);
      bundle._fetchResourceRegistered = true;
    }
  } catch (_err) { /* best-effort — non-fatal */ }

  return {
    ...bundle,
    memberMapCacheDetach,
    issuerNotifyDetach,
    chatController,
    groupManager,
    circle,
    /** Returns the current (mutated) live CircleConfig. */
    getCircle: () => liveCircle,
    /** cap-token bot agent registry. `null` when unavailable. */
    botAgentRegistry,
    async close() {
      try { issuerNotifyDetach?.(); } catch { /* noop */ }
      try { memberMapCacheDetach?.(); } catch { /* noop */ }
      try { metricsDetach?.(); } catch { /* noop */ }
      try { chatController?.detach?.(); } catch { /* noop */ }
      try { await botAgentRegistry?.closeAll?.(); } catch { /* noop */ }
      try {
        for (const d of calendarEmissionDetaches) try { d?.(); } catch { /* noop */ }
        calendarEmissionDetaches = [];
      } catch { /* noop */ }
      try { invoicingDetach?.(); invoicingDetach = null; } catch { /* noop */ }
      try { await notifierBundle?.stop?.(); } catch { /* noop */ }
    },
  };
}

export {
  IMPLICIT_HOUSEHOLD_CONFIG as _IMPLICIT_HOUSEHOLD_CONFIG,
};
