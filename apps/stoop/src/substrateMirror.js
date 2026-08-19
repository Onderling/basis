import { registerAgentBundle } from '@onderling/agent-registry';

import { buildSubstrateStack } from './lib/substrateStack.js';

/**
 * Attach the substrate stack + mirror to an existing Stoop bundle
 * (the return value of `createNeighbourhoodAgent`). Mutates `bundle`
 * to add `pseudoPod`, `notifyEnvelope`, `substrateDeviceId`,
 * `_substrateStop`, `mirror`, and (when `agentRegistry` is not
 * `false`) `agentRegistry`.
 *
 * Used by:
 *  - `apps/stoop-mobile/src/lib/{agentBundle,bootstrapBundle}.js`
 *  - `apps/stoop/bin/stoop-testbed.js`
 *  - Stoop's test suites (replacing legacy `wireGroupBroadcastMirror`).
 *
 * @param {object} bundle               return of createNeighbourhoodAgent
 * @param {object} opts
 * @param {string} opts.group
 * @param {Array<{pubKey: string}>} [opts.peers]
 * @param {object} [opts.evictionRoster]
 * @param {object|false} [opts.agentRegistry]
 *   Phase 52.10 / A7 — when an object (or omitted), the bundle
 *   registers this agent under `pseudo-pod://<deviceId>/private/agent-registry`
 *   via `@onderling/agent-registry`. Pass `false` to skip
 *   (tests / scenarios where registration isn't useful).
 *   Object shape: `{capabilities?: string[], name?: string, role?: string, anchorPodUri?: string}`.
 * @returns {Promise<object>} the mirror handle
 */
export async function attachSubstrateMirror(bundle, { group, peers = [], evictionRoster, agentRegistry } = {}) {
  if (!bundle?.agent) throw new Error('attachSubstrateMirror: bundle.agent required');
  if (typeof group !== 'string' || !group) {
    throw new Error('attachSubstrateMirror: group required');
  }
  const substrate = buildSubstrateStack({ agent: bundle.agent });
  bundle.pseudoPod         = substrate.pseudoPod;
  bundle.podRouting        = substrate.podRouting;
  bundle.notifyEnvelope    = substrate.notifyEnvelope;
  bundle.substrateDeviceId = substrate.deviceId;
  bundle._substrateStop    = substrate.stop;
  const mirror = await wireSubstrateMirror({
    itemStore:      bundle.itemStore,
    notifyEnvelope: substrate.notifyEnvelope,
    pseudoPod:      substrate.pseudoPod,
    group,
    peers,
    evictionRoster: evictionRoster ?? bundle.evictionRoster ?? null,
    selfPubKey:     bundle.agent?.address ?? null,
  });
  bundle.mirror = mirror;
  if (agentRegistry !== false) {
    bundle.agentRegistry = await registerAgentInRegistry({
      pseudoPod:    substrate.pseudoPod,
      podDeviceId:  substrate.deviceId,
      agent:        bundle.agent,
      opts:         typeof agentRegistry === 'object' && agentRegistry !== null ? agentRegistry : {},
    });
  }

  // A2 (substrate-adoption, 2026-05-14) — register `fetch-resource`
  // with a `groupCheck` callback that admits only current peers of
  // this group's substrate-mirror. Defensive: nothing in Stoop calls
  // `fetch-resource` against another Stoop peer today (substrate-
  // mirror replicates full payloads inline), but cross-app refs
  // (Tasks/Folio pulling a Stoop post) + future envelope-only mode
  // both want this gate in place. Multi-bundle-on-same-agent: first
  // bundle wins; subsequent attaches see the skill already registered
  // and skip. The skill reads from THIS bundle's pseudoPod only.
  try {
    if (bundle.agent?.skills && !bundle.agent.skills.get?.('fetch-resource')) {
      const peersFor = () => {
        try { return new Set(mirror?.getPeers?.() ?? []); }
        catch { return new Set(); }
      };
      const skill = substrate.pseudoPod.fetchResourceSkill({
        groupCheck: (_uri, ctx) => {
          if (typeof ctx?.from !== 'string' || !ctx.from) return false;
          return peersFor().has(ctx.from);
        },
      });
      bundle.agent.skills.register(skill);
      bundle._fetchResourceRegistered = true;
    }
  } catch (_err) { /* best-effort — non-fatal */ }

  return mirror;
}

/**
 * Register a Stoop agent on the agent-registry pod resource (Phase
 * 52.10). Thin wrapper over `registerAgentBundle` from
 * `@onderling/agent-registry` that supplies the `['stoop']` default
 * capability tag.
 *
 * Shared by web (`attachSubstrateMirror`) and mobile bundle bring-up
 * (`apps/stoop-mobile/src/lib/{agentBundle,bootstrapBundle}.js`).
 * The helper itself was lifted into `@onderling/agent-registry` on
 * 2026-05-14 so Tasks (and other apps) can reuse it without a
 * cross-app dep on Stoop.
 */
