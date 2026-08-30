/**
 * The nearby-peer surface (Nearby step E, host wiring).
 *
 * This exists because the screen was reading `bundle.mdns.peers` — one adapter, chosen by the caller. What
 * needs pinning is the behaviour a single transport could never give:
 *
 *   1. peers from EVERY discovering transport, merged;
 *   2. the same person found twice is ONE row, not two;
 *   3. losing one radio does not make someone standing right there vanish;
 *   4. nothing accumulates while nobody is watching.
 */
import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '../../src/Emitter.js';
import { createNearbyPeerSource } from '../../src/index.js';

class FakeTransport extends Emitter {
  found(addr) { this.emit('peer-discovered', addr); }
  lost(addr)  { this.emit('peer-disconnected', addr); }
}

function build(names = ['mdns', 'ble']) {
  const transports = Object.fromEntries(names.map((n) => [n, new FakeTransport()]));
  let clock = 1_000;
  const src = createNearbyPeerSource({ transports: () => transports, now: () => (clock += 10) });
  return { src, ...transports, transports, tick: () => (clock += 100) };
}

describe('merging across transports', () => {
  it('sees peers from every discovering transport, not just one', () => {
    const { src, mdns, ble } = build();
    const seen = vi.fn();
    src.subscribe(seen);

    mdns.found('ada');
    ble.found('bea');

    expect(src.list().map((p) => p.pubKey).sort()).toEqual(['ada', 'bea']);
  });

  it('THE MERGE: one person on two radios is ONE row', () => {
    // Showing "Ada" twice because she has Wi-Fi and Bluetooth would report our plumbing as the room.
    const { src, mdns, ble } = build();
    src.subscribe(() => {});

    mdns.found('ada');
    ble.found('ada');

    expect(src.list()).toHaveLength(1);
    expect(src.list()[0].sources.sort()).toEqual(['ble', 'mdns']);
  });

  it('reports the FIRST source, so a row does not flicker as radios come and go', () => {
    const { src, mdns, ble } = build();
    src.subscribe(() => {});
    mdns.found('ada');
    ble.found('ada');
    expect(src.list()[0].source).toBe('mdns');
  });

  it('a second sighting refreshes lastSeen without duplicating', () => {
    const { src, mdns } = build();
    src.subscribe(() => {});
    mdns.found('ada');
    const first = src.list()[0].lastSeen;
    mdns.found('ada');
    const again = src.list()[0];
    expect(src.list()).toHaveLength(1);
    expect(again.lastSeen).toBeGreaterThan(first);
    expect(again.firstSeen).toBeLessThan(again.lastSeen);
  });
});

describe('losing a peer', () => {
  it('one radio dropping does NOT remove someone the other still sees', () => {
    // Wi-Fi blips; the person has not moved. Dropping the row would make them vanish from the screen.
    const { src, mdns, ble } = build();
    src.subscribe(() => {});
    mdns.found('ada');
    ble.found('ada');

    mdns.lost('ada');

    expect(src.list()).toHaveLength(1);
    expect(src.list()[0].sources).toEqual(['ble']);
  });

  it('gone from every transport ⇒ gone from the list', () => {
    const { src, mdns, ble } = build();
    src.subscribe(() => {});
    mdns.found('ada');
    ble.found('ada');
    mdns.lost('ada');
    ble.lost('ada');
    expect(src.list()).toEqual([]);
  });

  it('losing an unknown peer is a no-op', () => {
    const { src, mdns } = build();
    src.subscribe(() => {});
    expect(() => mdns.lost('nobody')).not.toThrow();
    expect(src.list()).toEqual([]);
  });

  it('forget() drops a peer outright', () => {
    const { src, mdns } = build();
    src.subscribe(() => {});
    mdns.found('ada');
    src.forget('ada');
    expect(src.list()).toEqual([]);
  });
});

