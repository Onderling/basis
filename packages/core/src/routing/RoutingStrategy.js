/**
 * RoutingStrategy — selects the best transport for a given peer + action.
 *
 * Transport priority (high → low):
 *   internal > local > mdns > rendezvous > relay > nkn > mqtt > ble
 *
 * Selection logic:
 *   1. If a PeerGraph record exists for the peer:
 *        - If type === 'a2a' → only 'a2a' transport
 *        - If type === 'native'|'hybrid' → pick by priority / latency / filter
 *   2. Check FallbackTable for measured latency; prefer fastest healthy transport.
 *   3. Apply transportFilter (config allowlist).
 *   4. Apply pattern filter (streaming, bulk, bidi).
 *
 * `transports` is a Map<name, Transport> supplied by the consumer.
 * For single-transport agents pass `{ [name]: transport }`.
 */
import { FallbackTable } from './FallbackTable.js';
import { tierForTransport, tierForRouteVia, TIERS } from './ReachabilityTier.js';

/** Canonical priority order (index 0 = highest priority). */
export const TRANSPORT_PRIORITY = [
  'internal', 'local', 'mdns', 'rendezvous', 'relay', 'nkn', 'mqtt', 'ble', 'a2a',
];

/**
 * Per-peer transport selector for outbound traffic. Combines PeerGraph type hints,
 * per-peer pinned preferences, FallbackTable latency/degradation data, and a fixed
 * priority order to pick the best transport; tierFor() additionally classifies the
 * selection into 'direct' | 'mesh' | 'hop' reachability tiers, and routeLadder()
 * exposes the full 'direct → mesh → hop → companion' rung ladder.
 */
export class RoutingStrategy {
  #transports;    // Map<name, Transport>
  #peerGraph;     // PeerGraph | null
  #fallback;      // FallbackTable
  #config;        // { transportFilter?: string[] }
  #preferred;     // Map<peerId, transportName> — per-peer override set by
                  // Agent-layer hooks (e.g. rendezvous upgrade). Consulted
                  // first in selectTransport and cleared on downgrade.
  #hopResolver;   // ((peerId) => via|null) | null — resolves a peer-as-relay
                  //   bridge for the hop rung (e.g. ReachabilityOracle.bridgeFor).
  #companionRoute;// ((peerId) => via|null) | null — resolves a companion carry
                  //   for the companion rung. Opt-in; the companion adapter is
                  //   not built yet (see routeLadder — the rung degrades honestly).
  #logger;        // { warn?(msg, meta) } | null — honest-degrade log sink.

  /**
   * @param {object} opts
   * @param {Map<string, object>|object} opts.transports  — name→Transport map (or plain object)
   * @param {object}  [opts.peerGraph]    — PeerGraph instance (optional)
   * @param {object}  [opts.fallbackTable]
   * @param {object}  [opts.config]       — { transportFilter?: string[] }
   * @param {(peerId: string) => object|string|null} [opts.hopResolver]
   *   — resolves a hop-rung route-via (peer-as-relay bridge) for a peer, or
   *     null when no bridge is known. Defaults to null (hop rung degrades).
   * @param {(peerId: string) => object|string|null} [opts.companionRoute]
   *   — resolves a companion-rung route-via for a peer, or null. Opt-in;
   *     defaults to null (companion rung degrades honestly — no adapter yet).
   * @param {{ warn?: (msg: string, meta?: object) => void }} [opts.logger]
   *   — sink for honest-degrade logging when a rung's adapter is absent.
   */
  constructor({
    transports = {}, peerGraph = null, fallbackTable = null, config = {},
    hopResolver = null, companionRoute = null, logger = null,
  }) {
    this.#transports = transports instanceof Map
      ? transports
      : new Map(Object.entries(transports));
    this.#peerGraph      = peerGraph;
    this.#fallback       = fallbackTable ?? new FallbackTable();
    this.#config         = config;
    this.#preferred      = new Map();
    this.#hopResolver    = hopResolver;
    this.#companionRoute = companionRoute;
    this.#logger         = logger;
  }

