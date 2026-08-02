/**
 * NeighborhoodAgent — composition of substrates for H5 V0
 * (non-anonymous; Q-H5 anonymity model is parked).
 *
 * Wires:
 *   - `core.Agent` from `@onderling/core` — the real SkillRegistry +
 *     dispatch path. Skills register via `agent.skills.register(defineSkill(...))`.
 *   - L1b ItemStore (open requests, attribution, audit)
 *   - L1h MemberMap (closed-group identity resolution; pubKey-aware after
 *     Phase 4.1 — `MemberMap.fromPodConfig` includes the pubKey slot)
 *   - L1e OfferingMatch (broadcast requests + collect claims) — now
 *     consumes a real `core.Agent` + `core/protocol/pubSub.js` directly
 *     (Phase 4.2 of substrate refactor, 2026-05-04). The previous
 *     `transport` abstraction is gone.
 *   - L1f Notifier (push-style notifications when humans must decide;
 *     apps wire the channels)
 */

import { Agent, AgentIdentity, InternalBus, InternalTransport, MemorySource } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { CircleItemStore, createTaskStore } from '@onderling/item-store';
import { MemberMap, Reveals, buildIdentitySkills }    from '@onderling/identity-resolver';
import { OfferingMatch }                                 from '@onderling/offering-match';

import { buildSkills } from './skills/index.js';
import { CachingDataSource } from './lib/CachingDataSource.js';
// FilePersist intentionally NOT statically imported — node-only deps
// (node:fs/promises, node:path) would break browser bundles.  The
// `persistPicker` module dynamically imports whichever adapter the
// caller asked for (FilePersist for Node, IndexedDBPersist for
// browser).  See `lib/persistPicker.js`.
import { pickPersist }       from './lib/persistPicker.js';
import { UsageMetrics }      from './lib/UsageMetrics.js';
import { PushRegistry }      from './lib/PushRegistry.js';
import { createProfile }     from './lib/InterestProfile.js';
import { MemberMapCache }    from './lib/MemberMapCache.js';
import { RevealsCache }      from './lib/RevealsCache.js';
import { InterestProfileCache } from './lib/InterestProfileCache.js';
import { PushRegistryCache } from './lib/PushRegistryCache.js';
import { loadSettings, DEFAULT_SETTINGS } from './lib/Settings.js';
import { createContactBook } from './lib/ContactBook.js';
import { wireChat }          from './chat/wireChat.js';
import { EvictionRoster }    from './lib/EvictionRoster.js';

/**
 * @param {object} args
 * @param {object} args.offeringMatch
 * @param {string} args.offeringMatch.group                  closed-group identifier
 * @param {string} args.offeringMatch.localActor             this member's webid
 * @param {Array<{pubKey: string}>} [args.offeringMatch.peers]  closed-group roster (pubKey-keyed). Source: `MemberMap.fromPodConfig`.
 * @param {string[]} [args.offeringMatch.skills]
 * @param {Object<string, 'always'|'negotiable'|'never'>} [args.offeringMatch.posture]
 * @param {Array<object>} [args.members]                  initial roster for MemberMap (used when `pod` is not supplied)
 * @param {object} [args.pod]                             pod-backed roster (alternative to `members`)
 * @param {object} args.pod.client                        duck-typed PodClient with `.read(uri, {decode}) → {content}`
 * @param {string} args.pod.configUri                     pod URI of the group config blob (members live under `members[]`)
 * @param {Array<object>} [args.pod.fallback]             used iff config read returns NOT_FOUND
 * @param {object} [args.itemBackend]
 *   Optional inner DataSource for the item-store.  When omitted,
 *   Stoop boots in pure local-only mode using a fresh
 *   `CachingDataSource` (per the project-wide "Local-only mode is
 *   the floor" rule).  Passing an `itemBackend` (e.g. a pod-backed
 *   DataSource) wraps it in a CachingDataSource so reads stay local
 *   and writes are queued + flushed when online.  Pre-built bundles
 *   that explicitly want the legacy raw-backend behaviour can pass
 *   `cache: false`.
 * @param {boolean} [args.cache=true]
 *   When false, the factory uses `itemBackend` (or `MemorySource`)
 *   directly without the CachingDataSource wrapper.  Existing tests
 *   that drive a `MemorySource` directly stay happy.
 * @param {object} [args.notifier]
 *   Optional `@onderling/notifier.Notifier` instance.  When supplied,
 *   `postRequest({kind: 'lend', dueAt, ...})` schedules a return
 *   reminder via `notifier.scheduleBefore` and `markReturned` cancels
 *   it.  Without a notifier, lend posts still work — they just don't
 *   produce a reminder.  See Stoop V1 Phase 3.
 * @param {import('@onderling/identity-resolver').Reveals} [args.reveals]
 *   Optional reveal store (per-group + per-peer "show real name"
 *   flags).  When supplied, list-shaped skills hydrate each item's
 *   author into a `{handle, displayName?, isRevealed, render}` block
 *   via `identity-resolver.resolve()`.  Without it, lists return raw
 *   items (legacy shape preserved for back-compat).
 * @param {object} [args.identity]                        pre-built AgentIdentity (tests / shared-cluster setups)
 * @param {object} [args.transport]                       transport for `core.Agent` (default: InternalTransport over a fresh InternalBus)
 * @param {string} [args.label='NeighborhoodAgent']
 * @returns {Promise<{
 *   agent:      Agent,
 *   itemStore:  ItemStore,
 *   members:    MemberMap,
 *   offeringMatch: OfferingMatch,
 *   notifier:   object | null,
 *   reveals:    Reveals | null,
 *   muted:      Set<string>,
 * }>}
 */
