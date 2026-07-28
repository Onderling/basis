/**
 * buildMeshTransports — the shared RN mesh transport BUILDER (T5.2d / T5.3c).
 *
 * One place that constructs the native React Native transports (mDNS, BLE, relay)
 * for a given identity, so the building logic lives ONCE. Two consumers compose it:
 *
 *   • `createMeshAgent` (SDK factory) — builds them, then registers on a bare
 *     core Agent's router (its historical, all-in-one path).
 *   • The secure-mesh INJECTION path (basis-mobile via `realAgent`) — builds
 *     them here, then hands each to `sa.addSecureTransport(name, tx)` so they are
 *     security-wrapped + registered on the unified router.
 *
 * This file does NOT touch the agent, the PeerGraph, or the peer-graph-sync-on-hello
 * glue — those differ per consumer (where the PeerGraph lives is app-specific) and
 * stay with the caller. It only does: permissions → construct → time-boxed mDNS
 * pre-connect → return the live ones. A transport whose native module is absent
 * (vitest/iOS/Expo Go) or whose pre-connect times out (Wi-Fi off) comes back `null`,
 * never throwing — boot stays fast and best-effort.
 *
 * @param {object}  opts
 * @param {object}  opts.identity               — AgentIdentity (needs `.pubKey`)
 * @param {object}  [opts.enable]               — { ble, mdns, relay } booleans, all default true
 * @param {string}  [opts.relayUrl]             — ws://|wss:// relay URL (relay built only when set)
 * @param {number}  [opts.mdnsTimeoutMs=6000]   — mDNS pre-connect timeout
 * @param {string}  [opts.hostnamePrefix='dw']  — mDNS hostname prefix (`<prefix>-<pubKey[0..8]>`)
 * @param {object}  [opts.permissions]          — pre-fetched perms (skips a second prompt); else requested here
 * @param {string}  [opts.bleDiscoverability='browse'] — BLE's OWN initial state, defaulting TIGHTER than
 *   the rest (Nearby step J / R1+R2). mDNS is confined to a LAN; BLE advertising has no boundary, so it
 *   must be asked for rather than inherited.
 * @param {string}  [opts.discoverability='browse+publish'] — the initial discovery state (Nearby step A).
 *   Both consumers get a `discoverability` CONTROL back, which is the one surface an app may use to change
 *   it later — never the transports directly (`CLAUDE.md`).
 * @returns {Promise<{ mdns, ble, relay, perms, discoverability, nearbyPeers }>}
 */
import { RelayTransport }                             from '@onderling/transports';
import {
  DISCOVERABILITY, DISCOVERABILITY_ORDER, createDiscoverabilityControl, createNearbyPeerSource,
} from '@onderling/core';

import { MdnsTransport }          from './transport/MdnsTransport.js';
import { BleTransport }           from './transport/BleTransport.js';
import { requestMeshPermissions } from './permissions.js';

