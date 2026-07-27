/**
 * createMeshAgent — opinionated factory for a mesh-capable Agent on React Native.
 *
 * One call bundles:
 *   • Permissions request (BLE + location on Android, iOS short-circuit)
 *   • Identity restore-or-generate via KeychainVault (default service: 'mesh')
 *   • BLE, mDNS, Relay transports wired as secondaries; OfflineTransport as
 *     safe primary fallback so the agent always reaches `ready`
 *   • Routing strategy that prefers BLE → mDNS → relay, and falls back to
 *     OfflineTransport (clean error) for unreachable peers
 *   • PeerGraph backed by AsyncStorageAdapter (persisted across restarts)
 *   • AgentConfig with `policy.allowRelayFor = 'authenticated'`
 *   • Automatic `agent.on('peer')` upsert keeping PeerGraph in sync with
 *     inbound hellos (hops:0 + via:null, so stale indirect records don't
 *     override direct ones)
 *
 * What the factory deliberately does NOT do:
 *   • Register application skills (receive-message, etc.) — that's the app's
 *     domain. Call agent.register(...) after the factory returns.
 *   • Install peer-discovered handlers — opt in via `agent.enableAutoHello()`
 *     (Group R). Apps that want selective hello can still listen by hand.
 *   • Enable the relay-forward skill — opt in via `agent.enableRelayForward()`.
 *   • Start the discovery loops — opt in via `agent.startDiscovery()`.
 *
 * See EXTRACTION-PLAN.md §7 Group Q + §2 for full rationale.
 */
import {
  Agent,
  AgentConfig,
  AgentIdentity,
  OfflineTransport,
  PeerGraph,
  RoutingStrategy,
  FallbackTable,
} from '@onderling/core';
import { RendezvousTransport } from '@onderling/transports';

import { KeychainVault }         from './identity/KeychainVault.js';
import { attachIdentityToAgent } from './identity/IdentityWiring.js';
import { AsyncStorageAdapter }   from './storage/AsyncStorageAdapter.js';
import { buildMeshTransports }   from './buildMeshTransports.js';
import { loadRendezvousRtcLib }  from './transport/rendezvousRtcLib.js';

/**
 * @param {object}  [opts]
 * @param {string}  [opts.label]              — display label on the agent
 * @param {string}  [opts.relayUrl]           — ws:// or wss:// URL of a relay server
 * @param {object}  [opts.vault]              — custom Vault; defaults to KeychainVault({ service: 'mesh' })
 * @param {object}  [opts.transports]         — { ble, mdns, relay } booleans, all default true
 * @param {string}  [opts.peerGraphPrefix]    — AsyncStorage key prefix (default 'mesh:peers:')
 * @param {number}  [opts.mdnsTimeoutMs]      — how long to wait for mDNS pre-connect (default 6000)
 * @param {object}  [opts.configOverrides]    — merged into AgentConfig overrides
 * @param {boolean} [opts.rendezvous]         — opt in to WebRTC rendezvous upgrade (Group AA).
 *                                              Requires relay + react-native-webrtc native module.
 *                                              Silently skips with a warning if the module is not
 *                                              available (e.g. when running in Expo Go).
 * @param {object}  [opts.pod]                 — opt in to identity-as-pod-content sync (Track B).
 *                                              When present, builds Bootstrap + IdentityPodStore +
 *                                              IdentitySync and attaches them; absent = today's
 *                                              local-only Vault behavior is preserved unchanged
 *                                              (Q-B.2 side-by-side migration, locked 2026-04-29).
 *                                              Shape: `{ webid, mnemonic, podClient, podRoot,
 *                                              intervalMs?, bootstrap? }`.  See
 *                                              `attachIdentityToAgent` for full opt docs.
 * @param {string} [opts.discoverability]     — initial discovery state, one of `DISCOVERABILITY`
 *                                              ('off' | 'browse' | 'browse+publish'). The returned agent
 *                                              carries `agent.discoverability` — the ONE control an app may
 *                                              use to change it (never a transport directly).
 * @returns {Promise<import('@onderling/core').Agent>}
 */