export async function createNeighborhoodAgent({
  offeringMatch:    offeringMatchOpts,
  members:       initialMembers,
  pod:           podCfg,
  itemBackend,
  // Optional household sealed-pod control-agent (@onderling/pod-client `createControlAgent`). When
  // supplied, membership skills drive pod ACL + group-key grant/revoke on join/leave. Omitted by
  // instances without a sealed household pod — the hooks no-op.
  controlAgent,
  cache:         useCache = true,
  /**
   * Stoop V1 Phase 15 (2026-05-06): when set, wire a Node fs–backed
   * `FilePersist` adapter into `bundle.cache` so the local cache
   * survives Node restarts.  Path should point to a writable
   * directory (created lazily); the factory uses `<path>/state.json`.
   * Browsers / RN call sites omit this and provide their own
   * persistence path via `bundle.cache.on('queued', ...)` etc.
   */
  persistPath,
  /**
   * v0.7.cc (2026-05-23): browser equivalent of `persistPath`.
   * When `{dbName, storeName?}` is supplied + `indexedDB` is
   * available, an `IndexedDBPersist` adapter is wired into
   * `bundle.cache`.  Mutually exclusive with `persistPath` (pass
   * exactly one).  Used by basis's browser composition
   * (integration plan 2026-05-23).
   */
  persistDb,
  notifier:      providedNotifier,
  reveals:       providedReveals,
  /**
   * Stoop V1 Phase 18 (2026-05-06): in-process usage counter.  When
   * omitted, the factory creates a fresh `UsageMetrics`; callers wire
   * an override to share counters across multiple bundles (tests).
   * The `getMetrics` skill exposes a read-only snapshot.
   */
  metrics:       providedMetrics,
  /**
   * Stoop Phase 21 (2026-05-06): VAPID config for Web Push.
   * Pass `{publicKey, privateKey, subject}` to enable; without it,
   * Web-Push delivery is disabled but the subscribe / unsubscribe
   * skills still register subscriptions (the demo's loop-back path).
   * Tests inject a `pushSender` directly to bypass `web-push`.
   */
  webPush,
  pushSender:    providedPushSender,
  // S6.6 — mobile-native push. `expoPush` ({accessToken?}) builds an
  // ExpoPushSender for delivering to Expo push tokens; tests may inject
  // `expoPushSender` directly. Lazy (server-side only) like WebPushSender.
  expoPush,
  expoPushSender: providedExpoPushSender,
  dataLocationConfig,
  identity,
  transport,
  /**
   * Optional pre-built `core.Agent` to wrap.  When provided, the
   * factory uses it directly instead of constructing a new Agent
   * from `identity` + `transport` + `label`.  The caller is expected
   * to have wired any routing strategy / secondary transports it
   * needs (e.g. mDNS / BLE / relay via `@onderling/react-native`'s
   * `createMeshAgent` pattern); the factory will still call
   * `agent.start()`, which is idempotent if the caller already
   * started it.  `identity` is read from `agent.identity` when omitted.
   */
  agent: providedAgent,
  /**
   * Single-agent refactor (2026-05-08): when `false`, skip skill
   * registration on the agent, skip `agent.start()`, skip
   * enableSealedForwardFor / enableRelayForward. The caller (e.g.
   * stoop-mobile's ServiceContext) registers skills ONCE via the
   * group-aware `buildSkills({getBundle})` mode and starts the agent
   * itself. Defaults to `true` so existing single-bundle callers
   * (testbed, web Stoop) keep working unchanged.
   */
  registerSkills = true,
  /**
   * Optional RELIABLE cross-peer sender, injected by a host that owns the
   * secure-agent reliability layer (basis wires `sa.peer.sendTo(...,
   * {guarantee:'hold-forward'})`). When present, kring chat fan-out
   * (`broadcastKringMessage`) routes each recipient through it instead of the
   * bus-local `chat.send` transport — so a kring chat inherits the SAME
   * failover + offline hold-forward that durable circle content (tasks,
   * noticeboard, key-events) already has. Signature:
   *   `(toAddress, envelope, opts?) => Promise<{held?, delivered?, ...} | any>`
   * Absent → fan-out falls back to `chat.send` (the pre-existing behaviour;
   * stoop's own single-process tests exercise that path unchanged).
   */
  reliableSend,
  /**
   * Connectivity Phase 2 (G1/G2) — OPTIONAL host-injected circle data-move
   * resolver: `(circleId) => 'fan-out-full' | 'pod-signal' | 'pod-only'`
   * (may return a Promise). The host (basis) owns the ONE data-policy resolver
   * (`circleDataPolicy.circleDataMove` over the circle's stored `policy.pod`)
   * and hands the DECISION down here so the send path can branch on it without
   * an app→app import. Absent → the fan defaults to `'fan-out-full'` (today's
   * behaviour, unchanged: with no pod known, the envelope must carry the data).
   */
  circleDataMove,
  /**
   * Connectivity Phase 3 SEAM — OPTIONAL host-injected shared-pod writer:
   * `(circleId, envelope) => Promise<{ ref } | any>`. When a REAL shared pod is
   * wired (Phase 3), `broadcastToCircle` writes the message to the pod through
   * this and fans a ref envelope (pod-signal) / no envelope (pod-only). It is
   * NOT wired today (`getMessagesSince` is still a stub — DESIGN §2), so a
   * `pod-signal`/`pod-only` decision DEGRADES to `fan-out-full`, loudly logged.
   */
  podWrite,
  /**
   * Connectivity Phase 3 SEAM — OPTIONAL host-injected shared-pod READER:
   * `(circleId, {sinceTs, max}) => Promise<envelope[] | {items}>`. Symmetric to
   * `podWrite`: `getMessagesSince` range-queries the pod through this (the host
   * builds it over the circle's StorageBackend + seal resolver — see
   * @onderling/pod-client `readSealedMessagesSince`) and MERGES the result with
   * the local mirror deduped by msgId. Absent (no-pod circle) → local-mirror
   * behaviour, unchanged.
   */
  podReadSince,
  /**
   * The per-USER address-fallback setting (2026-07-28), threaded down to the circle FAN so the
   * setting reaches the place that picks an address. `false` = "rather undeliverable than routed
   * over my one global key", which is what makes per-circle addressing worth anything.
   *
   * A value or a function `() => boolean`: the user can flip it mid-session, and a boolean captured
   * at boot would ignore every change after. Absent → `true`, i.e. exactly today's behaviour.
   */
  allowAddressFallback,
  label = 'NeighborhoodAgent',
}) {
  if (!offeringMatchOpts?.group || !offeringMatchOpts?.localActor) {
    throw new TypeError('createNeighborhoodAgent: offeringMatch.{group, localActor} required');
  }
  if (podCfg && initialMembers) {
    throw new TypeError('createNeighborhoodAgent: pass either `pod` or `members`, not both');
  }

  // ── Substrates ─────────────────────────────────────────────────────────────
  // Phase 4 (Stoop V1, 2026-05-06): wrap the inner DataSource in a
  // `CachingDataSource` so reads stay local and writes are queued for
  // remote flush on a foreground-tied cadence.  Bundles that explicitly
  // opt out (`cache: false`) get the raw backend — used by pre-Phase-4
  // integration tests that drive a `MemorySource` directly.
  // Phase 2.4 (pod-routing): a mutable pod-context the closure
  // `innerKeyMap` reads.  `attachPod` (mobile ServiceContext /
  // desktop) fills it after a pod is attached:
  //   { active, classify, podRouting, circleId, vars }
  // While inactive (the no-pod default) `toInner`/`fromInner` are
  // pure identity → CachingDataSource stays byte-neutral
  // (pod-independence.md).  See apps/stoop/src/lib/podPathMap.js.
  const podCtx = {
    active: false, classify: null, podRouting: null, circleId: null, vars: null,
  };
  const _podInnerKeyMap = {
    toInner: (p) => {
      if (!podCtx.active
          || typeof podCtx.classify !== 'function'
          || !podCtx.podRouting) return p;
      const c = podCtx.classify(p, { circleId: podCtx.circleId });
      if (!c) return p; // unroutable → SolidPodSource fail-loud surfaces the gap
      const base = podCtx.podRouting.resolve(c.storageFn, podCtx.vars || {});
      if (typeof base !== 'string' || base.length === 0) return p;
      return base.endsWith('/') ? base + c.tail : `${base}/${c.tail}`;
    },
    // Phase 3.3 — inverse of toInner so pull-back / cross-app reads
    // re-key pod URIs to the logical `mem://` space. `podCtx.reverse`
    // (podPathMap.reverseResolve) is injected by attachPod alongside
    // `classify`. Inactive / no-match → identity (no-pod stays
    // byte-neutral; an unknown URI passes through unchanged).
    fromInner: (u) => {
      if (!podCtx.active
          || typeof podCtx.reverse !== 'function'
          || !podCtx.podRouting) return u;
      const logical = podCtx.reverse({
        resolve: (fn, v) => podCtx.podRouting.resolve(fn, v),
        circleId:  podCtx.circleId,
        podUri:  u,
        vars:    podCtx.vars || {},
      });
      return logical ?? u;
    },
  };

  let cache = null;
  let dataSource;
  let persist = null;
  if (useCache) {
    // Phase 15 (Stoop V1, 2026-05-06): when `persistPath` is set,
    // load any prior cache state from disk + auto-flush every change
    // via `FilePersist.scheduleSave`.  v0.7.cc (2026-05-23): same
    // path now also accepts `persistDb` for browser composition
    // (IndexedDBPersist).  Without either, the cache stays
    // in-memory only (legacy behaviour).
    let initialMap;
    const persistArgs = (typeof persistPath === 'string' && persistPath)
      ? { path: persistPath.endsWith('.json') ? persistPath : `${persistPath}/state.json` }
      : (persistDb && typeof persistDb === 'object')
        ? persistDb
        : null;
    if (persistArgs) {
      const picked = await pickPersist(persistArgs);
      if (picked) {
        persist    = picked.persist;
        initialMap = await persist.load();
      }
    }
    cache = new CachingDataSource({
      inner:         itemBackend ?? null,
      localStore:    initialMap,
      onLocalChange: persist ? (m) => persist.scheduleSave(m) : undefined,
      // per-device settings + the migration marker
      // are local-only — they must never reach the pod (the pod is
      // shared by other installs of the same user).
      localOnlyPrefixes: [
        'mem://stoop/settings/devices/',
        'mem://stoop/settings/.migrated',
      ],
      innerKeyMap: _podInnerKeyMap,
    });
    dataSource = cache;
    // When no itemBackend is supplied we boot in pure local-only mode
    // (no remote sync until `bundle.cache.attachInner(pod)`).
  } else {
    dataSource = itemBackend ?? new MemorySource();
  }
  // migration step 3 (2026-07-18): the LIVE store is the converged
  // `CircleItemStore` (generic typed CRUD + type index + causal/CAS writes),
  // wrapped by the thin `createTaskStore` ItemStore-compat surface (Emitter +
  // audit + inbound-sync). Stoop passes NO rolePolicy — parity with the old
  // `new ItemStore({...})` which took none here (the facade defaults to allow).
  const circleStore = new CircleItemStore({ dataSource, rootContainer: 'mem://neighborhood/' });
  const itemStore = createTaskStore(circleStore);
  // Member roster: pod-config-backed (Phase 4.1 contract) when `pod` is
  // supplied; hand-built array otherwise. The two paths are mutually
  // exclusive — using both is almost always a bug.
  let members;
  let memberMapDetach = null;
  if (podCfg) {
    members = await MemberMap.fromPodConfig({
      podClient: podCfg.client,
      configUri: podCfg.configUri,
      fallback:  podCfg.fallback,
    });
  } else if (cache) {
    // Phase 11.4 / fix 2026-05-06: when a CachingDataSource is wired,
    // load any persisted profile (handle / displayName / skills) from
    // the cache, then attach so future setMyHandle / setMyDisplayName
    // calls write through.  Without this, MemberMap mutations vanish
    // on restart even with `persistPath` set.
    members = await MemberMapCache.load({
      dataSource:    cache,
      rootContainer: 'mem://neighborhood/',
    });
    // Hydrate with the caller-provided initial roster on top of what
    // came back from the cache (initialMembers wins on the same key).
    for (const m of (initialMembers ?? [])) {
      try { await members.addMember(m); } catch { /* ignore — invalid entry */ }
    }
    memberMapDetach = MemberMapCache.attach({
      map:           members,
      dataSource:    cache,
      rootContainer: 'mem://neighborhood/',
    });
  } else {
    members = new MemberMap({ initial: initialMembers ?? [] });
  }

  // ── Real core.Agent ────────────────────────────────────────────────────────
  // Either reuse a pre-built agent (callers that need a routing
  // strategy + secondary transports build it themselves and hand it
  // in; e.g. mobile uses createMeshAgent's wiring) or construct the
  // default single-transport agent from the factory's args.
  let agent;
  let id;
  if (providedAgent) {
    agent = providedAgent;
    id = identity ?? agent.identity;
    if (!id) throw new TypeError('createNeighborhoodAgent: providedAgent missing identity');
  } else {
    id = identity ?? await AgentIdentity.generate(new VaultMemory());
    const tx = transport ?? new InternalTransport(new InternalBus(), id.pubKey);
    agent = new Agent({ identity: id, transport: tx, label });
  }

  // Phase 14 fix (2026-05-06): ensure the local actor has a MemberMap
  // entry with THIS agent's pubKey + stableId, so chat.send /
  // resolveByWebid round-trips work the moment the bundle is up
  // (with no dependency on setMyHandle).  Browsers also call the
  // `whoAmI` skill for the canonical {webid, pubKey, stableId} tuple.
  if (offeringMatchOpts.localActor) {
    const existing = await members.resolveByWebid(offeringMatchOpts.localActor);
    if (!existing?.pubKey || !existing?.stableId) {
      try {
        await members.addMember({
          ...(existing ?? { webid: offeringMatchOpts.localActor }),
          pubKey:   id.pubKey,
          stableId: id.stableId ?? existing?.stableId,
        });
      } catch { /* ignore — bad initial entry */ }
    }
  }

  // ── L1e OfferingMatch — composes the real agent + pubSub ─────────────────────
  const offeringMatch = new OfferingMatch({
    agent,
    peers:      offeringMatchOpts.peers ?? [],
    group:      offeringMatchOpts.group,
    localActor: offeringMatchOpts.localActor,
    offerings:  offeringMatchOpts.skills  ?? [],
    posture:    offeringMatchOpts.posture ?? {},
  });

  // ── Per-bundle local state (Stoop V1 Phase 3) ─────────────────────────────
  // `muted` is a per-viewer Set<peerWebid>.  `mutePeer` writes; UI
  // consumers query.  Pure local — never broadcast.
  const muted = new Set();
  // Phase 14 fix (2026-05-06): when the caller doesn't supply a
  // Reveals store, mint a default in-memory one so `requestReveal`
  // (the bilateral "Connectie accepteren" button) works out of the
  // box.  Without this every chat would error
  // `chat-or-reveals-not-wired` on the first reveal attempt.
  // Phase 29.1 (V2, 2026-05-07): when a CachingDataSource is wired,
  // load any persisted Reveals snapshot from the cache + attach
  // write-through.  Pod-sync rides the same path as MemberMap.
  let reveals;
  let revealsDetach = null;
  if (providedReveals) {
    reveals = providedReveals;
  } else if (cache) {
    reveals = await RevealsCache.load({ dataSource: cache });
    revealsDetach = RevealsCache.attach({ reveals, dataSource: cache });
  } else {
    reveals = new Reveals();
  }
  const metrics = providedMetrics ?? new UsageMetrics();

  // Phase 29.3 (V2, 2026-05-07): PushRegistry hydrates from cache + write-through.
  let pushRegistry;
  let pushRegistryDetach = null;
  if (cache) {
    pushRegistry = await PushRegistryCache.load({ dataSource: cache });
    pushRegistryDetach = PushRegistryCache.attach({ registry: pushRegistry, dataSource: cache });
  } else {
    pushRegistry = new PushRegistry();
  }
  let pushSender = providedPushSender ?? null;
  // Lazy-import WebPushSender only when VAPID keys are supplied so
  // bundles without push don't pay the import cost.
  if (!pushSender && webPush?.publicKey && webPush?.privateKey && webPush?.subject) {
    const { WebPushSender } = await import('./lib/WebPushSender.js');
    pushSender = new WebPushSender(webPush);
  }

  // S6.6 — Expo push sender (mobile-native). Lazy + server-side only: built
  // when `expoPush` is supplied so the in-browser/in-RN stoop (which never
  // delivers) doesn't pull @onderling/relay. ExpoPushSender needs no keys.
  let expoPushSender = providedExpoPushSender ?? null;
  if (!expoPushSender && expoPush) {
    const { ExpoPushSender } = await import('./lib/ExpoPushSender.js');
    expoPushSender = new ExpoPushSender(expoPush === true ? {} : expoPush);
  }

  // Stoop Phase 35 (2026-05-06): build the eviction roster
  // BEFORE wiring chat (chat consumes it) and BEFORE skills register
  // (so the bundle exposes it).  Hydrate from any existing
  // `membership-redemption` items, then attach so future redemptions
  // mutate the roster live.
  const evictionRoster = new EvictionRoster();
  await evictionRoster.hydrateFrom(itemStore);
  const evictionRosterDetach = evictionRoster.attach({ itemStore });

  // Stoop V1 Phase 14 (2026-05-06): wire peer-chat handler BEFORE
  // skills register, so `chat` is in scope for buildSkills.  Listens
  // for `agent.on('message', ...)` envelopes whose first DataPart
  // carries `type: 'stoop-chat'`; stores them locally as
  // `kind: 'chat-message'` items linked by `source.threadId`.
  const chat = wireChat({
    agent,
    itemStore,
    members,
    muted,
    metrics,
    localActor:    offeringMatchOpts.localActor,
    localStableId: id?.stableId ?? null,
    evictionRoster,                  // Phase 35 — drop broadcast-posts from evicted members
    dataSource:    cache,            // Phase 39 — read/write attachment bytes from the cache
    // Wave B — route 1:1 peer DMs (reveal-request / contact-add / peer chat) through the SAME
    // host-injected hold-forward sender the kring chat fan-out uses, so a DM to a briefly-offline
    // peer is HELD + flushed on reconnect. Absent (standalone stoop / no secure-agent) → the bare
    // per-peer transport, unchanged.
    reliableSend:  (typeof reliableSend === 'function') ? reliableSend : null,
  });

  // Phase 20 (Stoop, 2026-05-06): the bundle object is built
  // up incrementally so that sign-in skills can mutate
  // `bundle.oidcSession` / call `bundle.cache.attachInner(podSource)`
  // without circular construction.  We pass the same `bundle` ref
  // into `buildSkills` and finalise it just before returning.
  const bundle = {
    agent,
    deviceId: id?.deviceId ?? null,    // Phase 33.1 — per-install id for device-scoped settings
    evictionRoster,                    // Phase 35 — auto-evict filter for stale memberships
    evictionRosterDetach,              // call on shutdown to detach the item-added listener
    itemStore,
    members,
    offeringMatch,
    notifier: providedNotifier ?? null,
    reveals,
    muted,
    cache,
    _podCtx: cache ? podCtx : null,   // Phase 2.4 — filled by attachPod
    persist,
    chat,
    reliableSend: (typeof reliableSend === 'function') ? reliableSend : null,  // host-injected hold-forward sender (kring chat fan-out)
    circleDataMove: (typeof circleDataMove === 'function') ? circleDataMove : null,  // Phase 2 G1/G2 — host-injected data-move resolver (absent → fan-out-full)
    podWrite:       (typeof podWrite       === 'function') ? podWrite       : null,  // Phase 3 seam — real shared-pod writer (absent → pod-signal/pod-only degrade)
    podReadSince:   (typeof podReadSince   === 'function') ? podReadSince   : null,  // Phase 3 seam — real shared-pod reader (absent → getMessagesSince = local mirror)
    metrics,
    oidcSession: null,
    pushRegistry,                   // Phase 21 — Web-Push subscriptions per webid
    pushRegistryDetach,             // Phase 29.3 — call on shutdown to stop write-through
    pushSender,                     // Phase 21 — relay.PushSender (WebPushSender by default when webPush keys supplied)
    expoPushSender,                 // S6.6 — relay.PushSender for Expo tokens (mobile-native), when expoPush supplied
    webPushPublicKey: webPush?.publicKey ?? null,
    interestProfile:       cache    // Phase 22 + 29.2 — TF-IDF profile (loaded + write-through when cache present)
      ? await InterestProfileCache.load({ dataSource: cache })
      : createProfile(),
    interestProfileDetach: null,    // populated below when cache wires
    memberMapDetach,                   // call on shutdown to stop persisting member mutations
    revealsDetach,                     // Phase 29.1 — call on shutdown to stop persisting reveals
    settings: cache                    // Phase 23.5 + 33 — split across shared + device blobs
      ? await loadSettings({ dataSource: cache, deviceId: id?.deviceId ?? null })
      : { ...DEFAULT_SETTINGS },
    contacts: cache                    // Phase 24.1 — 1:1 contact graph + lists
      ? createContactBook({ members, dataSource: cache })
      : null,
  };

  // Phase 29.2 — wire the InterestProfile write-through after the
  // bundle (and therefore `bundle.interestProfile`) exists.
  if (cache) {
    const ipDetach = InterestProfileCache.attach({
      profile: bundle.interestProfile, dataSource: cache,
    });
    bundle.interestProfileDetach = ipDetach.detach;
    bundle.interestProfileFlushNow = ipDetach.flushNow;
  }

  // track bulk-sync state on the bundle so the UI
  // can poll it via the `getBulkSyncStatus` skill.  Phase: 'idle'
  // before any attach, 'running' while a bulk-sync is active,
  // 'finished' after, 'error' on flush failure.
  bundle.bulkSyncState = {
    phase:   'idle',
    done:    0,
    total:   0,
    errored: false,
    updatedAt: null,
  };
  if (cache) {
    cache.on('bulk-sync-started', ({ total }) => {
      bundle.bulkSyncState = {
        phase: 'running', done: 0, total, errored: false, updatedAt: Date.now(),
      };
    });
    cache.on('bulk-sync-progress', ({ done, total }) => {
      bundle.bulkSyncState = {
        ...bundle.bulkSyncState,
        phase: 'running', done, total, updatedAt: Date.now(),
      };
    });
    cache.on('bulk-sync-finished', ({ count, errored }) => {
      bundle.bulkSyncState = {
        ...bundle.bulkSyncState,
        phase: errored ? 'error' : 'finished',
        done:  count,
        errored: !!errored,
        updatedAt: Date.now(),
      };
    });
  }

  // ── Skill registration ────────────────────────────────────────────────────
  // Single-agent refactor (2026-05-08): when `registerSkills: false`
  // is passed, the caller is wiring multiple per-group bundles onto a
  // shared `core.Agent` and registers skills ONCE at the
  // service-context level via `buildSkills({getBundle})`. We skip
  // registration here, skip agent.start(), and skip the per-group
  // sealed-forward / relay-forward enables (caller's responsibility).
  if (registerSkills) {
    for (const def of buildIdentitySkills({ members })) agent.skills.register(def);
    for (const def of buildSkills({
      store:    itemStore,
      offeringMatch,
      notifier: providedNotifier,
      reveals,
      members,
      controlAgent,   // household sealed-pod membership hooks (no-op when absent)
      muted,
      localActor: offeringMatchOpts.localActor,
      groupId:    offeringMatchOpts.group,
      dataLocationConfig,
      chat,           // Phase 14 — used by sendChatMessage / respondToItem
      metrics,        // Phase 18 — record() called from key handlers
      bundle,         // Phase 20 — sign-in skills mutate bundle.oidcSession + cache
      // The per-user address-fallback setting, when the host supplies one (absent → the skills'
      // own `true` default, unchanged).
      ...(allowAddressFallback === undefined ? {} : { allowAddressFallback }),
    })) agent.skills.register(def);

    await agent.start();
  }

  // Stoop V1 Phase 13.3 (2026-05-06): hop routing — opt the agent in
  // to content-blind sealed-forward for the configured group, so any
  // intermediate hop bridge sees opaque blobs only (`nacl.box`-sealed
  // to the destination's pubkey).  Idempotent at the SDK level.
  try {
    if (offeringMatchOpts.group) {
      agent.enableSealedForwardFor(offeringMatchOpts.group);
    }
  } catch { /* SDK may surface "already enabled" or similar; non-fatal */ }

  // Phase 28.1 (Stoop V2, 2026-05-07): respect the persisted hop-mode
  // setting on cold boot.  When the user previously turned on global
  // hop-relay (settings.allowHopThrough === true), re-register the
  // relay-forward skill at the configured policy.  Off requires no
  // action — the skill only registers when explicitly enabled.
  try {
    if (bundle.settings?.allowHopThrough === true) {
      agent.enableRelayForward({ policy: 'authenticated' });
    }
  } catch { /* non-fatal */ }

  // **Caller responsibility**: register peer pubkeys at the core.Agent
  // SecurityLayer (`agent.addPeer(addr, pubKey)`) BEFORE calling
  // `bundle.offeringMatch.start()`. OfferingMatch's `start()` issues
  // pubSub.subscribe envelopes to each peer; the SecurityLayer rejects
  // sends to unknown pubkeys with `UNKNOWN_RECIPIENT — send HI first`.
  //
  // For single-agent setups (no peers), `bundle.offeringMatch.start()` is
  // a no-op and can be skipped.

  // Phase 40.20 (Stoop V3 mobile, 2026-05-08): bridge the OfferingMatch
  // appHandler to a regular `agent.on('offering-match-suggestion', ...)`
  // event so consumers (the mobile OfferingMatchInboxScreen, future
  // notifier hooks, etc.) can subscribe via the standard event
  // surface instead of hand-rolling `offeringMatch.subscribe(...)`.
  //
  // The substrate's auto-claim path is unchanged: extra-audience
  // requests (contacts / hops) NEVER auto-claim — they always reach
  // the appHandler so the user can opt in.
  offeringMatch.subscribe(async ({ request, decide }) => {
    try {
      agent.emit?.('offering-match-suggestion', { request, decide });
    } catch { /* swallow — emit failures shouldn't block the substrate */ }
  });

  return bundle;
}
