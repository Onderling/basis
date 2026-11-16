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
 *
 * ── Composed as the phone composes the room ─────────────────────────────────────────────────────────
 * Each side ENTERS the room through the real `createNearbyRoomKey` over its agent's own seams (the room identity, its
 * owner, `registerSelfIdentity`), exactly as `agentBundle.js` wires it, and the room binding speaks AS that room key
 * (`myAddress` = the room key, the send options passed through as both shells pass them). The one stand-in is the LAN
 * transport: the shared bus binds the room key where the mesh surface's `setLanIdentity` would hand it to the LAN.
 * Speaking as the agent's own chat key (as this test once did) is what the LAN refuses, and what the send gate's
 * `requireSendAs` refuses too.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createNearbyRoomBinding } from '../../src/v2/nearbyRoomBinding.js';
import { createNearbyRoomKey } from '../../src/v2/nearbyRoomKey.js';
import { buildNearbyModel } from '../../src/v2/circleNearby.js';
import { bootRealAgentNode, connectAgentsOverBus, until, teardown } from '../support/pairRealAgents.js';

describe('a face retraction crosses to another agent and clears the face it had set', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('announce → the peer shows the name; retract → the peer drops it, on the wire', async () => {
    A = await bootRealAgentNode('ada');
    B = await bootRealAgentNode('bo');
    await connectAgentsOverBus(A, B);

    // Each side ENTERS the room as the phone does: a fresh room key for its default self, registered with its agent;
    // the shared bus stands in for the LAN transport the mesh surface would hand it to.
    const enter = async (node) => {
      const key = createNearbyRoomKey({
        roomSelf: () => null,
        identityFor: (selfId, ns) => node.agent.nearbyRoomIdentityFor(selfId, ns),
        ownerOf: (selfId) => node.agent.nearbyRoomOwnerOf(selfId),
        registerSelfIdentity: (address, identity, o) => node.agent.sa.registerSelfIdentity(address, identity, o) === true,
        forgetSelfIdentity: (address) => node.agent.sa.forgetSelfIdentity?.(address),
        setLanIdentity: async (identity) => { if (identity?.pubKey) await node._busTransport.addAddress(identity.pubKey); return identity?.pubKey ?? null; },
      });
      await key.viewOpened();
      expect(key.address(), `${node.label} entered the room under a room key, not its own chat key`).toBeTruthy();
      expect(key.address()).not.toBe(node.pubKey);
      return key;
    };
    const keyA = await enter(A);
    const keyB = await enter(B);
    const roomKeyA = keyA.address();
    const roomKeyB = keyB.address();

    // Each side's room lists the other's ROOM key: what the radio would have told them.
    let adaFace = { label: 'Ada' };
    const roomA = createNearbyRoomBinding({
      sendPeerMessage: (addr, payload, opts) => A.agent.sendPeerMessage(addr, payload, opts),
      listPeers: () => [{ pubKey: roomKeyB }],
      myAddress: () => keyA.address(),
      myFace: () => adaFace,
    });
    const roomB = createNearbyRoomBinding({
      sendPeerMessage: (addr, payload, opts) => B.agent.sendPeerMessage(addr, payload, opts),
      listPeers: () => [{ pubKey: roomKeyA }],
      myAddress: () => keyB.address(),
    });
    // Both shells route inbound envelopes into the room from their peer router; this harness's router
    // collects anything it has no handler for, so drain that into the room the same way.
    let drained = 0;
    const pump = () => { while (drained < B.received.length) { const e = B.received[drained++]; roomB.onPeerMessage(e.from, e.payload); } };

    // ── the announce ────────────────────────────────────────────────────────────────────────────
    expect(await roomA.announceFace()).toEqual({ announced: 1, label: 'Ada' });
    await until(() => { pump(); return roomB.presenceOf(roomKeyA)?.label === 'Ada'; });
    expect(roomB.presenceOf(roomKeyA).label, 'the room learned the name off the wire').toBe('Ada');

    // …and B's SCREEN shows it, which is the thing a person would see.
    const faces = new Map([[roomKeyA, roomB.presenceOf(roomKeyA)]]);
    const rowsWithFace = buildNearbyModel({
      peers: [{ pubKey: roomKeyA }].map((p) => {
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
    await until(() => { pump(); return roomB.presenceOf(roomKeyA)?.label === null; });
    expect(roomB.presenceOf(roomKeyA).label, 'the stored face is cleared, not left at its last value')
      .toBeNull();

    // The row falls back to something readable rather than keeping the retracted name.
    const cleared = roomB.presenceOf(roomKeyA);
    const rowsAfter = buildNearbyModel({
      peers: [cleared?.label ? { pubKey: roomKeyA, label: cleared.label } : { pubKey: roomKeyA }],
      t: (k) => k,
    }).rows;
    expect(rowsAfter[0].pseudonym).not.toBe('Ada');
    expect(rowsAfter[0].pseudonym.trim().length, 'and never a blank row').toBeGreaterThan(0);
  }, 60000);
});