export async function registerAgentInRegistry({ pseudoPod, podDeviceId, agent, opts = {} } = {}) {
  return registerAgentBundle({
    pseudoPod,
    podDeviceId,
    agent,
    opts: {
      ...opts,
      capabilities: Array.isArray(opts.capabilities) ? opts.capabilities : ['stoop'],
    },
    onError: process?.env?.DEBUG_AGENT_REGISTRY
      // eslint-disable-next-line no-console
      ? (err) => console.error('[A7] agent-registry registration failed:', err)
      : null,
  });
}

/**
 * Substrate-shaped replacement for `groupMirror.js`.
 *
 * Retires Stoop's bespoke `wireGroupBroadcastMirror` (a pubsub-topic
 * mirror that subscribed to every peer's `<group>/requests` topic)
 * in favour of the `@onderling/notify-envelope` + `@onderling/pseudo-pod`
 * substrate path. Phase 52.9.2 of the substrates-v2 coding plan;
 * Q-B groupMirror retirement (2026-05-14).
 *
 * **What this gives us over groupMirror:**
 * - Receiver fan-in is one global subscription (not per-peer). No
 *   addPeer race conditions.
 * - The receive path runs the **3-way Lamport version compare**
 *   from Phase 52.14 (Q-D) — stale-peer / concurrent-write events
 *   surface for app-level handling.
 * - The wire is owned by `notify-envelope`, not pubsub topics:
 *   apps subscribe by `kind` rather than by `<group>/requests`.
 *
 * **What stays the same:**
 * - Surface is identical: `{addPeer, stop, listPeers, backfillFrom,
 *   getPeers}`. Drop-in replacement at bundle bring-up.
 * `evictionRoster` still filters posts from evicted members.
 * - Dedupe on `source.requestId` preserves idempotency under retry.
 *
 * Per-group recipient lists live HERE (the substrate's `pseudoPod`
 * is per-device, not per-group). `addPeer` updates the recipient
 * roster used by `postRequest` to direct fan-out at publish time.
 *
 * @param {object} args
 * @param {import('@onderling/item-store').ItemStore} args.itemStore
 * @param {object} args.notifyEnvelope   — shared per-bundle instance.
 * @param {object} args.pseudoPod        — shared per-bundle instance.
 * @param {string} args.group            — group identifier (URI namespace).
 * @param {Array<{pubKey: string}>} [args.peers]
 * @param {import('./lib/EvictionRoster.js').EvictionRoster} [args.evictionRoster]
 * @param {string} [args.selfPubKey]     — local agent address; filtered out
 *                                          of the recipient roster (self).
 * @returns {Promise<{
 *   addPeer:      (pubKey: string) => Promise<void>,
 *   stop:         () => Promise<void>,
 *   listPeers:    () => string[],
 *   getPeers:     () => string[],
 *   backfillFrom: (pubKey: string, items: Array<object>) => Promise<void>,
 * }>}
 */
