/**
 * buildMeshTransports — the shared RN mesh transport builder (T5.2d/T5.3c).
 *
 * Mocks the native transport modules + permissions directly (same approach as
 * createMeshAgent.test.js) so this runs in Node. Asserts the builder's own
 * contract: enable flags, relay-only-when-url, graceful nulls when a native
 * module is absent / pre-connect times out / a ctor throws — never aborting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ── Mock MdnsTransport (+ isAvailable) ────────────────────────────────────────
const mdnsState = { available: true, connectImpl: async () => {} };
vi.mock('../src/transport/MdnsTransport.js', () => {
  class MdnsTransport {
    static isAvailable() { return mdnsState.available; }
    constructor(opts) {
      this.identity = opts.identity;
      this.hostname = opts.hostname;
      this.address  = opts.identity.pubKey;
    }
    connect() { return mdnsState.connectImpl(); }
  }
  return { MdnsTransport };
});

// ── Mock BleTransport ─────────────────────────────────────────────────────────
const bleState = { ctorThrows: false };
vi.mock('../src/transport/BleTransport.js', () => {
  class BleTransport {
    constructor(opts) {
      if (bleState.ctorThrows) throw new Error('ble ctor boom');
      this.identity  = opts.identity;
      this.advertise = opts.advertise;
      this.scan      = opts.scan;
    }
  }
  return { BleTransport, SERVICE_UUID: 'svc', CHARACTERISTIC_UUID: 'chr' };
});

// ── Mock permissions ──────────────────────────────────────────────────────────
const permState = { perms: { ble: true } };
vi.mock('../src/permissions.js', () => ({
  requestMeshPermissions: vi.fn(async () => permState.perms),
}));

import { buildMeshTransports } from '../src/buildMeshTransports.js';

const identity = { pubKey: 'PUBKEY_abcdef0123456789' };

beforeEach(() => {
  mdnsState.available   = true;
  mdnsState.connectImpl = async () => {};
  bleState.ctorThrows   = false;
  permState.perms       = { ble: true };
});

describe('buildMeshTransports', () => {
  it('builds mdns + ble + relay when all are available', async () => {
    const { mdns, ble, relay, perms } = await buildMeshTransports({
      identity, relayUrl: 'ws://relay.test',
    });
    expect(mdns).toBeTruthy();
    expect(mdns.hostname).toBe('dw-PUBKEY_a');          // `<prefix>-<pubKey[0..8]>`
    expect(ble).toBeTruthy();
    // CHANGED deliberately (Nearby step J, R1): BLE now SCANS but does not ADVERTISE by default. A BLE
    // advertisement has no network boundary, so it is opted into rather than inherited.
    expect(ble.scan).toBe(true);
    expect(ble.advertise).toBe(false);
    expect(relay).toBeTruthy();
    expect(perms.ble).toBe(true);
  });

  it('advertises over BLE only when asked for BY NAME', async () => {
    const { ble } = await buildMeshTransports({ identity, bleDiscoverability: 'browse+publish' });
    expect(ble.advertise).toBe(true);
    expect(ble.scan).toBe(true);
  });

  it('a general browse+publish does NOT raise BLE — that is the whole point', async () => {
    const { ble } = await buildMeshTransports({ identity, discoverability: 'browse+publish' });
    expect(ble.advertise).toBe(false);
  });

  it('an OFF overall state stops BLE listening too', async () => {
    const { ble } = await buildMeshTransports({ identity, discoverability: 'off' });
    expect(ble.scan).toBe(false);
    expect(ble.advertise).toBe(false);
  });

  it('honours a custom hostnamePrefix', async () => {
    const { mdns } = await buildMeshTransports({ identity, hostnamePrefix: 'cc' });
    expect(mdns.hostname).toBe('cc-PUBKEY_a');
  });

  it('enable flags skip individual transports', async () => {
    const { mdns, ble, relay } = await buildMeshTransports({
      identity, enable: { mdns: false, ble: false }, relayUrl: 'ws://relay.test',
    });
    expect(mdns).toBeNull();
    expect(ble).toBeNull();
    expect(relay).toBeTruthy();
  });

  it('builds no relay without a relayUrl', async () => {
    const { relay } = await buildMeshTransports({ identity });
    expect(relay).toBeNull();
  });

  it('returns mdns:null (no throw) when the native module is absent', async () => {
    mdnsState.available = false;
    const { mdns, ble } = await buildMeshTransports({ identity });
    expect(mdns).toBeNull();
    expect(ble).toBeTruthy();                            // others unaffected
  });

  it('drops mdns when the pre-connect times out (Wi-Fi off)', async () => {
    mdnsState.connectImpl = () => new Promise(() => {}); // never resolves
    const { mdns } = await buildMeshTransports({ identity, mdnsTimeoutMs: 40 });
    expect(mdns).toBeNull();
  });

  it('skips ble when permissions are denied', async () => {
    permState.perms = { ble: false };
    const { ble, mdns } = await buildMeshTransports({ identity });
    expect(ble).toBeNull();
    expect(mdns).toBeTruthy();
  });

  it('a throwing ble ctor never aborts the others', async () => {
    bleState.ctorThrows = true;
    const { ble, mdns } = await buildMeshTransports({ identity });
    expect(ble).toBeNull();
    expect(mdns).toBeTruthy();
  });

  it('requires an identity with a pubKey', async () => {
    await expect(buildMeshTransports({ identity: {} })).rejects.toThrow(/pubKey/);
  });
});

describe('BLE defaults TIGHTER than the rest (Nearby step J, R1+R2)', () => {
  // mDNS is confined to a LAN; a BLE advertisement has no boundary — it reaches the flat upstairs, the
  // pavement outside, and any passive scanner in range. Inheriting the general `discoverability` would
  // mean a phone beacons from boot because a mesh demo wanted to be findable.
  it('is documented as an explicit opt-in, not an inherited state', () => {
    const src = readFileSync(new URL('../src/buildMeshTransports.js', import.meta.url), 'utf8');
    expect(src).toMatch(/bleDiscoverability\s*=\s*DISCOVERABILITY\.BROWSE/);
    // advertise must be derived from BLE's OWN state, never from the general one.
    expect(src).toMatch(/advertise:\s*bleState === DISCOVERABILITY\.PUBLISH/);
    expect(src).not.toMatch(/advertise:\s*discoverability === DISCOVERABILITY\.PUBLISH/);
  });

  it('an OFF overall state still stops BLE scanning', () => {
    const src = readFileSync(new URL('../src/buildMeshTransports.js', import.meta.url), 'utf8');
    expect(src).toMatch(/discoverability !== DISCOVERABILITY\.OFF/);
  });
});