export async function buildMeshTransports({
  identity,
  enable = {},
  relayUrl = null,
  mdnsTimeoutMs = 6_000,
  hostnamePrefix = 'dw',
  permissions,
  discoverability = DISCOVERABILITY.PUBLISH,
  bleDiscoverability = DISCOVERABILITY.BROWSE,
} = {}) {
  if (!identity?.pubKey) {
    throw new TypeError('buildMeshTransports: an identity with a pubKey is required');
  }

  const enableBle   = enable.ble   !== false;
  const enableMdns  = enable.mdns  !== false;
  const enableRelay = enable.relay !== false;

  // Permissions (BLE + location on Android; iOS short-circuits). Caller may
  // pass a pre-fetched perms object to avoid a double prompt.
  const perms = permissions ?? await requestMeshPermissions();

  // ── Construct (each wrapped — one failure doesn't abort the others) ─────────
  let mdns = null;
  if (enableMdns && MdnsTransport.isAvailable?.()) {
    try {
      mdns = new MdnsTransport({
        identity,
        hostname: `${hostnamePrefix}-${identity.pubKey.slice(0, 8)}`,
      });
    } catch (e) {
      _warn('MdnsTransport init failed:', e);
    }
  }

  // Hoisted: the initial per-transport apply below needs it, and BLE may fail to construct.
  const bleState = DISCOVERABILITY_ORDER.includes(bleDiscoverability)
    ? bleDiscoverability
    : DISCOVERABILITY.BROWSE;

  let ble = null;
  if (enableBle && perms?.ble) {
    try {
      // BLE gets its OWN state, and it defaults TIGHTER (Nearby step J).
      //
      // mDNS is confined to a LAN, so "publish" there means visible to people who already joined this
      // network. A BLE advertisement has no boundary: it reaches the flat upstairs, the pavement outside,
      // and any passive scanner in range — including people in no room at all. Inheriting the general
      // `discoverability` would mean a phone beacons from boot because a mesh demo wanted to be findable.
      //
      // So BLE advertises only when a caller asks for it by name. The surface can still raise it later —
      // this is the resting state, not a ceiling.
      ble = new BleTransport({
        identity,
        advertise: bleState === DISCOVERABILITY.PUBLISH,
        // …but never scan when the overall state is off: an off device does not listen either.
        scan:      bleState !== DISCOVERABILITY.OFF && discoverability !== DISCOVERABILITY.OFF,
      });
    } catch (e) {
      _warn('BleTransport init failed:', e);
    }
  }

  let relay = null;
  if (enableRelay && relayUrl) {
    try {
      relay = new RelayTransport({ relayUrl, identity });
    } catch (e) {
      _warn('RelayTransport init failed:', e);
    }
  }

  // Pre-connect mDNS so a dead interface (Wi-Fi off → the internal timeout
  // rejects) is dropped here rather than retried as a fatal primary later.
  if (mdns) {
    try {
      await _withTimeout(mdns.connect(), mdnsTimeoutMs, 'mDNS pre-connect');
    } catch (e) {
      _warn('mDNS disabled:', e);
      mdns = null;
    }
  }

  // ── The surface ────────────────────────────────────────────────────────────
  // Built here rather than in either consumer, because both need it and neither should be the one that
  // knows how to fan a state across transports. It re-reads `mdns`/`ble` on every call, so a transport that
  // was dropped above (Wi-Fi off) simply is not part of the answer.
  const control = createDiscoverabilityControl({
    transports: () => ({ mdns, ble }),
    onDegraded: (r) => _warn(
      `discoverability: asked for '${r.requested}', actually '${r.effective}' — ` +
      r.perTransport.filter((p) => p.degraded).map((p) => `${p.name}:${p.effective}`).join(', '),
      null,
    ),
  });

  // Reflect what construction already did, so `control.state` is truthful before anyone calls `set()`.
  // mDNS was pre-connected above (publishing); BLE's halves were passed to its constructor.
  //
  // Applied per transport, because BLE's resting state is deliberately tighter than the rest and a single
  // `control.set(discoverability)` would raise it straight back to publishing — undoing the whole point.
  // Optional-called: a transport that predates the discoverability port (or a test double) simply has no
  // such method, and must not break boot for it.
  try { await mdns?.setDiscoverability?.(discoverability); } catch (e) { _warn('mDNS discoverability:', e); }
  try { await ble?.setDiscoverability?.(bleState); }         catch (e) { _warn('BLE discoverability:', e); }
  control.refresh();

  // Who is around, merged across every discovering transport. Built here for the same reason the
  // discoverability control is: an app must not reach into one adapter to answer a question the surface
  // owns — that is how the Nearby screen ended up mDNS-only and blind to BLE.
  const nearbyPeers = createNearbyPeerSource({ transports: () => ({ mdns, ble }) });

  return { mdns, ble, relay, perms, discoverability: control, nearbyPeers };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _warn(msg, e) {
  if (typeof console !== 'undefined') console.warn(`[buildMeshTransports] ${msg}`, e?.message ?? e);
}

function _withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )),
  ]);
}
