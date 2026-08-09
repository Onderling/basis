/**
 * ReachabilityOracle — push-side wrapper around the signed-claim oracle.
 *
 * The pull-side of oracle bridge selection is already wired:
 *   - producer skill `reachable-peers` (skills/reachablePeers.js)
 *   - GossipProtocol pulls + verifies + populates PeerGraph.knownPeers
 *   - hopBridges.buildBridgeList consults PeerGraph oracle entries first
 *
 * This class adds an *additive* push-style gossip channel and a clean
 * lookup surface for callers that want explicit oracle access:
 *
 *   - On `start()`, signs the agent's current direct-peer set into a claim
 *     and publishes it on the `reachability:oracle` pubsub topic.
 *   - Re-broadcasts:
 *        (Q-G.1) on every `transport-added` / `transport-removed`
 *        (Q-G.1) every `intervalMs` (default 60s) as a heartbeat
 *        (manual) `notifyTransportChange()` for callers whose agent
 *                 doesn't emit transport-* events
 *   - Receives oracle gossip from peers via the `publish` event, verifies
 *     each claim with `verifyReachabilityClaim`, and stores valid entries
 *     in a local Map keyed by issuer pubKey.
 *   - TTL eviction (Q-G.2): entries expire after `ttlMs` (default 5 min).
 *   - `bridgeFor(peerId)` returns an issuer (the bridge) whose stored
 *     claim's peer-list contains `peerId`, or null when nothing matches.
 *
 * The oracle is opt-in.  When unset, hopBridges falls back entirely to
 * the existing PeerGraph-driven probe-retry path.
 *
 * See Design-v3/oracle-bridge-selection.md.
 */

import { Emitter }                 from '../Emitter.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';
import {
  signReachabilityClaim,
  verifyReachabilityClaim,
  createMemorySeqStore,
  DEFAULT_VERIFY_LIMITS,
}                                  from '../security/reachabilityClaim.js';

