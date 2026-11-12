/**
 * A TYPED TURN TO A CONTACT CARRIES ITS DELIVERY STATE, AND THE OTHER SIDE CONFIRMS IT LANDED.
 *
 * The two-phone walk (2026-11-05, rows 9 and 11): a person's own DM bubbles said nothing — sent? delivered? waiting? —
 * while a circle bubble beside them said "Their app has it". Same ladder, same map, same chip now: the turn is
 * `pending` as it appears, moves on the addressed send's verdict, and the receiver answers with the SAME receipt a
 * circle member sends, under the same per-person setting.
 */
import { describe, it, expect, vi } from 'vitest';
import { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';
import { createContactThreadChannel } from '../../src/v2/contactThreadChannel.js';
import { deliveryAfterContactSend, trackContactTurn } from '../../src/v2/contactTurnDelivery.js';
import { DELIVERY, DELIVERY_REASON_LABELS } from '../../src/v2/deliveryState.js';
import { makeReceiptSender, makeReceiptReceiver, contactReceiptAddresses } from '../../src/v2/deliverySettings.js';

const PEER = 'app.4wFydlNFFFoDesd7cy6ac5KIr0';

function memStore() {
  const store = { items: [], addItems: vi.fn(async (d) => { const p = d.map((x, i) => ({ id: `i${store.items.length + i}`, ...x })); store.items.push(...p); return p; }), listOpen: vi.fn(async () => store.items) };
  return store;
}

describe('what the addressed send\'s verdict means on the ladder', () => {
  it('left = maybe-received, never "sent"; a fallback that left counts as the verdict', () => {
    expect(deliveryAfterContactSend({ sent: { delivered: true, held: false } })).toEqual({ state: DELIVERY.MAYBE, reason: null });
    expect(deliveryAfterContactSend({ sent: { delivered: false, held: false, reason: 'peer-unreachable' }, fallback: { delivered: true, held: false } }).state).toBe(DELIVERY.MAYBE);
    expect(deliveryAfterContactSend(undefined).state, 'no verdict is taken as left, as addressedDeliver takes it').toBe(DELIVERY.MAYBE);
  });
  it('held here = pending with the wait as its reason; a persona\'s hold keeps the persona\'s words', () => {
    expect(deliveryAfterContactSend({ sent: { held: true, delivered: false, reason: 'no-relay' } })).toEqual({ state: DELIVERY.PENDING, reason: 'held' });
    expect(deliveryAfterContactSend({ sent: { held: true, delivered: false, reason: 'persona-no-connection' } }).reason).toBe('persona-waiting');
    expect(DELIVERY_REASON_LABELS.held, 'the wait has words of its own').toMatch(/^circle\.chat\.delivery\./);
  });
  it('did not leave = failed, with the agent\'s reason when it named one', () => {
    expect(deliveryAfterContactSend({ sent: { delivered: false, held: false, reason: 'peer-unreachable' } })).toEqual({ state: DELIVERY.FAILED, reason: 'peer-unreachable' });
    expect(DELIVERY_REASON_LABELS['peer-unreachable']).toMatch(/^circle\.chat\.delivery\./);
    expect(deliveryAfterContactSend({ sent: { delivered: false, held: false } }).reason).toBeNull();
  });
});

describe('one turn on the shared map', () => {
  it('is pending as it appears and moves when the send answers', async () => {
    const map = createDeliveryStateMap();
    let settle;
    const sent = new Promise((r) => { settle = r; });
    const done = trackContactTurn({ messageId: 'm1', sent, deliveryMap: map });
    expect(map.get('m1')).toBe(DELIVERY.PENDING);
    settle({ sent: { delivered: true } });
    expect(await done).toEqual({ state: DELIVERY.MAYBE, reason: null });
    expect(map.get('m1')).toBe(DELIVERY.MAYBE);
  });
  it('a send that throws is failed; a held send keeps its reason beside pending', async () => {
    const map = createDeliveryStateMap();
    await trackContactTurn({ messageId: 'm2', sent: Promise.reject(new Error('socket closed')), deliveryMap: map });
    expect(map.get('m2')).toBe(DELIVERY.FAILED);
    await trackContactTurn({ messageId: 'm3', sent: Promise.resolve({ sent: { held: true, delivered: false } }), deliveryMap: map });
    expect(map.get('m3')).toBe(DELIVERY.PENDING);
    expect(map.reasonOf('m3')).toBe('held');
  });
  it('a receipt that lands before the verdict is not undone by it (the map\'s own order)', async () => {
    const map = createDeliveryStateMap();
    let settle;
    const done = trackContactTurn({ messageId: 'm4', sent: new Promise((r) => { settle = r; }), deliveryMap: map });
    map.set('m4', DELIVERY.STORED);
    settle({ sent: { delivered: true } });
    await done;
    expect(map.get('m4')).toBe(DELIVERY.STORED);
  });
});

describe('the receiver answers a landed turn with the circle\'s receipt', () => {
  const isKept = async () => true;   // these turns come from a contact the person kept (the stranger case is below)
  it('NO receipt to a sender who is not a kept contact (none, or hidden): a receipt is a read and online signal to someone the person never chose', async () => {
    const landed = [];
    const book = new Map([['webid:bea', 'kept'], ['webid:hidden', 'hidden']]);
    const ch = createContactThreadChannel({
      sendToPeer: () => {}, itemStore: memStore(),
      isKept: async (who) => book.get(who) === 'kept',
    });
    ch.setLandedHook((info) => { landed.push(info); });
    await ch.persistInbound({ contactId: 'webid:stranger', fromAddr: 'webid:stranger', text: 'hoi', messageId: 's-1', ts: 1 });
    await ch.persistInbound({ contactId: 'webid:hidden', fromAddr: 'webid:hidden', text: 'hoi', messageId: 'h-1', ts: 2 });
    expect(landed, 'a stranger and a hidden contact get nothing back').toEqual([]);
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: 'webid:bea', text: 'hoi', messageId: 'b-1', ts: 3 });
    expect(landed).toEqual([{ msgId: 'b-1', fromPeerAddr: 'webid:bea', source: 'receiver' }]);
  });
  it('without the book (no isKept handed in) nothing is confirmed: deny by default', async () => {
    const landed = [];
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: memStore() });
    ch.setLandedHook((info) => { landed.push(info); });
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: 'webid:bea', text: 'hoi', messageId: 'b-1', ts: 1 });
    expect(landed).toEqual([]);
  });
  it('a turn straight from the contact, with their id, goes to the landed hook once; a duplicate and a carried copy do not', async () => {
    const landed = [];
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: memStore(), isKept });
    ch.setLandedHook((info) => { landed.push(info); });
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: PEER, text: 'hoi', messageId: 'their-1', ts: 1 });
    expect(landed).toEqual([{ msgId: 'their-1', fromPeerAddr: PEER, source: 'receiver' }]);
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: PEER, text: 'hoi', messageId: 'their-1', ts: 1 });   // the relay replays it
    expect(landed, 'a duplicate confirms nothing new').toHaveLength(1);
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: PEER, text: 'later', messageId: 'their-2', ts: 2, viaOwnDevice: true });
    expect(landed, 'a copy my own device carried here is not theirs to be told about').toHaveLength(1);
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: PEER, text: 'no id', ts: 3 });
    expect(landed, 'a turn without the sender\'s id has nothing a receipt could name').toHaveLength(1);
  });
  it('the hook is the circle\'s receipt sender: the person\'s setting decides, and the wire carries only the id', async () => {
    const wire = [];
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: memStore(), isKept });
    let settings = { sendReceipts: true };
    ch.setLandedHook(makeReceiptSender({ getSettings: () => settings, sendTo: async (to, payload, opts) => { wire.push({ to, payload, opts }); } }));
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: PEER, text: 'hoi', messageId: 'their-1', ts: 1 });
    expect(wire).toEqual([{ to: PEER, payload: { subtype: 'delivery-receipt', messageId: 'their-1' }, opts: {} }]);
    settings = { sendReceipts: false };
    await ch.persistInbound({ contactId: 'webid:bea', fromAddr: PEER, text: 'nog', messageId: 'their-2', ts: 2 });
    expect(wire, 'receipts off: nothing leaves').toHaveLength(1);
  });
  it('a turn from ANY of the contact\'s pair-circle addresses is answered inside the pair circle; from their canonical address plainly; from a per-circle address nothing explains, not at all', async () => {
    // measured 2026-11-07: an unscoped receipt to a per-circle address is "delivered" and dropped by their roster
    // authorizer — and it would hand the relay the link canonical-me ↔ their per-circle address
    const PHONE = 'per-circle-address-of-bea-phone';
    const LAPTOP = 'per-circle-address-of-bea-laptop';   // her other device: a second address of the same pair circle
    const STRANGE = 'per-circle-address-nobody-explains';
    const landed = [];
    const pair = { rosterAddressesFor: async (who) => (who === PEER ? { circleId: 'pair:anna:bea', addresses: new Set([PHONE, LAPTOP, 'me-in-pair']) } : null) };
    // the channel keys the thread by the identity behind the address: a per-circle address resolves to the person
    const identityOf = (addr) => ([PHONE, LAPTOP, STRANGE].includes(addr) ? PEER : addr);
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: memStore(), pair, identityOf, isKept });
    ch.setLandedHook((info) => { landed.push(info); });
    await ch.persistInbound({ contactId: PEER, fromAddr: PHONE, text: 'via de kring', messageId: 'their-1', ts: 1 });
    expect(landed[0]).toEqual({ msgId: 'their-1', fromPeerAddr: PHONE, source: 'receiver', circleId: 'pair:anna:bea' });
    await ch.persistInbound({ contactId: PEER, fromAddr: LAPTOP, text: 'van haar laptop', messageId: 'their-2', ts: 2 });
    expect(landed[1], 'her other device is on the same roster: scoped too').toEqual({ msgId: 'their-2', fromPeerAddr: LAPTOP, source: 'receiver', circleId: 'pair:anna:bea' });
    await ch.persistInbound({ contactId: PEER, fromAddr: PEER, text: 'aan mijn hoofdadres', messageId: 'their-3', ts: 3 });
    expect(landed[2], 'her canonical address: plainly').toEqual({ msgId: 'their-3', fromPeerAddr: PEER, source: 'receiver' });
    await ch.persistInbound({ contactId: PEER, fromAddr: STRANGE, text: 'van een onbekend adres', messageId: 'their-4', ts: 4 });
    expect(landed, 'a per-circle address no roster explains: no receipt at all, never an unscoped one').toHaveLength(3);
  });
});

