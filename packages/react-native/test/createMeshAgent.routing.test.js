/**
 * createMeshAgent — Group EE routing tests.
 *
 * Exercises the RoutingStrategy wiring that replaced the inline
 * selectTransport closure: each transport exposes canReach(peerId) and
 * RoutingStrategy skips transports whose canReach returns false, so a
 * dead relay / stale mDNS / BLE-without-the-peer won't cascade into the
 * `Cannot read property 'send' of null` symptom seen on two phones
 * 2026-04-24.
 *
 * Mocks mirror the real canReach contracts:
 *   • BleTransport.canReach(pk) = _hasPeer(pk) OR pk looks like a BLE MAC
 *   • MdnsTransport.canReach(pk) = _hasPeer(pk) (the socket is the truth; `fresh` here models a
 *     transport that additionally demotes itself, which the real one no longer does)
 *   • RelayTransport.canReach(_) = this.connected (WS open)
 *   • OfflineTransport.canReach(_) = false (fallback only)
 *
 * See CODING-PLAN.md § Group EE for the full wiring rationale.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Same mock harness as createMeshAgent.test.js ─────────────────────────────

vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 33 },
  PermissionsAndroid: {
    PERMISSIONS: {
      ACCESS_FINE_LOCATION: 'loc', BLUETOOTH_SCAN: 'scan',
      BLUETOOTH_ADVERTISE: 'adv',  BLUETOOTH_CONNECT: 'conn',
    },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    request:         vi.fn(async () => 'granted'),
    requestMultiple: vi.fn(async (perms) => Object.fromEntries(perms.map(p => [p, 'granted']))),
  },
  NativeModules:     { MdnsModule: {}, BlePeripheral: {} },
  NativeEventEmitter: class { addListener() { return { remove() {} }; } },
}));

const kcStore = new Map();
vi.mock('react-native-keychain', () => ({
  getInternetCredentials: vi.fn(async (k) => {
    const v = kcStore.get(k);
    return v ? { password: v } : false;
  }),
  setInternetCredentials: vi.fn(async (k, _u, v) => { kcStore.set(k, v); }),
  resetInternetCredentials: vi.fn(async (k) => { kcStore.delete(k); }),
}));

const asStore = new Map();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem:    vi.fn(async (k) => asStore.get(k) ?? null),
    setItem:    vi.fn(async (k, v) => { asStore.set(k, v); }),
    removeItem: vi.fn(async (k) => { asStore.delete(k); }),
    getAllKeys: vi.fn(async () => [...asStore.keys()]),
  },
}));

vi.mock('react-native-ble-plx', () => ({
  State: { PoweredOn: 'PoweredOn' },
  BleManager: class {
    state()           { return Promise.resolve('PoweredOn'); }
    onStateChange(cb) { cb('PoweredOn'); return { remove() {} }; }
    startDeviceScan() {}
    stopDeviceScan()  {}
    destroy()         {}
  },
}));

const mdnsState = { available: true, connectImpl: async () => {}, peers: new Set(), fresh: true };
vi.mock('../src/transport/MdnsTransport.js', () => {
  class MdnsTransport {
    static isAvailable() { return mdnsState.available; }
    constructor(opts) { this.identity = opts.identity; this.address = opts.identity.pubKey; }
    connect()          { return mdnsState.connectImpl(); }
    disconnect()       { return Promise.resolve(); }
    on()               {} off() {}
    _hasPeer(pk)       { return mdnsState.peers.has(pk); }
    lastActivityAt(pk) { return this._hasPeer(pk) && mdnsState.fresh ? Date.now() : 0; }
    canReach(pk)       { return this._hasPeer(pk) && mdnsState.fresh; }
    useSecurityLayer() {} setReceiveHandler() {} emit() {}
  }
  return { MdnsTransport };
});

const bleState = { peers: new Set() };
vi.mock('../src/transport/BleTransport.js', () => {
  class BleTransport {
    constructor(opts) { this.identity = opts.identity; this.address = opts.identity.pubKey; }
    connect()     { return Promise.resolve(); }
    disconnect()  { return Promise.resolve(); }
    on()          {} off() {}
    _hasPeer(pk)  { return bleState.peers.has(pk); }
    canReach(pk) {
      if (this._hasPeer(pk)) return true;
      if (typeof pk === 'string' && pk.includes(':')) return true;
      return false;
    }
    useSecurityLayer() {} setReceiveHandler() {} emit() {}
  }
  return { BleTransport, SERVICE_UUID: 'svc', CHARACTERISTIC_UUID: 'chr' };
});

vi.mock('../src/transport/rendezvousRtcLib.js', () => ({
  loadRendezvousRtcLib: vi.fn(async () => null),
}));

import { createMeshAgent } from '../src/createMeshAgent.js';

beforeEach(() => {
  kcStore.clear();
  asStore.clear();
  mdnsState.available   = true;
  mdnsState.connectImpl = async () => {};
  mdnsState.peers       = new Set();
  mdnsState.fresh       = true;
  bleState.peers        = new Set();
});

describe('createMeshAgent — Group EE routing', () => {

  it('picks mDNS when it is fresh and both mDNS and BLE know the peer', async () => {
    mdnsState.peers.add('PEER');
    bleState.peers.add('PEER');
    const agent = await createMeshAgent({});
    const t = await agent.transportFor('PEER');
    expect(t).toBe(agent.getTransport('mdns'));
    await agent.stop();
  });

  it('falls through to BLE when mDNS is stale but BLE has the peer', async () => {
    mdnsState.peers.add('PEER');
    mdnsState.fresh = false;                // mark mDNS connection idle
    bleState.peers.add('PEER');
    const agent = await createMeshAgent({});
    const t = await agent.transportFor('PEER');
    expect(t).toBe(agent.getTransport('ble'));
    await agent.stop();
  });

  it('falls through to offline when no transport can reach the peer', async () => {
    // Relay URL provided but the mock harness doesn't open a real socket,
    // so the RelayTransport's canReach (== this.connected) returns false.
    const agent = await createMeshAgent({ relayUrl: 'ws://127.0.0.1:9999' });
    const t = await agent.transportFor('UNKNOWN_PEER');
    expect(t.constructor.name).toBe('OfflineTransport');
    await agent.stop();
  });

  it('OfflineTransport _put throws a clean error for unreachable peers', async () => {
    const agent = await createMeshAgent({ relayUrl: 'ws://127.0.0.1:9999' });
    const t = await agent.transportFor('UNKNOWN_PEER');
    await expect(t._put('UNKNOWN_PEER', { hello: 'world' }))
      .rejects.toThrow(/offline/i);
    await agent.stop();
  });

  it('BLE MAC address routes to BleTransport even without a known peer', async () => {
    const agent = await createMeshAgent({});
    const t = await agent.transportFor('AA:BB:CC:DD:EE:FF');
    expect(t).toBe(agent.getTransport('ble'));
    await agent.stop();
  });

  it('FallbackTable.markDegraded makes RoutingStrategy skip that transport', async () => {
    mdnsState.peers.add('PEER');
    bleState.peers.add('PEER');
    const agent = await createMeshAgent({});

    // Both reachable — mDNS wins by priority.
    expect(await agent.transportFor('PEER')).toBe(agent.getTransport('mdns'));

    // Simulate an mDNS failure (e.g. RelayTransport send of null equivalent).
    agent.routing.onTransportFailure('PEER', 'mdns');

    // Next selection should skip mDNS for the 30 s window and pick BLE.
    expect(await agent.transportFor('PEER')).toBe(agent.getTransport('ble'));
    await agent.stop();
  });
});
