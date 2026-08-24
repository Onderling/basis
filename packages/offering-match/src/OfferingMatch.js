/**
 * OfferingMatch — broadcast offering-tagged requests; route to subscribers
 * whose offering profile + posture matches.
 *
 * **Migrated 2026-05-04 (Phase 4.2 of substrate refactor).**  The
 * pre-2026-05-04 version had a bespoke `transport` interface
 * (`{publish, subscribe, start, stop}`) that duplicated what
 * `core.Agent` + `pubSub.js` already provide. The synthetic
 * `InMemoryTransport` was the only concrete; production never had a
 * real partner. Per the L1e audit, that abstraction is gone — the
 * substrate now consumes a real `core.Agent` and routes through
 * `core/protocol/pubSub.js` directly.
 *
 * Topology (closed group):
 *   - Each member runs an `Agent`.
 *   - Each agent subscribes to **every other agent in the group** on the
 *     `<group>/requests` topic. When agent A broadcasts a request, every
 *     pre-subscribed peer receives it.
 *   - Claims flow back via per-broadcast `<group>/claims/<requestId>`
 *     topics: the broadcaster subscribes to every peer on that topic
 *     for the lifetime of the broadcast.
 *
 * Topic / cleanup discipline:
 *   - Inbound subscriptions (peer broadcasts → us) live for the
 *     OfferingMatch's lifetime. They're set up in `start()` and torn down
 *     in `stop()`.
 *   - Per-broadcast claim subscriptions are scoped to the broadcast
 *     and unsubscribed on completion / timeout.
 *
 * Posture values (unchanged from V0):
 *   - 'always'      — auto-claim immediately
 *   - 'negotiable'  — present a prompt to the human; they decide
 *   - 'never'       — ignore (substrate filters out before handler runs)
 *   - undefined     — same as 'negotiable'
 *
 * Roster:
 *   The constructor takes `peers: Array<{pubKey: string}>` — typically
 *   sourced from `MemberMap.fromPodConfig({podClient, configUri})` per
 *   `@onderling/identity-resolver`. Apps can add/remove peers post-construction
 *   via `addPeer({pubKey})` / `removePeer(pubKey)`.
 */

