/**
 * ReachabilityTier — how this agent can reach a given peer, as an ordered
 * ladder of reachability rungs from closest (`direct`) to most indirect
 * (`companion`).
 *
 * Rungs (closest → most indirect):
 *
 *   - 'direct'    WebRTC / BLE / mDNS / Local / Internal — no third
 *                 party between the two agents once the link is up.
 *   - 'mesh'      Relay / NKN / MQTT / Offline store-and-forward —
 *                 an indirect / third-party-mediated link.
 *   - 'hop'       peer-as-relay (sealed-tunnel or plaintext bridge);
 *                 a routing decision, not a transport class.
 *   - 'companion' a user-hostable node that consent-grants "route through
 *                 me" for its owner — the last-resort carry when no closer
 *                 rung reaches the peer. Opt-in; see RoutingStrategy.routeLadder.
 *
 * TWO UNRELATED "hop"s — do not conflate them:
 *   - the TRANSPORT-hop (this module's `'hop'` rung + `routing/hopTunnel.js`,
 *     `routing/callWithHop.js`, `routing/invokeWithHop.js`) is peer-as-relay
 *     ROUTING: forwarding a sealed/plaintext payload through an intermediary
 *     peer to reach a target.
 *   - a SOCIAL match-hop (relaying a skill query one degree further through a
 *     contact who allows it) would be DISCOVERY, not routing, and would never
 *     appear in this ladder. None is built.
 * `tierForRouteVia` only ever means the transport-hop.
 *
 * Use `tierForTransport(transport)` to classify a chosen transport, or
 * `tierForRouteVia(via)` to detect a peer-as-relay hop / companion carry.
 * `compareTiers(a, b)` orders the rungs `direct` < `mesh` < `hop` <
 * `companion` — useful for surfacing "how close to direct" a connection is.
 *
 * The mapping is intentionally additive: an unknown transport defaults to
 * `'mesh'` (conservative — apps see "reachable via something indirect")
 * rather than crashing.
 */

/** Reachability-rung constants (ladder order: direct → mesh → hop → companion). */
export const TIERS = Object.freeze({
  DIRECT:    'direct',
  MESH:      'mesh',
  HOP:       'hop',
  COMPANION: 'companion',
});

const ALL_TIERS = Object.freeze([TIERS.DIRECT, TIERS.MESH, TIERS.HOP, TIERS.COMPANION]);

/**
 * Map of transport class name → tier.  Class names match the
 * concrete classes under `packages/core/src/transport/` and the
 * RN-only platform transports under `@onderling/react-native`.
 *
 * `hop` is intentionally absent — it is not a transport class, it's
 * a routing decision via `routing/hopTunnel.js` /
 * `routing/invokeWithHop.js`.  Use `tierForRouteVia()` for that.
 */
const TRANSPORT_CLASS_TIER = Object.freeze({
  // direct — no centralized intermediary on the link
  LocalTransport:      TIERS.DIRECT,
  InternalTransport:   TIERS.DIRECT,
  RendezvousTransport: TIERS.DIRECT,  // WebRTC DataChannel after signaling
  BleTransport:        TIERS.DIRECT,  // RN-only
  MdnsTransport:       TIERS.DIRECT,  // RN-only
  // mesh — centralized relays + global mesh networks
  RelayTransport:      TIERS.MESH,
  NknTransport:        TIERS.MESH,
  MqttTransport:       TIERS.MESH,
  OfflineTransport:    TIERS.MESH,    // best-effort store-and-forward
});

/**
 * Map of RoutingStrategy / agent transport name → tier.  These are
 * the lower-cased names used in `RoutingStrategy.TRANSPORT_PRIORITY`
 * and as map keys in `Agent.#transports`.
 */
const TRANSPORT_NAME_TIER = Object.freeze({
  internal:   TIERS.DIRECT,
  local:      TIERS.DIRECT,
  mdns:       TIERS.DIRECT,
  rendezvous: TIERS.DIRECT,
  ble:        TIERS.DIRECT,
  relay:      TIERS.MESH,
  nkn:        TIERS.MESH,
  mqtt:       TIERS.MESH,
  offline:    TIERS.MESH,
  // 'a2a' (Group H A2ATransport) is intentionally unmapped — it
  // covers an external-protocol peer rather than reachability of
  // this peer over our mesh.  Defaults to 'mesh' via the unknown
  // fallback below.
});