describe('subscription lifecycle', () => {
  it('delivers the current list immediately on subscribe', () => {
    const { src, mdns } = build();
    src.subscribe(() => {});          // bind first so the sighting is recorded
    mdns.found('ada');

    const late = vi.fn();
    src.subscribe(late);
    expect(late).toHaveBeenCalledWith([expect.objectContaining({ pubKey: 'ada' })]);
  });

  it('NOTHING accumulates while nobody is watching', () => {
    // A closed Nearby screen must not be quietly collecting everyone who walked past.
    const { src, mdns } = build();
    const off = src.subscribe(() => {});
    mdns.found('ada');
    off();

    mdns.found('bea');
    expect(src.list()).toEqual([]);
  });

  it('re-subscribing rebinds and starts clean', () => {
    const { src, mdns } = build();
    const off = src.subscribe(() => {});
    mdns.found('ada');
    off();

    src.subscribe(() => {});
    expect(src.list()).toEqual([]);
    mdns.found('bea');
    expect(src.list().map((p) => p.pubKey)).toEqual(['bea']);
  });

  it('two subscribers both get updates, and unbinding waits for the last', () => {
    const { src, mdns } = build();
    const a = vi.fn(); const b = vi.fn();
    const offA = src.subscribe(a);
    src.subscribe(b);

    mdns.found('ada');
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    offA();
    mdns.found('bea');
    expect(src.list().map((p) => p.pubKey).sort()).toEqual(['ada', 'bea']);
  });

  it('a throwing watcher does not stop the others', () => {
    const { src, mdns } = build();
    const good = vi.fn();
    src.subscribe(() => { throw new Error('bad render'); });
    src.subscribe(good);
    good.mockClear();
    mdns.found('ada');
    expect(good).toHaveBeenCalled();
  });

  it('close() detaches and empties', () => {
    const { src, mdns } = build();
    src.subscribe(() => {});
    mdns.found('ada');
    src.close();
    expect(src.list()).toEqual([]);
    mdns.found('bea');
    expect(src.list()).toEqual([]);
  });

  it('a transport with no event surface is skipped, not fatal', () => {
    const src = createNearbyPeerSource({ transports: () => ({ relay: {}, dead: null }) });
    expect(() => src.subscribe(() => {})).not.toThrow();
    expect(src.list()).toEqual([]);
  });

  it('requires a transports FUNCTION, not a snapshot', () => {
    expect(() => createNearbyPeerSource({ transports: {} })).toThrow(TypeError);
  });
});

describe('a subscriber that arrives late (seed + rebind)', () => {
  class Connected extends FakeTransport {
    constructor(peers) { super(); this.peers = peers; }
    connectedPeers() { return this.peers; }
  }

  it('seeds from what the transport already holds — the handshake happened before anyone listened', () => {
    const transports = { mdns: new Connected(['ada']) };
    const src = createNearbyPeerSource({ transports: () => transports });
    const seen = vi.fn();
    src.subscribe(seen);
    expect(src.list().map((p) => p.pubKey)).toEqual(['ada']);
    expect(seen.mock.calls[0][0].map((p) => p.pubKey)).toEqual(['ada']);   // the first delivery already has her
  });

  it('rebind() picks up a transport that landed after the first subscriber bound', () => {
    const transports = {};
    const src = createNearbyPeerSource({ transports: () => transports });
    const seen = vi.fn();
    src.subscribe(seen);
    expect(src.list()).toEqual([]);

    const mdns = new Connected(['ada']);
    transports.mdns = mdns;
    src.rebind();
    expect(src.list().map((p) => p.pubKey)).toEqual(['ada']);
    mdns.found('bea');                                   // and it follows the late transport's events too
    expect(src.list().map((p) => p.pubKey).sort()).toEqual(['ada', 'bea']);
    mdns.lost('ada');
    expect(src.list().map((p) => p.pubKey)).toEqual(['bea']);
  });

  it('rebind() with nobody watching binds nothing (subscribe is what binds)', () => {
    const transports = { mdns: new Connected(['ada']) };
    const src = createNearbyPeerSource({ transports: () => transports });
    src.rebind();
    expect(src.list()).toEqual([]);
  });

  it('a transport whose connectedPeers() throws is treated as empty, not fatal', () => {
    const bad = new FakeTransport();
    bad.connectedPeers = () => { throw new Error('nope'); };
    const src = createNearbyPeerSource({ transports: () => ({ bad }) });
    expect(() => src.subscribe(() => {})).not.toThrow();
    bad.found('ada');
    expect(src.list().map((p) => p.pubKey)).toEqual(['ada']);
  });
});