import { publish, subscribe, unsubscribe, dropSubscriber, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

import { ulid } from './ulid.js';

// Parameter register (#36) — broadcast claim-collection timeout (scope:device, kind:internal).
const DEFAULT_TIMEOUT_MS = param({ key: 'offeringMatch.timeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });

export class OfferingMatch {
  /** @type {import('@onderling/core').Agent} */ #agent;
  /** @type {string}  */ #group;
  /** @type {Map<string, {offerings: Set<string>, posture: object}>} */ #profile = new Map();
  #localActor = null;

  /** @type {Map<string, {pubKey: string}>} keyed on pubKey for de-dup. */
  #peers = new Map();

  /**
   * Phase 40.20 (2026-05-08): peers beyond the closed group whose
   * broadcasts we still want to receive (contacts + hop-discovered).
   * Inbound requests from these pubKeys are dispatched with
   * `request.extraAudience: true` so the appHandler can apply a
   * different sensitivity (rate-limit, opt-in, etc.).
   *
   * @type {Map<string, {pubKey: string}>}
   */
  #extraAudience = new Map();

  /**
   * Active inbound subscriptions to peers' broadcasts.
   * pubKey → off-fn (returned by core's pubSub.subscribe).
   * @type {Map<string, () => Promise<void>>}
   */
  #inboundOffs = new Map();

  /**
   * Local-listener for inbound broadcasts (registered when subscribe()
   * is called by the app). Stored so stop() can fully tear it down.
   * @type {((arg: {request: object, decide: Function}) => Promise<void>)|null}
   */
  #appHandler = null;

  /** @type {boolean} */
  #started = false;

  /**
   * @param {object} args
   * @param {import('@onderling/core').Agent} args.agent  Real `core.Agent`.
   * @param {Array<{pubKey: string}>} [args.peers=[]]    Closed-group roster (pubKey-keyed).
   * @param {string} args.group                          Closed-group identifier (topic prefix).
   * @param {string} [args.localActor]                   This agent's display id (e.g. webid).
   *   Defaults to `agent.address` (typically the pubKey for relay/local transports).
   *   Used as the `from` field in broadcasts/claims; opaque to the substrate.
   * @param {Array<string>} [args.offerings]             This agent's local offering list (legacy `skills` accepted).
   * @param {Object<string, 'always'|'negotiable'|'never'>} [args.posture]
   *
   * Phase 40.20 (2026-05-08, Stoop V3 mobile broadcast-scope locked):
   * @param {Array<{pubKey: string}>} [args.extraAudience=[]]
   *   Additional peers (beyond the closed group) to subscribe to.
   *   Inbound requests from these peers carry an `extraAudience` flag
   *   that the receiver's `appHandler` can use to apply different
   *   sensitivity (e.g. dampen hop-discovered sends per.20 8a).
   */
  constructor({ agent, peers = [], group, localActor, offerings, skills, posture, extraAudience = [] }) {
    if (!agent || typeof agent.on !== 'function') {
      throw new TypeError('OfferingMatch: agent (a core.Agent instance) required');
    }
    if (typeof group !== 'string' || !group) {
      throw new TypeError('OfferingMatch: group required');
    }
    this.#agent      = agent;
    this.#group      = group;
    this.#localActor = localActor ?? agent.address ?? null;

    for (const p of peers) this.addPeer(p);
    for (const p of extraAudience) this.addExtraAudiencePeer(p);

    // Read-accept: new callers pass `offerings`; legacy callers pass `skills`.
    const localOfferings = offerings ?? skills;
    if (localOfferings || posture) {
      this.setLocalProfile({ offerings: localOfferings ?? [], posture: posture ?? {} });
    }
  }

  // ── Local profile ──────────────────────────────────────────────

  /**
   * Declare this agent's own offerings + posture.  Used by the
   * substrate's subscription filter to skip requests we can't handle.
   *
   * @param {object} args
   * @param {string[]} args.offerings   (legacy `skills` accepted)
   * @param {Object<string, string>} args.posture
   */
  setLocalProfile({ offerings, skills, posture }) {
    this.#profile.set('local', {
      offerings: new Set(offerings ?? skills),
      posture:   { ...(posture ?? {}) },
    });
  }

  // ── Peer roster (closed group) ─────────────────────────────────

  /**
   * Add a peer to the roster. If `start()` has already run and the peer
   * is new, subscribe to their broadcasts immediately.
   *
   * @param {{pubKey: string}} peer
   */
  addPeer(peer) {
    if (!peer?.pubKey || typeof peer.pubKey !== 'string') {
      throw new TypeError('OfferingMatch.addPeer: peer.pubKey (string) required');
    }
    if (peer.pubKey === this.#agent.address) return;     // never subscribe to self
    // Roster — idempotent.
    if (!this.#peers.has(peer.pubKey)) {
      this.#peers.set(peer.pubKey, { pubKey: peer.pubKey });
    }
    // Subscribe attempt — fire on EVERY addPeer (not only the first)
    // so a re-add via agent.on('peer') after hello completes retries
    // a subscribe that failed during start() because the peer wasn't
    // hello'd yet.  `#subscribeToPeer` is idempotent via the
    // `#inboundOffs.has` gate inside.
    if (this.#started) this.#subscribeToPeer(peer.pubKey).catch(() => {});
  }

  /** Remove a peer; tears down their inbound subscription if active. */
  async removePeer(pubKey) {
    this.#peers.delete(pubKey);
    const off = this.#inboundOffs.get(pubKey);
    if (off) {
      this.#inboundOffs.delete(pubKey);
      try { await off(); } catch { /* ignore */ }
    }
  }

  /** @returns {string[]} */
  listPeers() { return [...this.#peers.keys()]; }

  /**
   * Phase 40.20 — add a peer to the **extraAudience** roster (contacts
   * / hop-discovered). Subscribes to their broadcast topic so we
   * receive their requests, but tags them with `extraAudience: true`
   * on inbound dispatch so the appHandler knows the source.
   *
   * @param {{pubKey: string}} peer
   */
  addExtraAudiencePeer(peer) {
    if (!peer?.pubKey || typeof peer.pubKey !== 'string') {
      throw new TypeError('OfferingMatch.addExtraAudiencePeer: peer.pubKey (string) required');
    }
    if (peer.pubKey === this.#agent.address) return;
    if (this.#peers.has(peer.pubKey)) return;          // group peers shadow extras
    if (!this.#extraAudience.has(peer.pubKey)) {
      this.#extraAudience.set(peer.pubKey, { pubKey: peer.pubKey });
    }
    // Same retry-aware re-subscribe as addPeer — see its comment.
    if (this.#started) this.#subscribeToPeer(peer.pubKey).catch(() => {});
  }

  /** @returns {string[]} */
  listExtraAudience() { return [...this.#extraAudience.keys()]; }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Subscribe to every roster peer's `<group>/requests` topic. After
   * this resolves, broadcasts from any peer flow into the local
   * handler registered via `subscribe(handler)`.
   */
  async start() {
    if (this.#started) return;
    this.#started = true;
    // Per-peer subscribe is best-effort: a peer in the roster whose
    // pubKey hasn't been hello'd yet (common after PeerGraph-seeded
    // bundle bring-up — entries are addresses we've SEEN advertise
    // via mDNS / relay, but the hello handshake may not have
    // completed) will be rejected by the SecurityLayer with
    // "no pubkey registered for recipient … send hi first".  We
    // swallow per-peer; agent.on('peer') will re-add + subscribe
    // them once hello lands.  Without this, one un-hello'd peer
    // aborts the entire start() → buildGroupState fails → Stoop's
    // ServiceContext can't bring the bundle up.
    for (const pubKey of this.#peers.keys()) {
      try { await this.#subscribeToPeer(pubKey); } catch { /* swallow per-peer */ }
    }
    for (const pubKey of this.#extraAudience.keys()) {
      try { await this.#subscribeToPeer(pubKey); } catch { /* swallow per-peer */ }
    }
  }

  /** Tear down all subscriptions and reset the started flag. */
  async stop() {
    this.#started = false;
    for (const off of this.#inboundOffs.values()) {
      try { await off(); } catch { /* ignore */ }
    }
    this.#inboundOffs.clear();
    this.#appHandler = null;
  }

  // ── Broadcast ──────────────────────────────────────────────────

  /**
   * Broadcast an offering-tagged request and collect claims.
   *
   * @param {object} args
   * @param {string[]} args.requiredOfferings   (legacy `requiredSkills` accepted)
   * @param {object} args.payload
   * @param {number} [args.timeoutMs]
   * @param {number} [args.expectClaims]
   * @returns {Promise<{claims: Array<{actor: string, payload: object, at: number}>}>}
   */
  async broadcast({
    requiredOfferings, requiredSkills, payload,
    timeoutMs = DEFAULT_TIMEOUT_MS, expectClaims = 1,
    scope = 'group',
  }) {
    // Read-accept: new callers pass `requiredOfferings`; legacy pass `requiredSkills`.
    const required = requiredOfferings ?? requiredSkills;
    if (!Array.isArray(required)) {
      throw new TypeError('broadcast: requiredOfferings (array) required');
    }
    if (!this.#started) {
      throw new Error('OfferingMatch.broadcast: call start() first');
    }
    if (typeof scope !== 'string' || !['group', 'group+contacts', 'group+contacts+hops'].includes(scope)) {
      throw new TypeError(`broadcast: scope must be one of 'group' | 'group+contacts' | 'group+contacts+hops' (got ${scope})`);
    }
    const requestId   = ulid();
    const requestsTopic = this.#topic('requests');
    const claimsTopic   = this.#topic(`claims/${requestId}`);

    const claims = [];
    let resolveClaims;
    const claimsPromise = new Promise((r) => { resolveClaims = r; });

    // Subscribe to each peer (group + extraAudience when scope is wider)
    // for the claims topic. Each peer that chooses to claim will
    // publish its claim on its OWN claims topic; we subscribe per-peer
    // so we receive every potential claimer.
    const claimOffs = [];
    const claimAudience = scope === 'group'
      ? [...this.#peers.keys()]
      : [...this.#peers.keys(), ...this.#extraAudience.keys()];
    for (const pubKey of claimAudience) {
      const off = await subscribe(this.#agent, pubKey, claimsTopic, (parts) => {
        const claim = parts?.find?.((p) => p?.type === 'DataPart')?.data;
        if (!claim) return;
        claims.push(claim);
        if (claims.length >= expectClaims) resolveClaims();
      });
      claimOffs.push(off);
    }

    // Publish the request on our own requestsTopic. Peers pre-subscribed
    // (via their start() against us) receive it via core's pubSub.
    // The `scope` field tells the receiver whether we asked for a
    // group-only broadcast (no extra-audience filter on their side)
    // or a wider one.
    await publish(this.#agent, requestsTopic, {
      requestId,
      from:              this.#localActor,
      requiredOfferings: required,
      payload,
      claimsTopic,
      scope,
    });

    let timeoutHandle;
    const timeoutPromise = new Promise((r) => {
      timeoutHandle = setTimeout(r, timeoutMs);
    });
    await Promise.race([claimsPromise, timeoutPromise]);
    clearTimeout(timeoutHandle);

    // Tear down the per-broadcast claim subscriptions.
    for (const off of claimOffs) {
      try { await off(); } catch { /* ignore */ }
    }
    return { claims };
  }

  // ── Subscribe (incoming requests handler) ──────────────────────

  /**
   * Register the app-side handler that runs on each incoming request
   * passing the local-profile filter + posture rules. Returns an
   * off-fn that detaches the handler (subscriptions to peers stay live;
   * call `stop()` to fully tear down).
   *
   * `posture: 'always'` causes auto-claim BEFORE the handler runs.
   * `posture: 'negotiable'` (or undefined) requires the handler to
   * call `decide('claim')` based on local logic / human prompt.
   *
   * @param {(args: {request: object, decide: (d: 'claim'|'decline') => Promise<void>}) => Promise<void>} handler
   * @returns {() => void}
   */
  subscribe(handler) {
    this.#appHandler = handler;
    return () => { if (this.#appHandler === handler) this.#appHandler = null; };
  }

  // ── Internal ──────────────────────────────────────────────────

  async #subscribeToPeer(pubKey) {
    if (this.#inboundOffs.has(pubKey)) return;
    const requestsTopic = this.#topic('requests');
    // Phase 40.20: tag inbound from extra-audience peers so the
    // appHandler / receive-side filter can apply different sensitivity.
    const isExtraAudience = !this.#peers.has(pubKey) && this.#extraAudience.has(pubKey);
    const off = await subscribe(this.#agent, pubKey, requestsTopic, (parts) => {
      const request = parts?.find?.((p) => p?.type === 'DataPart')?.data;
      if (!request) return;
      this.#dispatchInbound({ ...request, fromExtraAudience: isExtraAudience }).catch(() => {});
    });
    this.#inboundOffs.set(pubKey, off);
  }

  async #dispatchInbound(request) {
    const local = this.#profile.get('local');
    if (!local) return;
    // Read-accept the legacy `requiredSkills` wire field alongside `requiredOfferings`.
    const required = request.requiredOfferings ?? request.requiredSkills ?? [];
    const matched = required.filter((s) => local.offerings.has(s));
    if (matched.length === 0) return;

    const postureLevels = matched.map((s) => local.posture[s] ?? 'negotiable');
    if (postureLevels.includes('never')) return;

    const decide = async (d) => {
      if (d !== 'claim') return;
      await publish(this.#agent, request.claimsTopic, {
        actor:   this.#localActor,
        payload: { acceptedOfferings: matched },
        at:      Date.now(),
      });
    };

    // Phase 40.20: extra-audience requests NEVER auto-claim — even
    // when posture is 'always' for a group context, contacts/hops
    // are by definition lower-trust. The user must explicitly opt in
    // via the appHandler.
    if (!request.fromExtraAudience && postureLevels.every((p) => p === 'always')) {
      await decide('claim');
      return;
    }
    if (this.#appHandler) await this.#appHandler({ request, decide });
  }

  #topic(suffix) {
    return `${this.#group}/${suffix}`;
  }

  /**
   * Stop broadcasting THIS GROUP's topics to these addresses — the receive half of a removal.
   *
   * The subscriber registry lives on the publisher, so this is a decision we can actually make and
   * not a request we have to hope is honoured. It had no maintenance at all: a removed member stayed
   * registered and kept receiving everything the circle broadcast, which is how a banned neighbour
   * went on reading the noticeboard.
   *
   * Scoped to this group's topic prefix, deliberately. Dropping the address everywhere would repeat
   * the mistake the per-circle exit exists to undo — tidying up one circle severing the relationship
   * in every circle you share with that person.
   *
   * Several addresses because a member is known by more than one: their webid and whatever
   * per-circle address they subscribed under. We drop what we are given rather than guess which
   * space the registration used.
   *
   * @param {string|string[]} addresses
   * @returns {number} registrations dropped
   */
  dropSubscribers(addresses) {
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const prefix = `${this.#group}/`;
    let dropped = 0;
    for (const a of list) {
      if (typeof a !== 'string' || !a) continue;
      dropped += dropSubscriber(this.#agent, a, { topicPrefix: prefix });
      this.#peers.delete(a);          // and stop counting them as an audience for future claims
    }
    return dropped;
  }
}