export async function createMeshAgent(opts = {}) {
  const {
    label,
    relayUrl,
    vault,
    transports:       transportEnabled = {},
    peerGraphPrefix   = 'mesh:peers:',
    mdnsTimeoutMs     = 6_000,
    autoStart         = true,
    configOverrides,
    rendezvous:       enableRdv = false,
    discoverability,
    pod:              podOpt,
  } = opts;

  // ── Identity ───────────────────────────────────────────────────────────────
  const resolvedVault = vault ?? new KeychainVault({ service: 'mesh' });
  let identity;
  try {
    identity = await AgentIdentity.restore(resolvedVault);
  } catch {
    identity = await AgentIdentity.generate(resolvedVault);
  }

  // ── Transports (shared builder — T5.2d/T5.3c) ──────────────────────────────
  // buildMeshTransports owns permissions + construct + time-boxed mDNS
  // pre-connect, so this logic lives ONCE: the secure-mesh injection path in
  // basis-mobile reuses the SAME builder (then injects via
  // sa.addSecureTransport instead of registering on a bare agent). It returns
  // the live ones; each is `null` when its native module is absent or the
  // mDNS pre-connect timed out.
  const { mdns, ble, relay, discoverability: discoverabilityControl, nearbyPeers } = await buildMeshTransports({
    identity,
    enable:         transportEnabled,
    relayUrl,
    mdnsTimeoutMs,
    hostnamePrefix: 'dw',
    ...(discoverability ? { discoverability } : {}),
  });

  // ── PeerGraph (persisted) ──────────────────────────────────────────────────
  const peers = new PeerGraph({
    storageBackend: new AsyncStorageAdapter({ prefix: peerGraphPrefix }),
  });

  // ── Config ─────────────────────────────────────────────────────────────────
  const config = new AgentConfig({
    overrides: {
      discovery: { discoverable: true, acceptHelloFromTier0: true },
      policy:    { allowRelayFor: 'authenticated' },
      ...(configOverrides ?? {}),
    },
  });

  // ── Primary + routing ──────────────────────────────────────────────────────
  const offline = new OfflineTransport({ identity });
  // Use offline as primary so Agent.transportFor falls back to a
  // clean-error transport when RoutingStrategy returns null (no transport
  // can currently reach the peer).  Direct transports are registered as
  // secondaries below — RoutingStrategy picks among them based on
  // per-transport canReach() hints + FallbackTable health.
  const primary = offline;

  // RoutingStrategy (Group EE).  Replaces the prior inline selectTransport
  // closure with a learning router:
  //   • Each transport exposes canReach(peerId) — mDNS is fresh-aware,
  //     BLE checks the central/peripheral maps, relay checks WS state,
  //     offline always returns false.  RoutingStrategy skips transports
  //     whose canReach returns false.
  //   • On successful RS receipt, fallbackTable.record(peer, transport,
  //     latencyMs) is called so future sends prefer the fastest live
  //     transport per-peer.
  //   • On send failure, routing.onTransportFailure(peer, transport) marks
  //     that (peer, transport) pair degraded for 30 s.
  // Semantically this preserves the old ordering (fresh mDNS > BLE > stale
  // mDNS > relay > offline) via TRANSPORT_PRIORITY + canReach, while also
  // fixing the dead-relay cascade (relay.canReach == ws.connected).
  const fallbackTable = new FallbackTable();
  const routing = new RoutingStrategy({
    transports: new Map(),   // filled in by Agent.addTransport via routing.addTransport
    peerGraph:  peers,
    fallbackTable,
  });

  // ── Agent ──────────────────────────────────────────────────────────────────
  const agent = new Agent({
    identity,
    transport: primary,
    peers,
    config,
    routing,
    label:     label ?? null,
  });

  // Register every available transport so RoutingStrategy can pick among
  // them.  The 'default' slot in Agent.#transports is the offline primary
  // (clean-error fallback); these named slots are the real candidates.
  // The name strings MUST match RoutingStrategy's TRANSPORT_PRIORITY
  // (`'mdns', 'ble', 'relay'`) so the default ordering applies.
  if (mdns)  agent.addTransport('mdns',  mdns);
  if (ble)   agent.addTransport('ble',   ble);
  if (relay) agent.addTransport('relay', relay);

  // ── Rendezvous (Group AA) — optional WebRTC upgrade ───────────────────────
  // Needs (a) the relay as a signalling transport and (b) the
  // react-native-webrtc native module.  Both are optional: if either is
  // missing, the agent keeps working over the existing transports, and we
  // surface a warning instead of throwing.  `auto: true` makes the agent
  // upgrade a peer's path as soon as the hello handshake confirms the
  // peer advertises the `rendezvous` capability flag (Group AA3).
  if (enableRdv) {
    if (!relay) {
      console.warn('[createMeshAgent] rendezvous requested but no relay is configured — skipping');
    } else {
      const rtcLib = await loadRendezvousRtcLib();
      if (!rtcLib) {
        console.warn('[createMeshAgent] rendezvous requested but react-native-webrtc is not available — skipping');
      } else {
        agent.enableRendezvous({
          signalingTransport: relay,
          rtcLib,
          auto: true,
          makeTransport: (o) => new RendezvousTransport(o),
        });
      }
    }
  }

  // ── Keep PeerGraph in sync with inbound hellos ─────────────────────────────
  // An inbound HI means we now have a DIRECT path to this peer. Explicitly
  // upgrade hops:0/via:null so a stale indirect record doesn't survive the
  // spread-merge in PeerGraph.upsert and send us bridging through the wrong
  // peer. (Bug hunted down in session 2026-04-20; see EXTRACTION-PLAN.md §5.)
  agent.on('peer', ({ address, pubKey, label: peerLabel, ack }) => {
    if (!pubKey) return;
    peers.upsert({
      type:          'native',
      pubKey,
      label:         peerLabel ?? null,
      reachable:     true,
      hops:          0,
      via:           null,
      lastSeen:      Date.now(),
      discoveredVia: ack ? 'hello-ack' : 'hello-inbound',
      transports:    { default: { address, lastSeen: Date.now() } },
    }).catch(() => {});
  });

  // ── Also upgrade on bare peer-discovered (no hello yet) ─────────────────
  // When BLE / mDNS / relay sees a peer's pubKey directly (rather than a
  // MAC address), that's proof of a direct path *regardless* of whether
  // hello has completed yet.  If the PeerGraph had this peer cached as
  // hops:1 from an earlier gossip, callWithHop would stubbornly skip the
  // direct attempt and try to bridge over the relay — which then fails
  // when Wi-Fi is off.  Upsert hops:0 as soon as we see the pubkey
  // directly, so subsequent sends route via the actual direct transport.
  //
  // We bind per-transport to preserve the `discoveredVia` provenance
  // (useful for diagnostics) and skip MAC addresses (they'll be
  // rewritten to pubKey once the first envelope decodes).
  const bindPeerDiscovered = (name, transport) => {
    if (!transport) return;
    transport.on('peer-discovered', (peerAddress) => {
      if (!peerAddress || typeof peerAddress !== 'string') return;
      if (peerAddress.includes(':')) return;   // BLE MAC — not a pubKey yet
      if (peerAddress === identity.pubKey) return;
      peers.upsert({
        type:          'native',
        pubKey:        peerAddress,
        reachable:     true,
        hops:          0,
        via:           null,
        lastSeen:      Date.now(),
        discoveredVia: `${name}-peer-discovered`,
      }).catch(() => {});
    });
  };
  bindPeerDiscovered('relay', relay);
  bindPeerDiscovered('ble',   ble);
  bindPeerDiscovered('mdns',  mdns);

  // ── Identity-as-pod-content sync (Track B, opt-in via `pod`) ──────────────
  // Q-B.2 side-by-side migration: when `pod` is absent we behave EXACTLY as
  // before — local-only Vault is the source of truth.  When `pod` is
  // present, attachIdentityToAgent constructs Bootstrap + IdentityPodStore
  // + IdentitySync, materializes the pod manifest via init(), starts the
  // sync loop, and wires AppState foreground refresh.  We do this BEFORE
  // agent.start() so any inbound HI sees a populated identity store.
  // Teardown is wired to the agent's 'stop' event so dispose() runs as
  // part of agent.stop().
  if (podOpt) {
    const wiring = await attachIdentityToAgent({
      vault: resolvedVault,
      identity,
      pod: podOpt,
    });
    agent._identityWiring = wiring;
    agent.once('stop', () => {
      try { wiring.dispose(); } catch { /* swallow — non-fatal */ }
    });
  }

  // autoStart:false gives the caller a chance to register app-specific
  // skills (relay-forward, tunnel-open, receive-message, …) BEFORE any
  // inbound HI is processed.  Otherwise a hello arriving during the
  // microtask gap would make a capabilities snapshot with those skills
  // reporting as `false`, and that stale snapshot gets baked into the
  // peer's PeerGraph record on the other side.
  // The discoverability SURFACE. Attached to the agent because that is what an app holds — and the rule is
  // that an app goes through the surface, never the transport (`CLAUDE.md`). One control, all transports.
  agent.discoverability = discoverabilityControl;
  // The other half of the same surface: who is around, merged across transports.
  agent.nearbyPeers = nearbyPeers;

  if (autoStart) await agent.start();
  return agent;
}
