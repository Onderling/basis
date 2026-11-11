/**
 * Fitness — the Nearby room is BOUND on both shells.
 *
 * Found 2026-08-30 on the phone: every room module existed and the controller took them as dependencies,
 * but neither shell passed them, so asking, cards, chat and invites returned `no-channel`. This pins the
 * hand-over: both shells spread the binding's `screenDeps()` into `createNearbyScreen` and its `handlers`
 * into their peer router, and the binding claims every room subtype.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNearbyRoomBinding, NEARBY_ROOM_SUBTYPES } from '../../src/v2/nearbyRoomBinding.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');

describe('the Nearby room reaches both shells', () => {
  it('the binding claims every room subtype', () => {
    const b = createNearbyRoomBinding({ sendPeerMessage: async () => {} });
    for (const s of NEARBY_ROOM_SUBTYPES) expect(typeof b.handlers[s]).toBe('function');
    expect(NEARBY_ROOM_SUBTYPES).toEqual(['nearby-ask', 'nearby-answer', 'nearby-card', 'nearby-chat', 'nearby-invite', 'nearby-presence', 'nearby-reach']);
  });

  it('web: the screen gets screenDeps() and the peer router spreads handlers', () => {
    const src = read('../../web/v2/circleApp.js');
    expect(src).toMatch(/createNearbyScreen\(\{\s*\.\.\.\(ensureNearbyRoom\(\)\?\.screenDeps\(\)/);
    expect(src).toMatch(/\.\.\.\(ensureNearbyRoom\(agent\)\?\.handlers \?\? \{\}\)/);
    // an answer reaches the screen through screenDeps (the shared controller re-reads), and opens no thread
    expect(src).not.toMatch(/openNearbyThread\(/);
  });

  it('both shells offer the invite-into-the-room door next to the QR (PLAN-nearby §5)', () => {
    expect(read('../../web/v2/circleApp.js')).toMatch(/announceInvite\(\{ uri: r\.uri, circleId/);
    expect(read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js')).toMatch(/nearbyRoom\?\.announceInvite\?\.\(\{/);
  });

  it('mobile: the bundle builds the binding, the host spreads screenDeps(), the router spreads handlers', () => {
    const bundle = read('../../../basis-mobile/src/core/agentBundle.js');
    expect(bundle).toMatch(/createNearbyRoomBinding\(\{/);
    expect(bundle).toMatch(/^\s+nearbyRoom,$/m);
    const host = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
    expect(host).toMatch(/createNearbyScreen\(\{\s*\.\.\.\(bundle\?\.nearbyRoom\?\.screenDeps\?\.\(\)/);
    expect(host).not.toMatch(/openNearbyThread\(/);
    const router = read('../../../basis-mobile/src/screens/ChatScreen.js');
    // the router spreads the room's handlers itself, or hands the room to the shared inbound wiring, which spreads them
    if (/buildInboundWiring\(/.test(router)) {
      expect(router).toMatch(/nearbyRoom: bundle\?\.nearbyRoom/);
      expect(read('../../src/v2/inboundWiring.js')).toMatch(/\.\.\.\(nearbyRoom\?\.handlers \?\? \{\}\)/);
    } else expect(router).toMatch(/\.\.\.\(bundle\?\.nearbyRoom\?\.handlers \?\? \{\}\)/);
  });
});
