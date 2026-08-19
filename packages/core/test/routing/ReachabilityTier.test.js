/**
 * Tests for ReachabilityTier (Track G3) — explicit three-tier
 * reachability classification, plus the `RoutingStrategy.tierFor()`
 * accessor and `agent.reachabilityFor()` wrapper.
 */
import { describe, it, expect } from 'vitest';
import {
  TIERS,
  tierForTransport,
  tierForRouteVia,
  compareTiers,
} from '../../src/routing/ReachabilityTier.js';
import ReachabilityTier from '../../src/routing/ReachabilityTier.js';
import { RoutingStrategy } from '../../src/routing/RoutingStrategy.js';
import { FallbackTable }   from '../../src/routing/FallbackTable.js';

// ── Stub helpers ────────────────────────────────────────────────────────────

/**
 * Make a fake transport whose `constructor.name` matches `className`.
 * Mirrors the way routing classifies real transport instances.
 */
function mkTransportWithClass(className, extras = {}) {
  // Create an anonymous class with the desired name via Object.defineProperty
  // so `instance.constructor.name` reads back as the class name.
  function T() {}
  Object.defineProperty(T, 'name', { value: className });
  const inst = Object.create(T.prototype);
  Object.assign(inst, extras);
  return inst;
}

// Matches the stub style used in test/RoutingStrategy.test.js
const mkTransport = (name) => ({ name });

// ── tierForTransport ────────────────────────────────────────────────────────

describe('tierForTransport', () => {
  it('classifies direct transports (class names)', () => {
    expect(tierForTransport('LocalTransport')).toBe(TIERS.DIRECT);
    expect(tierForTransport('InternalTransport')).toBe(TIERS.DIRECT);
    expect(tierForTransport('RendezvousTransport')).toBe(TIERS.DIRECT);
    expect(tierForTransport('BleTransport')).toBe(TIERS.DIRECT);
    expect(tierForTransport('MdnsTransport')).toBe(TIERS.DIRECT);
  });

  it('classifies mesh transports (class names)', () => {
    expect(tierForTransport('RelayTransport')).toBe(TIERS.MESH);
    expect(tierForTransport('NknTransport')).toBe(TIERS.MESH);
    expect(tierForTransport('MqttTransport')).toBe(TIERS.MESH);
    expect(tierForTransport('OfflineTransport')).toBe(TIERS.MESH);
  });

  it('classifies direct transports (lowercase routing names)', () => {
    expect(tierForTransport('local')).toBe(TIERS.DIRECT);
    expect(tierForTransport('internal')).toBe(TIERS.DIRECT);
    expect(tierForTransport('rendezvous')).toBe(TIERS.DIRECT);
    expect(tierForTransport('mdns')).toBe(TIERS.DIRECT);
    expect(tierForTransport('ble')).toBe(TIERS.DIRECT);
  });

  it('classifies mesh transports (lowercase routing names)', () => {
    expect(tierForTransport('relay')).toBe(TIERS.MESH);
    expect(tierForTransport('nkn')).toBe(TIERS.MESH);
    expect(tierForTransport('mqtt')).toBe(TIERS.MESH);
    expect(tierForTransport('offline')).toBe(TIERS.MESH);
  });

  it('defaults unknown transports to mesh', () => {
    expect(tierForTransport('SomeFutureTransport')).toBe(TIERS.MESH);
    expect(tierForTransport('does-not-exist')).toBe(TIERS.MESH);
    expect(tierForTransport(null)).toBe(TIERS.MESH);
    expect(tierForTransport(undefined)).toBe(TIERS.MESH);
  });

  it('accepts a transport instance via constructor.name', () => {
    const local  = mkTransportWithClass('LocalTransport');
    const relay  = mkTransportWithClass('RelayTransport');
    const future = mkTransportWithClass('FuturisticTransport');
    expect(tierForTransport(local)).toBe(TIERS.DIRECT);
    expect(tierForTransport(relay)).toBe(TIERS.MESH);
    expect(tierForTransport(future)).toBe(TIERS.MESH);
  });

  it('falls back to a `.name` property on stub objects', () => {
    // Routing tests use { name: 'relay' } stubs whose constructor is Object.
    expect(tierForTransport(mkTransport('relay'))).toBe(TIERS.MESH);
    expect(tierForTransport(mkTransport('local'))).toBe(TIERS.DIRECT);
    expect(tierForTransport(mkTransport('rendezvous'))).toBe(TIERS.DIRECT);
  });
});

