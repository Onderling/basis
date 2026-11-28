/**
 * ONE SILENT PEER DOES NOT HOLD UP THE ROOM. Measured on two phones: a third peer in the room that never answered the
 * handshake (each transport waits out its own timeout: 5 s, 5 s, 15 s) made a room line take about 38 s to the other
 * phone, and the sender's own line appeared only after that, because
 *   • the fan sent to the room's peers one after another, each waiting for the one before;
 *   • the greeting of a newly seen peer waited behind the greeting of every peer seen before it, one chain for the room;
 *   • the screen added the person's own line only after the whole fan had settled.
 * Here the silent peer's send never settles at all, so anything still waiting on it is visible.
 */
import { describe, it, expect } from 'vitest';
import { createNearbyRoomBinding } from '../../src/v2/nearbyRoomBinding.js';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';
import { CHAT_MESSAGE, createChatMessage } from '../../src/v2/nearbyRoom.js';

const T0 = 1_700_000_000_000;
const now = () => T0;
const flush = () => new Promise((r) => setTimeout(r, 0));
const never = () => new Promise(() => {});

describe('a silent peer in the room', () => {
  it('a room line reaches the answering peer while the silent one is still pending', async () => {
    const sent = [];
    const room = createNearbyRoomBinding({
      sendPeerMessage: (to, payload) => { sent.push(to); return to === 'silent' ? never() : Promise.resolve({ delivered: true }); },
      listPeers: () => [{ pubKey: 'silent' }, { pubKey: 'b' }],   // the silent one first in the fan, as on one phone
      myAddress: () => 'me', now,
    });
    const built = createChatMessage({ text: 'hoi', from: 'me', allows: { chat: true }, now });
    room.askChannel.broadcastKind(CHAT_MESSAGE, { message: built.message });   // not awaited: it cannot settle
    await flush();
    expect(sent, 'b is sent to without waiting on the silent peer').toContain('b');
  });

  it('a newly seen peer is greeted while an earlier peer\'s greeting is still pending', async () => {
    const greeted = [];
    let push = null;
    createNearbyRoomBinding({
      sendPeerMessage: (to) => { greeted.push(to); return to === 'silent' ? never() : Promise.resolve({ delivered: true }); },
      listPeers: () => [{ pubKey: 'silent' }, { pubKey: 'b' }],
      subscribeToPeers: (fn) => { push = fn; return () => {}; },
      myAddress: () => 'me', myFace: () => ({ label: 'Anna' }), now,
    });
    push([{ pubKey: 'silent' }]);
    await flush();
    push([{ pubKey: 'silent' }, { pubKey: 'b' }]);
    await flush();
    expect(greeted, 'b gets its greeting').toContain('b');
  });

  it('the person\'s own line is on the screen at once, before the fan settles', async () => {
    let report = null;
    const control = { set: (state) => { report = { requested: state, effective: state, degraded: false, perTransport: [] }; return report; }, report: () => report, subscribe: () => () => {} };
    const screen = createNearbyScreen({
      control, levelChosen: () => true, allows: { chat: true, card: true }, myRoomAddress: () => 'me', now, t: (k) => k,
      askChannel: { broadcastKind: () => never(), broadcast: () => never(), sendAnswer: () => never() },
      radio: { get: () => 'on', set: () => {} },
    });
    screen.open();
    screen.say('hoi');   // not awaited: the fan never settles
    await flush();
    expect(JSON.stringify(screen.model().chat ?? null), 'my line is shown').toContain('hoi');
    screen.close();
  });
});