describe('who may confirm MY turn to a contact', () => {
  const BEA_PAIR = 'per-circle-address-of-bea';
  const makeReceiver = (ch, pair, map) => makeReceiptReceiver({
    deliveryMap: map, eventLog: { query: () => [] }, listCircleMembers: async () => [],
    contactAddressesOf: contactReceiptAddresses({ channel: ch, pair }),
  });
  it('a receipt for my DM id from a third address is refused; from the contact\'s canonical or pair address it is applied', async () => {
    const map = createDeliveryStateMap();
    const pair = { rosterAddressesFor: async (who) => (who === PEER ? { circleId: 'pair:anna:bea', addresses: new Set([BEA_PAIR]) } : null) };
    const ch = createContactThreadChannel({ sendToPeer: async () => ({ delivered: true }), itemStore: memStore(), pair });
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map, eventLog: { query: () => [] }, listCircleMembers: async () => [],
      contactAddressesOf: contactReceiptAddresses({ channel: ch, pair }),
    });
    const { messageId, sent } = ch.sendTurn({ peerAddr: PEER, threadId: PEER, text: 'hoi' });
    await trackContactTurn({ messageId, sent, deliveryMap: map });
    expect(map.get(messageId)).toBe(DELIVERY.MAYBE);
    expect(await onReceipt({ subtype: 'delivery-receipt', messageId }, 'some-stranger'), 'a stranger who learnt the id').toBe(false);
    expect(map.get(messageId)).toBe(DELIVERY.MAYBE);
    expect(await onReceipt({ subtype: 'delivery-receipt', messageId }, BEA_PAIR), 'the contact, from her pair address').toBe(true);
    expect(map.get(messageId)).toBe(DELIVERY.STORED);
    const second = ch.sendTurn({ peerAddr: PEER, threadId: PEER, text: 'nog' });
    await trackContactTurn({ messageId: second.messageId, sent: second.sent, deliveryMap: map });
    expect(await onReceipt({ subtype: 'delivery-receipt', messageId: second.messageId }, PEER), 'the contact, from her canonical address').toBe(true);
  });
  it('an id that is not a contact turn of mine keeps the id gate alone (no opinion, never "nobody")', async () => {
    const map = createDeliveryStateMap();
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: memStore() });
    const onReceipt = makeReceiver(ch, null, map);
    expect(await onReceipt({ subtype: 'delivery-receipt', messageId: 'never-sent' }, 'anyone'), 'an id this device never sent').toBe(false);
    await expect(contactReceiptAddresses({ channel: ch, pair: null })('never-sent')).resolves.toBeNull();
  });
});
