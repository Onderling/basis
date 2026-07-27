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
 * @param {string}  [opts.discoverability='browse+publish'] — the initial discovery state (Nearby step A).
 *   Both consumers get a `discoverability` CONTROL back, which is the one surface an app may use to change
 *   it later — never the transports directly (`CLAUDE.md`).
 * @returns {Promise<{ mdns, ble, relay, perms, discoverability, nearbyPeers }>}
 */
import { RelayTransport }                             from '@onderling/transports';
import { DISCOVERABILITY, createDiscoverabilityControl, createNearbyPeerSource } from '@onderling/core';

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

  let ble = null;
  if (enableBle && perms?.ble) {
    try {
      // The initial halves come from the requested state; the control below owns every change after that.
      ble = new BleTransport({
        identity,
        advertise: discoverability === DISCOVERABILITY.PUBLISH,
        scan:      discoverability !== DISCOVERABILITY.OFF,
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
  await control.set(discoverability);

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
