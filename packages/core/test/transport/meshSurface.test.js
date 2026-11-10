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

  it('the LAN key: asked before the transport lands, applied when it lands; null goes back to a rest key', async () => {
    class Lan extends Discovering {
      keys = [];
      lanAddress = 'rest-1';
      async useLanIdentity(identity) { this.keys.push(identity?.pubKey ?? null); this.lanAddress = identity?.pubKey ?? 'rest-2'; }
    }
    const s = createMeshSurface();
    expect(await s.setLanIdentity({ pubKey: 'room-1' }), 'no LAN transport yet').toBeNull();
    const mdns = new Lan({ address: 'a', identity: null });
    await s.setTransports({ mdns });
    expect(mdns.keys, 'the room key asked during boot is spoken once the transport lands').toEqual(['room-1']);
    expect(s.lanAddress()).toBe('room-1');
    expect(await s.setLanIdentity(null)).toBe('rest-2');
    expect(mdns.keys).toEqual(['room-1', null]);
  });

  it('the whisper: handed to a LAN transport now, and to one that lands later', async () => {
    class Lan extends Discovering { whisper = null; useWhisper(fn) { this.whisper = fn; } }
    const s = createMeshSurface();
    const secrets = async () => [];
    s.setLanWhisper(secrets);
    const mdns = new Lan({ address: 'a', identity: null });
    await s.setTransports({ mdns });
    expect(mdns.whisper).toBe(secrets);
    s.setLanWhisper(null);
    expect(mdns.whisper).toBeNull();
  });
});
