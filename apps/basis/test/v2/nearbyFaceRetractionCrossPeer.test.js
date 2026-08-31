/**
 * The face retraction, across TWO REAL AGENTS on a real peer wire.
 *
 * The unit tests prove `announceFace` sends `label: null` and that a null label clears the stored face.
 * They prove it either side of one seam. This one puts two independently booted app agents on a shared
 * secure transport and sends the retraction between them — the same `sendPeerMessage` the shells use,
 * through the same room binding — so the claim being made is "the retraction crosses", not "the function
 * returns the right shape".
 *
 * ── Why this is not the phone-and-browser walk Frits asked for ──────────────────────────────────────
 * The web shell CANNOT be a nearby-room peer today, and it is a design fact rather than a missed wire.
 * A room's inbound handlers are gated on `inRoom(from)`, which reads `listPeers`; web passes
 * `listPeers: () => []` and no `subscribeToPeers` at all (`circleApp.js`, `ensureNearbyRoom`). It passes
 * those because `createNearbyPeerSource` merges peers from DISCOVERING transports — mDNS, BLE — and a
 * browser has none, so the list would be empty whatever it were handed. Nearby means physically near,
 * and a browser cannot see who is. The reachable second peer is another agent on a real radio: a phone,
 * or the companion node over mDNS.
 *
 * So this test proves the mechanism between two agents, and the two-phone walk still owes the radio.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createNearbyRoomBinding } from '../../src/v2/nearbyRoomBinding.js';
import { buildNearbyModel } from '../../src/v2/circleNearby.js';
import { bootRealAgentNode, connectAgentsOverBus, until, teardown } from '../support/pairRealAgents.js';

describe('a face retraction crosses to another agent and clears the face it had set', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('announce → the peer shows the name; retract → the peer drops it, on the wire', async () => {
    A = await bootRealAgentNode('ada');
    B = await bootRealAgentNode('bo');
    await connectAgentsOverBus(A, B);

    // Each side's room lists the other — what a radio would have told them.
    let adaFace = { label: 'Ada' };
    const roomA = createNearbyRoomBinding({
      sendPeerMessage: (addr, payload) => A.agent.sendPeerMessage(addr, payload),
      listPeers: () => [{ pubKey: B.pubKey }],
      myAddress: () => A.pubKey,
      myFace: () => adaFace,
    });
    const roomB = createNearbyRoomBinding({
      sendPeerMessage: (addr, payload) => B.agent.sendPeerMessage(addr, payload),
      listPeers: () => [{ pubKey: A.pubKey }],
      myAddress: () => B.pubKey,
    });
    // Both shells route inbound envelopes into the room from their peer router; this harness's router
    // collects anything it has no handler for, so drain that into the room the same way.
    let drained = 0;
    const pump = () => { while (drained < B.received.length) { const e = B.received[drained++]; roomB.onPeerMessage(e.from, e.payload); } };

    // ── the announce ────────────────────────────────────────────────────────────────────────────
    expect(await roomA.announceFace()).toEqual({ announced: 1, label: 'Ada' });
    await until(() => { pump(); return roomB.presenceOf(A.pubKey)?.label === 'Ada'; });
    expect(roomB.presenceOf(A.pubKey).label, 'the room learned the name off the wire').toBe('Ada');

    // …and B's SCREEN shows it, which is the thing a person would see.
    const faces = new Map([[A.pubKey, roomB.presenceOf(A.pubKey)]]);
    const rowsWithFace = buildNearbyModel({
      peers: [{ pubKey: A.pubKey }].map((p) => {
        const f = faces.get(p.pubKey);
        return f?.label ? { ...p, label: f.label } : p;
      }),
      t: (k) => k,
    }).rows;
    expect(rowsWithFace[0].pseudonym).toBe('Ada');

    // ── the retraction ──────────────────────────────────────────────────────────────────────────
    adaFace = null;                                            // "Nobody", or a face the profile lost
    expect(await roomA.announceFace(), 'a face that resolves to nothing still travels')
      .toEqual({ announced: 1, label: null });
    await until(() => { pump(); return roomB.presenceOf(A.pubKey)?.label === null; });
    expect(roomB.presenceOf(A.pubKey).label, 'the stored face is cleared, not left at its last value')
      .toBeNull();

    // The row falls back to something readable rather than keeping the retracted name.
    const cleared = roomB.presenceOf(A.pubKey);
    const rowsAfter = buildNearbyModel({
      peers: [cleared?.label ? { pubKey: A.pubKey, label: cleared.label } : { pubKey: A.pubKey }],
      t: (k) => k,
    }).rows;
    expect(rowsAfter[0].pseudonym).not.toBe('Ada');
    expect(rowsAfter[0].pseudonym.trim().length, 'and never a blank row').toBeGreaterThan(0);
  }, 60000);
});