  get fallbackTable() { return this.#fallback; }
  get peerGraph()     { return this.#peerGraph; }

  /**
   * Attach (or replace) the PeerGraph after construction. Some consumers
   * build the router before the peer registry exists — e.g. a secure-agent
   * constructs its shared router at factory time, while the app-owned
   * PeerGraph (the per-transport address registry consulted by
   * `PeerGraph.addressesOf`, B2) is only created once the app has booted.
   * Wiring it here lets `selectTransport`'s type hints AND the send path's
   * per-transport address resolution start consulting the graph without
   * re-constructing the router.
   *
   * @param {object|null} peerGraph  — a PeerGraph instance, or null to detach.
   */
  attachPeerGraph(peerGraph) {
    this.#peerGraph = peerGraph ?? null;
  }

  /**
   * Select the best transport instance for a given peer.
   *
   * @param {string} peerId
   * @param {object} [opts]
   * @param {string}   [opts.pattern]             — 'streaming' | 'bulk' | 'bidi'
   * @param {string[]} [opts.preferredTransports] — names to try first (in order)
   * @returns {{ name: string, transport: object }|null}
   */
  async selectTransport(peerId, opts = {}) {
    const { pattern, preferredTransports } = opts;
    const filter   = pattern ? { [pattern]: true } : {};

    // ── Lookup PeerGraph for type hint ───────────────────────────────────────
    let peerType = 'native';
    if (this.#peerGraph) {
      const record = await this.#peerGraph.get(peerId);
      if (record) peerType = record.type ?? 'native';
    }

    if (peerType === 'a2a') {
      const t = this.#transports.get('a2a');
      return t ? { name: 'a2a', transport: t } : null;
    }

    // ── Per-peer preferred transport (set by upgrade hooks) ──────────────────
    const pinned = this.#preferred.get(peerId);
    if (pinned) {
      const t = this.#transports.get(pinned);
      if (t && !this.#fallback.isDegraded(peerId, pinned) && _canReach(t, peerId)) {
        return { name: pinned, transport: t };
      }
      // Pinned transport missing / degraded / unreachable — fall through.
    }

    // ── Build candidate list ─────────────────────────────────────────────────
    const allowFilter = this.#config.transportFilter;
    const available   = [...this.#transports.keys()].filter(n => {
      if (n === 'a2a') return false;
      if (allowFilter && !allowFilter.includes(n)) return false;
      // Skip transports that explicitly report they can't reach this peer
      // (e.g. RendezvousTransport with no open DataChannel). Default
      // canReach() is true, so this is a no-op for address-agnostic transports.
      const t = this.#transports.get(n);
      if (!_canReach(t, peerId)) return false;
      return true;
    });

    // Try FallbackTable first — if we have latency data for this peer.
    // Skip if the "best" record is itself degraded (Group EE): getBest
    // returns the top-sorted entry even when all entries are degraded,
    // which would let a dying transport win over a fresh unrecorded
    // alternative.  When ftBest is degraded, fall through to the
    // priority-order path so an unrecorded healthy candidate can be
    // chosen instead.
    const ftBest = this.#fallback.getBest(peerId, filter, available);
    if (ftBest && !this.#fallback.isDegraded(peerId, ftBest)) {
      const t = this.#transports.get(ftBest);
      if (t) return { name: ftBest, transport: t };
    }

    // ── Preferred list ───────────────────────────────────────────────────────
    if (preferredTransports) {
      for (const name of preferredTransports) {
        if (available.includes(name) && !this.#fallback.isDegraded(peerId, name)) {
          const t = this.#transports.get(name);
          if (t) return { name, transport: t };
        }
      }
    }

    // ── Default priority order ────────────────────────────────────────────────
    const ordered = TRANSPORT_PRIORITY.filter(n => available.includes(n) && n !== 'a2a');
    for (const name of ordered) {
      if (this.#fallback.isDegraded(peerId, name)) continue;
      const t = this.#transports.get(name);
      if (t) return { name, transport: t };
    }

    // All degraded — return highest-priority anyway.
    for (const name of ordered) {
      const t = this.#transports.get(name);
      if (t) return { name, transport: t };
    }

    return null;
  }

  /**
   * Called when a transport fails for a peer.
   * Marks it degraded in FallbackTable for 30 seconds.
   *
   * @param {string} peerId
   * @param {string} transportName
   * @param {number} [durationMs=30000]
   */
  onTransportFailure(peerId, transportName, durationMs = 30_000) {
    this.#fallback.markDegraded(peerId, transportName, Date.now() + durationMs);
  }

  /**
   * Pin a transport as the first choice for a specific peer. Used by
   * Agent-layer upgrade hooks (e.g. rendezvous DataChannel opened).
   *
   * @param {string} peerId
   * @param {string} transportName
   */
  setPreferredTransport(peerId, transportName) {
    this.#preferred.set(peerId, transportName);
  }

  /**
   * Drop the per-peer preference so routing falls back to priority order.
   *
   * @param {string} peerId
   */
  clearPreferredTransport(peerId) {
    this.#preferred.delete(peerId);
  }

  /** @param {string} peerId @returns {string|null} */
  getPreferredTransport(peerId) {
    return this.#preferred.get(peerId) ?? null;
  }

  /**
   * Register a transport the strategy didn't know about at construction
   * time. Called by `Agent.addTransport` so late-wired transports (e.g.
   * rendezvous after `enableRendezvous()`) participate in routing.
   *
   * @param {string} name
   * @param {object} transport
   */
  addTransport(name, transport) {
    this.#transports.set(name, transport);
  }

  /** @param {string} name */
  removeTransport(name) {
    this.#transports.delete(name);
  }

  /**
   * Classify how this agent currently reaches `peerId` into one of
   * three reachability tiers: `direct`, `mesh`, or `hop`.  See
   * `routing/ReachabilityTier.js` for definitions.
   *
   * Additive accessor on top of `selectTransport()` — does not change
   * routing behaviour, only exposes it.
   *
   * @param {string} peerId
   * @param {object} [opts]
   * @param {object} [opts.via]   — optional route-via descriptor
   *        (e.g. `{ kind: 'hop', through: peerId }`).  When provided
   *        and resolves to `'hop'`, overrides the transport tier.
   * @param {string}   [opts.pattern]
   * @param {string[]} [opts.preferredTransports]
   * @returns {Promise<{ name: string, transport: object, tier: 'direct'|'mesh'|'hop', latencyEstimate?: number }|null>}
   */
  async tierFor(peerId, opts = {}) {
    // Hop overrides any transport selection — the route-via
    // descriptor wins because it carries semantic intent.
    if (opts.via != null) {
      const viaTier = tierForRouteVia(opts.via);
      if (viaTier === TIERS.HOP) {
        const sel = await this.selectTransport(peerId, opts);
        return {
          name:            sel?.name ?? null,
          transport:       sel?.transport ?? null,
          tier:            TIERS.HOP,
          latencyEstimate: sel ? this.#latencyFor(peerId, sel.name) : undefined,
        };
      }
    }

    const sel = await this.selectTransport(peerId, opts);
    if (!sel) return null;

    return {
      name:            sel.name,
      transport:       sel.transport,
      tier:            tierForTransport(sel.transport) || tierForTransport(sel.name),
      latencyEstimate: this.#latencyFor(peerId, sel.name),
    };
  }

  /**
   * The full reachability rung ladder for `peerId`, in order:
   * `direct → mesh → hop → companion`. Each rung reports whether it is
   * currently usable; a consumer walks the ladder and takes the first
   * `available` rung (closest-to-direct first).
   *
   * - `direct` / `mesh` resolve from the agent's real transports (the
   *   Phase-2 ladder). A rung with no transport in that tier is
   *   `{ available: false, reason: 'no-transport' }`.
   * - `hop` (peer-as-relay routing) is available only when a bridge is
   *   resolvable — via `opts.via` (a `{ kind:'hop', through }` descriptor)
   *   or the injected `hopResolver`. With neither, the rung DEGRADES
   *   HONESTLY: `{ available:false, seam:true, reason:'no-hop-bridge-resolver' }`
   *   and the honest-degrade is logged. A resolved-but-offline bridge is
   *   `{ available:false, reason:'hop-bridge-unreachable' }`.
   * - `companion` (last-resort carry) is OPT-IN and its carry adapter is
   *   NOT BUILT in this slice. The SELECTION is wired: when a companion
   *   route is provided (`opts.companion` or the injected `companionRoute`)
   *   the rung resolves; otherwise it degrades honestly
   *   (`{ available:false, seam:true, reason:'companion-adapter-not-wired' }`,
   *   logged). The `seam:true` marks where the companion adapter lands (C8/G7).
   *
   * Additive — does not change `selectTransport` / `tierFor`.
   *
   * @param {string} peerId
   * @param {object} [opts]
   * @param {object|string} [opts.via]        — force a hop route-via descriptor
   * @param {object|string} [opts.companion]  — force a companion route-via descriptor
   * @param {string}   [opts.pattern]
   * @param {string[]} [opts.preferredTransports]
   * @returns {Promise<Array<{ tier: string, available: boolean, name?: string,
   *   transport?: object, via?: object|string, through?: string|null,
   *   degraded?: boolean, latencyEstimate?: number, reason?: string, seam?: boolean }>>}
   */
  async routeLadder(peerId, opts = {}) {
    const rungs = [];

    // ── direct + mesh — the Phase-2 ladder, resolved from real transports ──
    for (const tier of [TIERS.DIRECT, TIERS.MESH]) {
      const sel = await this.#bestTransportForTier(peerId, tier, opts);
      rungs.push(sel
        ? {
            tier, available: true, name: sel.name, transport: sel.transport,
            degraded: sel.degraded, latencyEstimate: sel.latencyEstimate,
          }
        : { tier, available: false, reason: 'no-transport' });
    }

    // ── hop — peer-as-relay routing (transport-hop) ────────────────────────
    rungs.push(await this.#hopRung(peerId, opts));

    // ── companion — opt-in last-resort carry (adapter not built; seam) ─────
    rungs.push(this.#companionRung(peerId, opts));

    return rungs;
  }

  /**
   * Best transport WITHIN a single reachability tier, in priority order,
   * preferring healthy over degraded (mirrors `selectTransport`'s policy).
   * Returns `null` when the agent has no transport in that tier for the peer.
   */
  async #bestTransportForTier(peerId, tier, opts = {}) {
    const allowFilter = this.#config.transportFilter;
    const available = [...this.#transports.keys()].filter((n) => {
      if (n === 'a2a') return false;
      if (allowFilter && !allowFilter.includes(n)) return false;
      if (!_canReach(this.#transports.get(n), peerId)) return false;
      return tierForTransport(n) === tier;
    });
    if (available.length === 0) return null;

    const ordered = TRANSPORT_PRIORITY.filter((n) => available.includes(n));
    // Healthy first.
    for (const name of ordered) {
      if (this.#fallback.isDegraded(peerId, name)) continue;
      const t = this.#transports.get(name);
      if (t) return { name, transport: t, degraded: false, latencyEstimate: this.#latencyFor(peerId, name) };
    }
    // All degraded — highest priority anyway (matches selectTransport).
    for (const name of ordered) {
      const t = this.#transports.get(name);
      if (t) return { name, transport: t, degraded: true, latencyEstimate: this.#latencyFor(peerId, name) };
    }
    return null;
  }

  /** Resolve the hop rung: a peer-as-relay bridge + its carrying transport. */
  async #hopRung(peerId, opts = {}) {
    let via = null;
    if (opts.via != null && tierForRouteVia(opts.via) === TIERS.HOP) via = opts.via;
    else if (this.#hopResolver) {
      const r = this.#hopResolver(peerId);
      if (r != null && tierForRouteVia(r) === TIERS.HOP) via = r;
    }

    if (!via) {
      this.#degradeRung(TIERS.HOP, peerId, 'no-hop-bridge-resolver');
      return { tier: TIERS.HOP, available: false, reason: 'no-hop-bridge-resolver', seam: true };
    }

    const through = typeof via === 'object' ? (via.through ?? null) : null;
    if (!through) {
      // A hop descriptor with no bridge peer isn't actionable on its own.
      this.#degradeRung(TIERS.HOP, peerId, 'hop-no-bridge');
      return { tier: TIERS.HOP, available: false, via, through: null, reason: 'hop-no-bridge', seam: true };
    }

    const sel = await this.selectTransport(through, opts);
    if (!sel) {
      // Resolver named a bridge, but we can't currently reach it — an honest
      // runtime degrade (not a seam — the wiring is present, the bridge is offline).
      this.#degradeRung(TIERS.HOP, peerId, 'hop-bridge-unreachable');
      return { tier: TIERS.HOP, available: false, via, through, reason: 'hop-bridge-unreachable' };
    }
    return { tier: TIERS.HOP, available: true, via, through, name: sel.name, transport: sel.transport };
  }

  /**
   * Resolve the companion rung. Opt-in: available only when a companion route
   * is provided. The companion CARRY adapter is not built in this slice — this
   * wires the SELECTION and leaves the `seam:true` marker where the adapter lands.
   */
  #companionRung(peerId, opts = {}) {
    let via = null;
    if (opts.companion != null && tierForRouteVia(opts.companion) === TIERS.COMPANION) via = opts.companion;
    else if (this.#companionRoute) {
      const r = this.#companionRoute(peerId);
      if (r != null && tierForRouteVia(r) === TIERS.COMPANION) via = r;
    }

    if (!via) {
      this.#degradeRung(TIERS.COMPANION, peerId, 'companion-adapter-not-wired');
      return { tier: TIERS.COMPANION, available: false, reason: 'companion-adapter-not-wired', seam: true };
    }

    const through = typeof via === 'object' ? (via.through ?? null) : null;
    // Selection resolved; the actual carry runs through the injected companion
    // route. `seam:true` still flags that the shared companion adapter (C8/G7)
    // is a later build — callers wire their own carry until then.
    return { tier: TIERS.COMPANION, available: true, via, through, seam: true };
  }

  /** Emit an honest-degrade log when a rung's adapter/route is absent. */
  #degradeRung(tier, peerId, reason) {
    if (this.#logger && typeof this.#logger.warn === 'function') {
      this.#logger.warn(`[routing] rung "${tier}" unavailable for ${peerId}: ${reason}`, { tier, peerId, reason });
    }
  }

  /**
   * Look up the latest recorded latency for (peer, transport) from
   * the FallbackTable.  Returns `undefined` when no measurement has
   * been recorded yet.
   *
   * @param {string} peerId
   * @param {string} transportName
   * @returns {number|undefined}
   */
  #latencyFor(peerId, transportName) {
    if (!this.#fallback) return undefined;
    const entries = this.#fallback.getAll(peerId);
    const hit = entries.find(e => e.transportName === transportName);
    if (!hit) return undefined;
    return Number.isFinite(hit.latencyMs) ? hit.latencyMs : undefined;
  }
}

function _canReach(transport, peerId) {
  if (!transport) return false;
  if (typeof transport.canReach !== 'function') return true;
  try { return transport.canReach(peerId); }
  catch { return false; }
}
