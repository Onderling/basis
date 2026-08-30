import { describe, it, expect } from 'vitest';
import { createMeshSurface, Transport, DISCOVERABILITY } from '../../src/index.js';

class Discovering extends Transport {
  applied = [];
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(state) { this.applied.push(state); return state; }
  async _put() {}
  connectedPeers() { return ['ada']; }
}
const mk = () => new Discovering({ address: 'a', identity: null });

describe('the mesh surface — one object from boot, filled in when the transports land', () => {
  it('starts empty, honours what a screen asked meanwhile, and seeds the peer list once transports land', async () => {
    const s = createMeshSurface();
    const seen = [];
    s.nearbyPeers.subscribe((rows) => seen.push(rows.map((r) => r.pubKey)));
    const early = await s.discoverability.set(DISCOVERABILITY.PUBLISH);      // the screen opened during boot
    expect(early).toMatchObject({ effective: 'off', shortfall: true });
    const mdns = mk();
    await s.setTransports({ mdns, ble: null });
    expect(s.transports()).toEqual({ mdns });                                // a null transport is not a transport
    expect(mdns.applied).toEqual(['browse+publish']);                        // re-applied, not forgotten
    expect(s.discoverability.isPublishing).toBe(true);
    expect(seen.at(-1)).toEqual(['ada']);                                    // seeded from the live socket
  });

  it('with nothing asked, landing only reads the transports', async () => {
    const s = createMeshSurface();
    const mdns = mk();
    await mdns.setDiscoverability(DISCOVERABILITY.BROWSE);
    await s.setTransports({ mdns });
    expect(mdns.applied).toEqual(['browse']);
    expect(s.discoverability.state).toBe('browse');
  });
});