// Parameter register (#36) — reachability oracle cadence (scope:device, kind:internal). Caller-overridable.
export const DEFAULT_TTL_MS      = param({ key: 'reachabilityOracle.ttlMs',      scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 * 60_000 });     // default entry lifetime
export const DEFAULT_INTERVAL_MS = param({ key: 'reachabilityOracle.intervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });         // safety-net heartbeat
/** Pubsub topic on which signed reachability-oracle claims are broadcast and received. */
export const ORACLE_TOPIC        = 'reachability:oracle';

/**
 * Push-side gossip channel for signed reachability claims, plus a lookup surface.
 * Signs and publishes this agent's direct-peer set on ORACLE_TOPIC (on start(), on
 * transport add/remove, and on a heartbeat interval), verifies inbound claims with
 * a per-issuer sequence replay guard, caches them with TTL eviction, and answers
 * bridgeFor(peerId) with a deterministically chosen bridge issuer or null.
 */
export class ReachabilityOracle extends Emitter {
  #agent;
  #identity;
  #ttlMs;
  #intervalMs;
  #changeDriven;
  #seqStore;
  #verifyLimits;

  /** issuerPubKey → { claim, receivedAt, expiresAt, sourcePeerId } */
  #entries = new Map();
  /** issuerPubKey → number (last accepted body.s for replay-guard) */
  #lastSeenSeq = new Map();

  #heartbeatTimer = null;
  #running        = false;

  // Bound listener references so we can off() symmetrically.
  #onPublishBound;
  #onTransportChangeBound;

  /**
   * @param {object} opts
   * @param {object} opts.agent                       — Agent (or Emitter shape)
   * @param {object} opts.identity                    — AgentIdentity used to sign our claim
   * @param {number} [opts.ttlMs=300000]              — claim TTL + cache eviction window (Q-G.2)
   * @param {number} [opts.intervalMs=60000]          — heartbeat re-broadcast cadence (Q-G.1)
   * @param {boolean} [opts.changeDriven=true]        — re-broadcast on transport add/remove (Q-G.1)
   * @param {object} [opts.seqStore]                  — { read, write } monotonic store; defaults to in-memory
   * @param {object} [opts.verifyLimits]              — overrides for { maxPeers, maxTtlMs, maxBytes }
   */
  constructor({
    agent,
    identity,
    ttlMs        = DEFAULT_TTL_MS,
    intervalMs   = DEFAULT_INTERVAL_MS,
    changeDriven = true,
    seqStore,
    verifyLimits,
  } = {}) {
    super();
    if (!agent)    throw new Error('ReachabilityOracle: agent is required');
    if (!identity) throw new Error('ReachabilityOracle: identity is required');

    this.#agent        = agent;
    this.#identity     = identity;
    this.#ttlMs        = ttlMs;
    this.#intervalMs   = intervalMs;
    this.#changeDriven = changeDriven;
    this.#seqStore     = seqStore ?? createMemorySeqStore(0);
    this.#verifyLimits = {
      ...DEFAULT_VERIFY_LIMITS,
      // Allow callers to receive claims with TTLs up to our own configured
      // maxAge — but never tighter than the spec ceiling.
      maxTtlMs: Math.max(DEFAULT_VERIFY_LIMITS.maxTtlMs, ttlMs),
      ...(verifyLimits ?? {}),
    };

    this.#onPublishBound         = (evt) => this.#onPublish(evt);
    this.#onTransportChangeBound = ()    => { this.#broadcastSelf().catch(() => {}); };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Idempotent. Kicks off the first broadcast + the heartbeat + listeners. */
  start() {
    if (this.#running) return;
    this.#running = true;

    // First broadcast — fire-and-forget; errors emit as 'error'.
    this.#broadcastSelf().catch(err => this.emit('error', err));

    // Heartbeat safety-net (Q-G.1).
    this.#heartbeatTimer = setInterval(() => {
      this.#broadcastSelf().catch(err => this.emit('error', err));
    }, this.#intervalMs);
    // In Node, prevent the timer from holding the event loop open.
    if (typeof this.#heartbeatTimer?.unref === 'function') this.#heartbeatTimer.unref();

    // Subscribe to inbound oracle gossip.
    if (typeof this.#agent.on === 'function') {
      this.#agent.on('publish', this.#onPublishBound);
    }

    // Change-driven re-broadcast (Q-G.1).
    if (this.#changeDriven && typeof this.#agent.on === 'function') {
      this.#agent.on('transport-added',   this.#onTransportChangeBound);
      this.#agent.on('transport-removed', this.#onTransportChangeBound);
    }
  }

  /** Idempotent. Halts heartbeat + unsubscribes listeners. */
  stop() {
    if (!this.#running) return;
    this.#running = false;

    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;

    if (typeof this.#agent.off === 'function') {
      this.#agent.off('publish',           this.#onPublishBound);
      this.#agent.off('transport-added',   this.#onTransportChangeBound);
      this.#agent.off('transport-removed', this.#onTransportChangeBound);
    }
  }

  /**
   * Manual hook for callers whose agent doesn't emit transport-add/remove
   * events. Forces an immediate re-broadcast of our current claim.
   */
  notifyTransportChange() {
    if (!this.#running) return Promise.resolve();
    return this.#broadcastSelf().catch(err => this.emit('error', err));
  }

  // ── Lookup surface ────────────────────────────────────────────────────────

  /**
   * Best bridge for reaching `peerId`, or null when the oracle has no
   * useful entry. Caller falls back to the existing probe-retry path.
   *
   * Resolution: among non-expired entries, pick an issuer whose claim's
   * peer-list contains `peerId`. Issuers are scanned in lexicographic
   * order for deterministic bridge selection across runs.
   *
   * @param {string} peerId
   * @returns {{ bridge: string, transport: string|null, latencyEstimate: number|null } | null}
   */
  bridgeFor(peerId) {
    if (!peerId) return null;
    const now = Date.now();

    // Order issuers deterministically.
    const issuers = [...this.#entries.keys()].sort();
    for (const issuer of issuers) {
      const entry = this.#entries.get(issuer);
      if (!entry) continue;
      if (now > entry.expiresAt) {
        this.#entries.delete(issuer);
        continue;
      }
      if (entry.claim.body.p.includes(peerId)) {
        return { bridge: issuer, transport: null, latencyEstimate: null };
      }
    }
    return null;
  }

  /** Number of currently-stored, non-expired entries. */
  get size() {
    this.#evictExpired();
    return this.#entries.size;
  }

  /** All issuer pubKeys with non-expired entries. */
  knownIssuers() {
    this.#evictExpired();
    return [...this.#entries.keys()];
  }

  /** Raw entry by issuer (for tests / debug). May be undefined. */
  getEntry(issuerPubKey) {
    const entry = this.#entries.get(issuerPubKey);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#entries.delete(issuerPubKey);
      return undefined;
    }
    return entry;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  async #broadcastSelf() {
    if (!this.#running) return;

    const peers = await this.#snapshotDirectPeerPubKeys();
    const claim = await signReachabilityClaim(this.#identity, peers, {
      ttlMs:    this.#ttlMs,
      seqStore: this.#seqStore,
    });

    if (typeof this.#agent.publish === 'function') {
      try {
        await this.#agent.publish(ORACLE_TOPIC, claim);
        this.emit('broadcast', { claim });
      } catch (err) {
        // Soft-fail; next heartbeat will retry.
        this.emit('error', err);
      }
    }
  }

  /**
   * Read direct-peer pubkeys from the agent's PeerGraph (when available),
   * filtering to hops:0 + reachable !== false. Self is excluded.
   * Result is sorted (signReachabilityClaim re-sorts anyway) and returned
   * as a fresh array.
   */
  async #snapshotDirectPeerPubKeys() {
    const graph = this.#agent.peers;
    if (!graph || typeof graph.all !== 'function') return [];
    const all  = await graph.all();
    const self = this.#agent.pubKey ?? this.#identity.pubKey;
    return all
      .filter(p => p?.pubKey && p.pubKey !== self)
      .filter(p => (p.hops ?? 0) === 0)
      .filter(p => p.reachable !== false)
      .map(p => p.pubKey);
  }

  #onPublish({ from, topic, parts } = {}) {
    if (topic !== ORACLE_TOPIC) return;

    const claim = this.#extractPayload(parts);
    if (!claim || !claim.body || typeof claim.sig !== 'string') return;

    const issuer      = claim.body.i;
    const lastSeenSeq = this.#lastSeenSeq.get(issuer);

    const res = verifyReachabilityClaim(claim, {
      expectedIssuer: issuer,
      lastSeenSeq,
      maxPeers:  this.#verifyLimits.maxPeers,
      maxTtlMs:  this.#verifyLimits.maxTtlMs,
      maxBytes:  this.#verifyLimits.maxBytes,
    });

    if (!res.ok) {
      this.emit('claim-rejected', { issuer, reason: res.reason });
      return;
    }

    const now = Date.now();
    this.#entries.set(issuer, {
      claim,
      receivedAt:   now,
      expiresAt:    now + Math.min(claim.body.t, this.#ttlMs),
      sourcePeerId: from ?? issuer,
    });
    this.#lastSeenSeq.set(issuer, res.newLastSeq);
    this.emit('peer-updated', { peerId: issuer, claim });
  }

  /**
   * The publish event delivers `parts` as whatever the publisher passed
   * to `agent.publish()`. Our broadcaster passes the claim object directly,
   * which `Parts.wrap` normalises into [DataPart({...})]. So we accept:
   *   - a Part[] containing a DataPart whose .data is the claim
   *   - the bare claim object (defensive — for tests that bypass wrap)
   */
  #extractPayload(parts) {
    if (parts == null) return null;
    if (Array.isArray(parts)) {
      const dp = parts.find(p => p?.type === 'DataPart');
      if (dp?.data) return dp.data;
      // Some test paths inline the claim as the only element.
      const first = parts[0];
      if (first?.body && typeof first.sig === 'string') return first;
      return null;
    }
    // Defensive — bare claim object.
    if (parts.body && typeof parts.sig === 'string') return parts;
    return null;
  }

  #evictExpired() {
    const now = Date.now();
    for (const [k, v] of this.#entries) {
      if (now > v.expiresAt) this.#entries.delete(k);
    }
  }
}
