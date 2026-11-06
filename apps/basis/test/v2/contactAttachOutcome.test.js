/**
 * A FILE SENT FROM A CONTACT THREAD'S "+" SHOWS IN THAT THREAD, AND NOTHING ELSE IS SAID.
 *
 * A walk on the test phone (2026-11-06): the "+" sent plant.png, the other side got it, and the sender saw an alert
 * in the old slash door's words with the contact's key in it ("sent plant.png (390 bytes) → 4wFyd…"), and no bubble
 * in their own thread. The op now hands back what it sent; the shared settle step records it on our side of the thread
 * (as a typed turn is) and says only what the bubble cannot: waiting for them, or did not reach them.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLocalBuiltins } from '../../src/core/localBuiltins.js';
import { createContactThreadChannel } from '../../src/v2/contactThreadChannel.js';
import { settleContactAttach } from '../../src/v2/contactAttachOutcome.js';

const t = (key, params = {}) => {
  const tail = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ');
  return tail ? `[${key}](${tail})` : `[${key}]`;
};
const PEER = 'app.4wFydlNFFFoDesd7cy6ac5KIr0';

function sendFileWith(sendAnswer = { ok: true }) {
  const agent = {
    identity: { chat: { pubKey: 'pk', stableId: 'sid' }, host: { webid: 'https://a/profile#me' } },
    peer:     { address: 'app.me', status: 'connected' },
    sendPeerMessage: async () => sendAnswer,
  };
  const handlers = createLocalBuiltins({
    catalogue: [], t, threadStore: { get: () => null, upsert: () => {}, list: () => [] }, setActive: () => {},
    callSkill: async () => ({}), localActor: 'me', agent,
    openFilePicker: async () => ({ name: 'plant.png', type: 'image/png', size: 390, dataB64: 'iVBORw0KGgo=' }),
  });
  return handlers['send-file'];
}

function memChannel() {
  const store = { items: [], addItems: vi.fn(async (d) => { const p = d.map((x, i) => ({ id: `i${store.items.length + i}`, ...x })); store.items.push(...p); return p; }), listOpen: vi.fn(async () => store.items) };
  return createContactThreadChannel({ sendToPeer: () => {}, itemStore: store });
}

describe('the contact thread\'s "+" records what it sent and keeps the key off screen', () => {
  it('a delivered file lands on our side of the thread, and nothing is said', async () => {
    const r = await sendFileWith()({ peer: PEER });
    const channel = memChannel();
    const out = await settleContactAttach(r, { channel, contactId: 'webid:bea', peerAddr: PEER, t });
    expect(out.say, 'the bubble says it; no alert').toBeNull();
    const turns = await channel.rehydrate('webid:bea');
    const mine = turns.find((x) => x.file);
    expect(mine, 'the sent file is in the sender\'s own thread').toBeTruthy();
    expect(mine.origin).toBe('user');
    expect(mine.file.name).toBe('plant.png');
    expect(mine.messageId).toBe(out.messageId);
  });

  it('a held file is in the thread too, with one line that names the file and never the key', async () => {
    const r = await sendFileWith({ held: true })({ peer: PEER });
    const channel = memChannel();
    const out = await settleContactAttach(r, { channel, contactId: 'webid:bea', peerAddr: PEER, t });
    expect(out.say).toBe('[circle.attach.file_held](name=plant.png)');
    expect((await channel.rehydrate('webid:bea')).some((x) => x.file)).toBe(true);
  });

  it('a file that did not reach them says so without the key; a cancelled pick says nothing', async () => {
    const r = await sendFileWith({ held: false, delivered: false, reason: 'gone' })({ peer: PEER });
    const out = await settleContactAttach(r, { channel: memChannel(), contactId: 'webid:bea', peerAddr: PEER, t });
    expect(out.say).toBe('[circle.attach.file_not_reached]');
    expect(String(out.say)).not.toContain(PEER);
    const cancelled = await settleContactAttach({ ok: false, code: 'cancelled', error: '[sendFile.cancelled]' }, { channel: memChannel(), contactId: 'x', peerAddr: PEER, t });
    expect(cancelled.say).toBeNull();
  });

  it('a file sent from one device reaches the owner\'s other devices as our side of the thread', async () => {
    const fanned = [];
    const store = { items: [], addItems: vi.fn(async (d) => { const p = d.map((x, i) => ({ id: `i${store.items.length + i}`, ...x })); store.items.push(...p); return p; }), listOpen: vi.fn(async () => store.items) };
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: store, fanToOwnDevices: async (turn) => { fanned.push(turn); } });
    await ch.persistOutbound({ contactId: 'webid:bea', peerAddr: PEER, file: { id: 'f1', name: 'plant.png', mime: 'image/png', size: 390, dataB64: 'iVBORw0KGgo=' }, messageId: 'file-share-f1' });
    expect(fanned[0]?.file?.name).toBe('plant.png');
    const sibling = memChannel();
    const landed = await sibling.applyOwnDeviceTurn(fanned[0]);
    expect(landed.origin).toBe('user');
    expect((await sibling.rehydrate('webid:bea')).find((x) => x.file)?.file?.name).toBe('plant.png');
  });
});
