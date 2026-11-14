/**
 * A NEARBY SCREEN THAT CANNOT DISCOVER ANYONE SAYS SO. The room's people come only from discovering transports (Wi-Fi
 * discovery, Bluetooth); a browser has neither, so on web the room is always empty. "Nobody nearby right now" would
 * suggest someone could turn up; the screen says instead that this device cannot find people nearby, and where to go.
 * Decided by the shared controller (no peer source = cannot discover), never by a shell.
 */
import { describe, it, expect } from 'vitest';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';
import { buildNearbyModel } from '../../src/v2/circleNearby.js';

const settle = () => new Promise((r) => setTimeout(r, 0));
const control = () => ({ set: (s) => ({ requested: s, effective: s }), report: () => null });

describe('a Nearby screen with no discovering transport', () => {
  it('the model says the device cannot discover (not "nobody nearby")', () => {
    expect(buildNearbyModel({ peers: [], t: (k) => k, canDiscover: false }).headerLabel).toBe('circle.nearbyScreen.header_cannot_discover');
    expect(buildNearbyModel({ peers: [], t: (k) => k }).headerLabel, 'a device that can discover still says nobody is here').toBe('circle.nearbyScreen.header_empty');
  });

  it('the controller decides it from the peer source: none handed in → cannot discover', async () => {
    const screen = createNearbyScreen({ control: control(), levelChosen: () => true, t: (k) => k });
    screen.open();
    await settle();
    expect(screen.model().headerLabel).toBe('circle.nearbyScreen.header_cannot_discover');
    screen.close();
    const withPeers = createNearbyScreen({ control: control(), levelChosen: () => true, t: (k) => k, subscribeToPeers: () => () => {} });
    withPeers.open();
    await settle();
    expect(withPeers.model().headerLabel).toBe('circle.nearbyScreen.header_empty');
    withPeers.close();
  });
});
