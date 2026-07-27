/**
 * MdnsTransport — the native split (Nearby step B).
 *
 * `MdnsModule.start()` registered the service AND began browsing in one call, so there was no way to watch
 * the network without joining it. The split adds `startAdvertising`/`stopAdvertising`/`startDiscovery`/
 * `stopDiscovery`, and these tests pin what that buys:
 *
 *   1. ghost mode actually browses without announcing;
 *   2. going unlisted does NOT tear down the data plane — the reason `browse` can be a resting state;
 *   3. an OLD native build still works, and says so rather than pretending to be invisible;
 *   4. the connection tiebreaker stops deferring when nobody can see us.
 *
 * The sibling file `MdnsTransport.test.js` mocks a native module WITHOUT the split, so the legacy path
 * stays covered there by construction.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const listeners = new Map();
  const native = {
    start:           vi.fn(async () => 1234),
    stop:            vi.fn(async () => {}),
    connect:         vi.fn(async () => 'conn-1'),
    send:            vi.fn(async () => {}),
    close:           vi.fn(async () => {}),
    startAdvertising: vi.fn(async () => 1234),
    stopAdvertising:  vi.fn(async () => {}),
    startDiscovery:   vi.fn(async () => {}),
    stopDiscovery:    vi.fn(async () => {}),
  };
  return { listeners, native };
});

vi.mock('react-native', () => ({
  NativeModules: { MdnsModule: h.native },
  NativeEventEmitter: class {
    addListener(event, fn) {
      if (!h.listeners.has(event)) h.listeners.set(event, new Set());
      h.listeners.get(event).add(fn);
      return { remove: () => h.listeners.get(event)?.delete(fn) };
    }
    removeAllListeners() { h.listeners.clear(); }
  },
}));

import { AgentIdentity, DISCOVERABILITY } from '@onderling/core';
import { VaultMemory }                    from '@onderling/vault';
import { MdnsTransport }                  from '../src/transport/MdnsTransport.js';

const fire  = (event, payload) => { for (const fn of [...(h.listeners.get(event) ?? [])]) fn(payload); };
const flush = () => new Promise((r) => setTimeout(r, 0));

let identity;
beforeEach(async () => {
  vi.clearAllMocks();
  h.listeners.clear();
  identity = await AgentIdentity.generate(new VaultMemory());
});

const mk = () => new MdnsTransport({ identity, hostname: 'dw-test' });

describe('the split is used when the native module has it', () => {
  it('detects the split', () => {
    expect(MdnsTransport.supportsSplit()).toBe(true);
  });

  it('GHOST MODE: browse starts discovery and does NOT advertise', async () => {
    const t = mk();
    const r = await t.setDiscoverability(DISCOVERABILITY.BROWSE);

    expect(r).toMatchObject({ ok: true, effective: 'browse', degraded: false });
    expect(h.native.startDiscovery).toHaveBeenCalledTimes(1);
    expect(h.native.startAdvertising).not.toHaveBeenCalled();
    expect(h.native.start).not.toHaveBeenCalled();   // never the combined call
    expect(t.isAdvertising).toBe(false);
  });

  it('browse+publish does both', async () => {
    const t = mk();
    const r = await t.setDiscoverability(DISCOVERABILITY.PUBLISH);

    expect(r.effective).toBe('browse+publish');
    expect(h.native.startDiscovery).toHaveBeenCalled();
    expect(h.native.startAdvertising).toHaveBeenCalledWith('_canopy', 'dw-test', identity.pubKey);
    expect(t.isAdvertising).toBe(true);
  });

  it('THE POINT: going unlisted keeps the data plane — no stop(), no stopDiscovery()', async () => {
    // This is what makes `browse` a usable resting state. Before the split the only way to stop announcing
    // was to stop the transport, which dropped every LAN peer you were mid-conversation with.
    const t = mk();
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    h.native.startDiscovery.mockClear();

    const r = await t.setDiscoverability(DISCOVERABILITY.BROWSE);

    expect(r.effective).toBe('browse');
    expect(h.native.stopAdvertising).toHaveBeenCalledTimes(1);
    expect(h.native.stopDiscovery).not.toHaveBeenCalled();
    expect(h.native.stop).not.toHaveBeenCalled();     // ← connections survive
    expect(t.isAdvertising).toBe(false);
  });

  it('off stops everything', async () => {
    const t = mk();
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    const r = await t.setDiscoverability(DISCOVERABILITY.OFF);
    expect(r.effective).toBe('off');
    expect(h.native.stop).toHaveBeenCalled();
  });

  it('re-announcing does not tear down the data plane either', async () => {
    const t = mk();
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    h.native.startAdvertising.mockClear();

    const r = await t.reannounce();

    expect(r).toMatchObject({ ok: true, effective: 'browse+publish' });
    expect(h.native.startAdvertising).toHaveBeenCalledTimes(1);   // re-published…
    expect(h.native.stop).not.toHaveBeenCalled();                 // …without dropping connections
  });
});

describe('an OLD native build without the split', () => {
  it('says it is advertising rather than pretending to be invisible', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = { a: h.native.startAdvertising, d: h.native.startDiscovery };
    delete h.native.startAdvertising;
    delete h.native.startDiscovery;
    try {
      expect(MdnsTransport.supportsSplit()).toBe(false);
      const t = mk();
      const r = await t.setDiscoverability(DISCOVERABILITY.BROWSE);

      // The honest answer: asked for browse, actually publishing.
      expect(r).toMatchObject({ requested: 'browse', effective: 'browse+publish', degraded: true });
      expect(h.native.start).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('advertising ANYWAY'));
    } finally {
      h.native.startAdvertising = saved.a;
      h.native.startDiscovery   = saved.d;
      warn.mockRestore();
    }
  });
});

describe('the connection tiebreaker knows about ghost mode', () => {
  /** A peer key that sorts ABOVE ours — so the tiebreaker would normally make us the responder. */
  const higherPeer = (t) => `${t.address}z`;

  it('while ADVERTISING, the higher-key side waits for the inbound connection', async () => {
    const t = mk();
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    // We sort below `higherPeer`, so make the peer sort below US to hit the responder branch.
    const lower = t.address.slice(0, -1);

    fire('MdnsServiceDiscovered', { host: '10.0.0.5', port: 1234, pubKey: lower });
    await flush();

    expect(h.native.connect).not.toHaveBeenCalled();
  });

  it('in GHOST MODE it always initiates — nobody can call us back', async () => {
    // The bug this prevents: unlisted + higher key = waiting for a connection that can never arrive,
    // so ghost mode would list the room and connect to only the half of it that sorts above us.
    const t = mk();
    await t.setDiscoverability(DISCOVERABILITY.BROWSE);
    const lower = t.address.slice(0, -1);   // would be the responder branch while advertising

    fire('MdnsServiceDiscovered', { host: '10.0.0.5', port: 1234, pubKey: lower });
    await flush();

    expect(h.native.connect).toHaveBeenCalledWith('10.0.0.5', 1234);
  });

  it('still initiates to a higher-sorting peer while advertising (unchanged behaviour)', async () => {
    const t = mk();
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);

    fire('MdnsServiceDiscovered', { host: '10.0.0.6', port: 1234, pubKey: higherPeer(t) });
    await flush();

    expect(h.native.connect).toHaveBeenCalledWith('10.0.0.6', 1234);
  });

  it('never connects to itself', async () => {
    const t = mk();
    await t.setDiscoverability(DISCOVERABILITY.BROWSE);
    fire('MdnsServiceDiscovered', { host: '10.0.0.7', port: 1234, pubKey: t.address });
    await flush();
    expect(h.native.connect).not.toHaveBeenCalled();
  });
});