export async function wireSubstrateMirror({
  itemStore,
  notifyEnvelope,
  pseudoPod,
  group,
  peers = [],
  evictionRoster = null,
  selfPubKey = null,
}) {
  /** Per-group recipient roster. Read by `postRequest` at publish
   *  time to direct notify-envelope fan-out. */
  const recipients = new Set();

  function addPeerSync(pubKey) {
    if (!pubKey || typeof pubKey !== 'string') return;
    if (selfPubKey && pubKey === selfPubKey) return;
    recipients.add(pubKey);
  }
  for (const p of peers) addPeerSync(p?.pubKey);

  /**
   * The mirror handler — turns a broadcast payload into a local
   * itemStore item. Shape is identical to the legacy groupMirror's
   * `mirror()` so the backfill path can keep using it.
   */
  async function mirror(payload, fromPubKey) {
    if (!payload) return;
    const requestId = payload.requestId;
    if (!requestId) return;
    if (evictionRoster) {
      const fromWebid = payload.from ?? null;
      if (fromWebid && evictionRoster.isEvicted(fromWebid)) return;
    }
    // Dedupe — same O(N) check as legacy. Stoop's open-request volume
    // is small (tens at most).
    const open = await itemStore.listOpen();
    if (open.some((i) => i?.source?.requestId === requestId)) return;

    // Canonical `type` + `kind` flow through verbatim (Phase 52.7.2
    // cut-over 2026-05-14).
    const type = typeof payload.type === 'string' && payload.type
      ? payload.type
      : 'request';
    const draft = {
      type,
      ...(typeof payload.kind === 'string' && payload.kind ? { kind: payload.kind } : {}),
      text:           payload.text ?? '(broadcast)',
      requiredSkills: payload.requiredSkills ?? [],
      visibility:     'household',
      source: {
        requestId,
        broadcast:    true,
        from:         payload.from ?? null,
        fromPubKey,
        claimsTopic:  payload.claimsTopic ?? null,
        categoryId:   payload.categoryId ?? null,
        skillTags:    Array.isArray(payload.skillTags) ? payload.skillTags : [],
        attachments:  Array.isArray(payload.attachments) ? payload.attachments : [],
        ...(Array.isArray(payload.embeds) && payload.embeds.length > 0
          ? { embeds: payload.embeds }
          : {}),
      },
    };
    if (typeof payload.dueAt === 'number') draft.dueAt = payload.dueAt;
    await itemStore.addItems([draft], {
      actor: payload.from ?? (fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : 'broadcast'),
    });
  }

  /**
   * Subscribe to `kind: 'request'` envelopes. notify-envelope's
   * receive path already wrote the payload into the local
   * `pseudoPod` (via the Q-D version-aware `writeFromPeer`) before
   * firing this callback — we just need to mirror into itemStore.
   *
   * Filter to our group: the publisher embedded the group in the
   * `pseudo-pod://<device>/stoop/<group>/requests/<id>` URI;
   * receivers in other groups silently skip.
   */
  const uriPrefix = `/stoop/${group}/requests/`;
  const unsubscribe = notifyEnvelope.subscribe({
    kind: 'request',
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(uriPrefix)) return;
      const fromPubKey = envelope.fromActor ?? null;
      mirror(envelope.payload, fromPubKey).catch(() => {
        /* swallow — UI reflects on next post */
      });
    },
  });

  /**
   * Q-D (Phase 52.14) auto-heal: when a peer's `writeFromPeer` lands
   * with an older `_v` than ours, `pseudoPod` emits `'stale-peer'`
   * with our fresher local copy. Republish that copy back at the
   * stale peer so they converge. Silent (no UI affordance)
   * recommendation was auto-heal-only; banner deferred to V3 if real
   * divergence is observed in field testing.
   */
  function _onStalePeer(event) {
    const uri = event?.uri;
    if (typeof uri !== 'string' || !uri.includes(uriPrefix)) return;
    const stalePeer = event.fromActor;
    if (typeof stalePeer !== 'string' || stalePeer.length === 0) return;
    const localBytes = event.localBytes;
    if (typeof localBytes === 'undefined' || localBytes === null) return;
    if (selfPubKey && stalePeer === selfPubKey) return;
    notifyEnvelope.publish({
      type:       'request',
      ref:        uri,
      payload:    localBytes,
      etag:       event.localEtag ?? null,
      _v:         event.localV,
      recipients: [stalePeer],
      ...(selfPubKey ? { fromActor: selfPubKey } : {}),
    }).catch(() => { /* best-effort heal */ });
  }
  const unsubscribeStale = pseudoPod.on?.('stale-peer', _onStalePeer) ?? null;

  async function addPeer(pubKey) {
    addPeerSync(pubKey);
  }

  async function stop() {
    try { unsubscribe(); } catch { /* swallow */ }
    if (typeof unsubscribeStale === 'function') {
      try { unsubscribeStale(); } catch { /* swallow */ }
    }
    recipients.clear();
  }

  function listPeers() { return [...recipients]; }
  function getPeers()  { return [...recipients]; }

  /**
   * Backfill — same surface as legacy. Replays an array of items
   * from `pubKey` through `mirror()`. Idempotent via the dedupe
   * inside `mirror()`. Used by the group-onboarding path to seed a
   * new member with the publisher's existing posts.
   */
  async function backfillFrom(pubKey, items) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it || it.completedAt) continue;
      if (it.source?.broadcast) continue;   // skip items the publisher itself received as a mirror
      const synthPayload = {
        requestId:  it.id,
        text:       it.text,
        from:       it.addedBy,
        type:       it.type,
        kind:       it.kind ?? null,
        dueAt:      it.dueAt,
        categoryId: it.source?.categoryId ?? null,
        skillTags:  it.source?.skillTags  ?? [],
        attachments: Array.isArray(it.source?.attachments) ? it.source.attachments : [],
        ...(Array.isArray(it.source?.embeds) && it.source.embeds.length > 0
          ? { embeds: it.source.embeds }
          : {}),
        requiredSkills: it.requiredSkills ?? [],
        claimsTopic: null,
      };
      await mirror(synthPayload, pubKey).catch(() => { /* swallow */ });
    }
  }

  return { addPeer, stop, listPeers, getPeers, backfillFrom };
}
