/**
 * Nearby step D — the session drives the surface, and nothing else does.
 *
 * The guarantee under test is rule (c): **the device announces itself if and only if the Nearby view is
 * open.** These tests drive the real `createProximitySession` against the real
 * `createDiscoverabilityControl` with fake transports, so a break in either half shows up here.
 */
import { describe, it, expect, vi } from 'vitest';
import { DISCOVERABILITY, createDiscoverabilityControl, Transport } from '@onderling/core';

import { createProximitySession }   from '../../src/v2/circleProximity.js';
import { makeNearbySessionAdapter } from '../../src/v2/nearbyDiscoverability.js';

class FakeDiscovering extends Transport {
  applied = [];
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(state) { this.applied.push(state); return state; }
  async _put() {}
}

/** mDNS as it actually is today: cannot browse without publishing. */
class FakeMdns extends Transport {
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(state) {
    return state === DISCOVERABILITY.OFF ? DISCOVERABILITY.OFF : DISCOVERABILITY.PUBLISH;
  }
  async _put() {}
}

const mk = (Cls) => new Cls({ address: 'a', identity: null });
/** The adapter reports asynchronously by design; let its promise settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function wire({ transports, restingState, onDegraded } = {}) {
  const control = createDiscoverabilityControl({ transports: () => transports });
  const adapter = makeNearbySessionAdapter({ control, restingState, onDegraded });
  const session = createProximitySession({
    startAdvertising: adapter.startAdvertising,
    stopAdvertising:  adapter.stopAdvertising,
  });
  return { control, adapter, session };
}

describe('opening Nearby is the only thing that publishes', () => {
  it('closed ⇒ not publishing; open ⇒ publishing; closed again ⇒ not publishing', async () => {
    const ble = mk(FakeDiscovering);
    const { control, session } = wire({ transports: { ble } });

    expect(control.isPublishing).toBe(false);

    session.open();
    await settle();
    expect(control.isPublishing).toBe(true);
    expect(session.isAdvertising()).toBe(true);

    session.close();
    await settle();
    expect(control.isPublishing).toBe(false);
    expect(session.isAdvertising()).toBe(false);
  });

  it('rests at BROWSE, not off — so the LAN data channel survives closing the view', async () => {
    const ble = mk(FakeDiscovering);
    const { session } = wire({ transports: { ble } });
    session.open();
    await settle();
    session.close();
    await settle();
    expect(ble.applied).toEqual(['browse+publish', 'browse']);
  });

  it('a caller can rest at OFF when it does not need the channel', async () => {
    const ble = mk(FakeDiscovering);
    const { session } = wire({ transports: { ble }, restingState: DISCOVERABILITY.OFF });
    session.open();
    await settle();
    session.close();
    await settle();
    expect(ble.applied).toEqual(['browse+publish', 'off']);
  });

  it('a double open does not announce twice', async () => {
    const ble = mk(FakeDiscovering);
    const { session } = wire({ transports: { ble } });
    session.open();
    session.open();
    await settle();
    expect(ble.applied).toEqual(['browse+publish']);
  });

  it('close without open never publishes', async () => {
    const ble = mk(FakeDiscovering);
    const { control, session } = wire({ transports: { ble } });
    session.close();
    await settle();
    expect(control.isPublishing).toBe(false);
  });
});

describe('honesty when the transport cannot comply', () => {
  it('mDNS resting at browse is REPORTED as still publishing, not silently accepted', async () => {
    const onDegraded = vi.fn();
    const { control, adapter, session } = wire({ transports: { mdns: mk(FakeMdns) }, onDegraded });

    session.open();
    await settle();
    session.close();
    await settle();

    // The session believes it stopped advertising — and it did stop ASKING to.
    expect(session.isAdvertising()).toBe(false);
    // But the device is still announcing itself, and the surface says so rather than agreeing.
    expect(control.isPublishing).toBe(true);
    expect(adapter.lastReport()).toMatchObject({ requested: 'browse', effective: 'browse+publish', degraded: true });
    expect(onDegraded).toHaveBeenCalled();
  });

  it('a control that throws synchronously still lets the view open', async () => {
    const onError = vi.fn();
    const control = { set() { throw new Error('no radio'); }, report: () => null };
    const adapter = makeNearbySessionAdapter({ control, onError });
    const session = createProximitySession({
      startAdvertising: adapter.startAdvertising,
      stopAdvertising:  adapter.stopAdvertising,
    });
    session.open();
    await settle();
    expect(session.isOpen()).toBe(true);            // seeing the room without announcing is usable
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'start');
  });

  it('a rejected apply is reported, not swallowed', async () => {
    const onError = vi.fn();
    const control = { set: () => Promise.reject(new Error('radio off')), report: () => null };
    const adapter = makeNearbySessionAdapter({ control, onError });
    adapter.startAdvertising();
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'start');
  });

  it('a throwing onDegraded listener cannot break the session', async () => {
    const { session } = wire({
      transports: { mdns: mk(FakeMdns) },
      onDegraded: () => { throw new Error('bad listener'); },
    });
    session.open();
    await settle();
    expect(session.isOpen()).toBe(true);
  });

  it('no control at all is a no-op, not a crash (web, where nothing discovers)', async () => {
    const adapter = makeNearbySessionAdapter({});
    expect(() => adapter.startAdvertising()).not.toThrow();
    expect(() => adapter.stopAdvertising()).not.toThrow();
    expect(adapter.lastReport()).toBeNull();
  });
});