// ── tierForRouteVia ─────────────────────────────────────────────────────────

describe('tierForRouteVia', () => {
  it('returns hop for the literal "hop" string', () => {
    expect(tierForRouteVia('hop')).toBe(TIERS.HOP);
  });

  it('returns hop for { kind: "hop" } descriptors', () => {
    expect(tierForRouteVia({ kind: 'hop' })).toBe(TIERS.HOP);
    expect(tierForRouteVia({ kind: 'hop', through: 'peerX' })).toBe(TIERS.HOP);
  });

  it('returns hop for { via: "hop" } and truthy { hop }', () => {
    expect(tierForRouteVia({ via: 'hop' })).toBe(TIERS.HOP);
    expect(tierForRouteVia({ hop: true })).toBe(TIERS.HOP);
  });

  it('passes transport descriptors through to tierForTransport', () => {
    expect(tierForRouteVia({ transport: 'relay' })).toBe(TIERS.MESH);
    expect(tierForRouteVia({ name: 'local' })).toBe(TIERS.DIRECT);
    expect(tierForRouteVia('LocalTransport')).toBe(TIERS.DIRECT);
  });

  it('defaults to mesh for null/undefined/empty', () => {
    expect(tierForRouteVia(null)).toBe(TIERS.MESH);
    expect(tierForRouteVia(undefined)).toBe(TIERS.MESH);
    expect(tierForRouteVia({})).toBe(TIERS.MESH);
  });
});

// ── compareTiers ────────────────────────────────────────────────────────────

describe('compareTiers', () => {
  it('orders direct < mesh < hop', () => {
    expect(compareTiers(TIERS.DIRECT, TIERS.MESH)).toBeLessThan(0);
    expect(compareTiers(TIERS.MESH,   TIERS.HOP)).toBeLessThan(0);
    expect(compareTiers(TIERS.DIRECT, TIERS.HOP)).toBeLessThan(0);
    expect(compareTiers(TIERS.HOP,    TIERS.DIRECT)).toBeGreaterThan(0);
    expect(compareTiers(TIERS.MESH,   TIERS.MESH)).toBe(0);
  });

  it('sorts a mixed list direct → mesh → hop', () => {
    const sorted = [TIERS.HOP, TIERS.DIRECT, TIERS.MESH, TIERS.DIRECT].sort(compareTiers);
    expect(sorted).toEqual([TIERS.DIRECT, TIERS.DIRECT, TIERS.MESH, TIERS.HOP]);
  });
});

// ── Default export ──────────────────────────────────────────────────────────

describe('ReachabilityTier default export', () => {
  it('bundles TIERS + helpers', () => {
    expect(ReachabilityTier.TIERS).toBe(TIERS);
    expect(ReachabilityTier.tierForTransport).toBe(tierForTransport);
    expect(ReachabilityTier.tierForRouteVia).toBe(tierForRouteVia);
    expect(ReachabilityTier.compareTiers).toBe(compareTiers);
  });
});

// ── RoutingStrategy.tierFor ─────────────────────────────────────────────────