/**
 * Classify a transport into a reachability tier.
 *
 * Accepts either a transport instance (uses `transport.constructor.name`)
 * or a string class name / RoutingStrategy transport name.  Unknown
 * inputs default to `'mesh'` — see the module docstring.
 *
 * @param {object|string|null|undefined} transport
 * @returns {'direct'|'mesh'|'hop'}
 */
export function tierForTransport(transport) {
  if (!transport) return TIERS.MESH;

  // String input — could be either a class name (PascalCase) or a
  // RoutingStrategy transport name (lowercase).
  if (typeof transport === 'string') {
    if (TRANSPORT_CLASS_TIER[transport]) return TRANSPORT_CLASS_TIER[transport];
    if (TRANSPORT_NAME_TIER[transport])  return TRANSPORT_NAME_TIER[transport];
    return TIERS.MESH;
  }

  // Instance input — prefer constructor name, fall back to a `.name`
  // property if a transport stub set one (existing routing tests do).
  const ctorName = transport.constructor?.name;
  if (ctorName && TRANSPORT_CLASS_TIER[ctorName]) {
    return TRANSPORT_CLASS_TIER[ctorName];
  }
  if (typeof transport.name === 'string') {
    if (TRANSPORT_CLASS_TIER[transport.name]) return TRANSPORT_CLASS_TIER[transport.name];
    if (TRANSPORT_NAME_TIER[transport.name])  return TRANSPORT_NAME_TIER[transport.name];
  }
  return TIERS.MESH;
}

/**
 * Classify a route-via descriptor. Models the two indirect rungs that
 * are routing decisions rather than transport classes — the transport-hop
 * (`'hop'`, peer-as-relay) and the `'companion'` carry; other shapes pass
 * through to `tierForTransport` if they carry transport info, or default
 * to `'mesh'`.
 *
 * Accepts either:
 *   - a string `'hop'` / `'companion'`
 *   - `{ kind: 'hop', through?: string }` (shape used by hopTunnel
 *     and invokeWithHop) or `{ kind: 'companion', through?: string }`
 *   - `{ via: 'hop' | 'companion' | ... }` (alternative shape)
 *
 * @param {object|string|null|undefined} via
 * @returns {'direct'|'mesh'|'hop'|'companion'}
 */
export function tierForRouteVia(via) {
  if (!via) return TIERS.MESH;
  if (typeof via === 'string') {
    if (via === TIERS.HOP)       return TIERS.HOP;
    if (via === TIERS.COMPANION) return TIERS.COMPANION;
    return tierForTransport(via);
  }
  if (typeof via === 'object') {
    if (via.kind === TIERS.COMPANION || via.via === TIERS.COMPANION || via.companion) {
      return TIERS.COMPANION;
    }
    if (via.kind === TIERS.HOP || via.via === TIERS.HOP || via.hop) return TIERS.HOP;
    if (via.transport) return tierForTransport(via.transport);
    if (via.name)      return tierForTransport(via.name);
  }
  return TIERS.MESH;
}

/**
 * Compare two rungs.  Returns a negative number when `a` is closer
 * to direct than `b`, positive when farther, zero when equal.
 * Ordering: `direct` < `mesh` < `hop` < `companion`.
 *
 * @param {'direct'|'mesh'|'hop'|'companion'} a
 * @param {'direct'|'mesh'|'hop'|'companion'} b
 * @returns {number}
 */
export function compareTiers(a, b) {
  return ALL_TIERS.indexOf(a) - ALL_TIERS.indexOf(b);
}

/**
 * Default export — convenient re-export bundle for consumers that
 * want the whole module under one symbol.
 */
const ReachabilityTier = Object.freeze({
  TIERS,
  tierForTransport,
  tierForRouteVia,
  compareTiers,
});

export default ReachabilityTier;