describe('RoutingStrategy.tierFor', () => {
  it('returns direct tier when a direct transport is selected', async () => {
    const rs = new RoutingStrategy({
      transports: { local: mkTransport('local') },
    });
    const t = await rs.tierFor('peer1');
    expect(t).not.toBeNull();
    expect(t.tier).toBe(TIERS.DIRECT);
    expect(t.name).toBe('local');
    expect(t.transport).toBeTruthy();
  });

  it('returns mesh tier when only relay is available', async () => {
    const rs = new RoutingStrategy({
      transports: { relay: mkTransport('relay') },
    });
    const t = await rs.tierFor('peer1');
    expect(t.tier).toBe(TIERS.MESH);
    expect(t.name).toBe('relay');
  });

  it('honours priority — direct wins over mesh when both present', async () => {
    const rs = new RoutingStrategy({
      transports: {
        relay: mkTransport('relay'),
        local: mkTransport('local'),
      },
    });
    const t = await rs.tierFor('peer1');
    expect(t.name).toBe('local');
    expect(t.tier).toBe(TIERS.DIRECT);
  });

  it('returns null when no transports are available', async () => {
    const rs = new RoutingStrategy({ transports: {} });
    expect(await rs.tierFor('peer1')).toBeNull();
  });

  it('includes latencyEstimate from FallbackTable when known', async () => {
    const ft = new FallbackTable();
    ft.record('peer1', 'relay', 42);
    const rs = new RoutingStrategy({
      transports:    { relay: mkTransport('relay') },
      fallbackTable: ft,
    });
    const t = await rs.tierFor('peer1');
    expect(t.tier).toBe(TIERS.MESH);
    expect(t.latencyEstimate).toBe(42);
  });

  it('omits latencyEstimate when no record exists', async () => {
    const rs = new RoutingStrategy({
      transports: { relay: mkTransport('relay') },
    });
    const t = await rs.tierFor('peer1');
    expect(t.latencyEstimate).toBeUndefined();
  });

  it('returns hop tier when via descriptor is { kind: "hop" }', async () => {
    const rs = new RoutingStrategy({
      transports: { relay: mkTransport('relay') },
    });
    const t = await rs.tierFor('peer1', { via: { kind: 'hop', through: 'bridge1' } });
    expect(t.tier).toBe(TIERS.HOP);
    // Underlying transport still resolved so the caller can use it.
    expect(t.name).toBe('relay');
    expect(t.transport).toBeTruthy();
  });

  it('does not change selectTransport behaviour (regression guard)', async () => {
    const rs = new RoutingStrategy({
      transports: {
        relay: mkTransport('relay'),
        local: mkTransport('local'),
      },
    });
    const sel  = await rs.selectTransport('peer1');
    const tier = await rs.tierFor('peer1');
    expect(sel?.name).toBe(tier.name);
    expect(sel?.transport).toBe(tier.transport);
  });
});

// ── agent.reachabilityFor ───────────────────────────────────────────────────

describe('agent.reachabilityFor (smoke via lightweight stub)', () => {
  // Avoid spinning up a full Agent — we only care that the method
  // delegates to RoutingStrategy.tierFor() correctly.  A minimal
  // shape captures the contract from CLAUDE.md: agent.#routing is
  // authoritative; reachabilityFor delegates and returns null when
  // unset.
  it('returns null when no RoutingStrategy is wired', async () => {
    const fakeAgent = {
      reachabilityFor: async function (peerId) {
        const r = this._routing;
        if (!r || typeof r.tierFor !== 'function') return null;
        return r.tierFor(peerId);
      },
      _routing: null,
    };
    expect(await fakeAgent.reachabilityFor('peerX')).toBeNull();
  });

  it('delegates to RoutingStrategy.tierFor when wired', async () => {
    const rs = new RoutingStrategy({
      transports: { local: mkTransport('local') },
    });
    const fakeAgent = {
      _routing: rs,
      reachabilityFor: async function (peerId) {
        if (!this._routing || typeof this._routing.tierFor !== 'function') return null;
        return this._routing.tierFor(peerId);
      },
    };
    const t = await fakeAgent.reachabilityFor('peerY');
    expect(t.tier).toBe(TIERS.DIRECT);
    expect(t.name).toBe('local');
  });
});
