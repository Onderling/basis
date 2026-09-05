/**
 * contactThreadChannel — client end of a contact/bot peer link (platform half).
 *
 * Drives the channel over a FAKE peer (so no transport flakiness) and through the
 * REAL `makePeerRouter` (the shell's inbound subtype dispatch), proving:
 *   - a turn is sent with the configured OUT subtype + the routing-back threadId;
 *   - an inbound reply on the IN subtype routes to onReply with a normalised shape;
 *   - subtypes are injectable (a bot project can pass its own, e.g. fp-msg/fp-reply)
 *     without the platform naming them — and a foreign subtype is ignored.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createContactThreadChannel,
  DEFAULT_CONTACT_SUBTYPES,
} from '../src/v2/contactThreadChannel.js';
import { makePeerRouter } from '../src/core/handlers/peerRouter.js';

describe('createContactThreadChannel — sendTurn', () => {
  it('sends a turn over the peer with the OUT subtype + thread routing + sender', async () => {
    const sent = [];
    const ch = createContactThreadChannel({
      sendToPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      now: () => 1000,
    });

    const { messageId, sent: p } = ch.sendTurn({
      peerAddr: 'bot-addr',
      threadId: 'thread-1',
      text: 'de wachtlijst is te lang',
      sender: { displayName: 'Jan', webid: 'https://jan.example/me' },
    });
    await p;

    expect(typeof messageId).toBe('string');
    expect(sent).toHaveLength(1);
    expect(sent[0].addr).toBe('bot-addr');
    expect(sent[0].payload).toMatchObject({
      subtype: 'contact-msg', threadId: 'thread-1', text: 'de wachtlijst is te lang',
      messageId, ts: 1000, displayName: 'Jan', webid: 'https://jan.example/me',
    });
  });

  it('uses a caller-supplied messageId + carries replyTo for IR round-trips', async () => {
    const sent = [];
    const ch = createContactThreadChannel({ sendToPeer: (a, p) => sent.push(p) });
    ch.sendTurn({ peerAddr: 'b', threadId: 't', text: 'yes', messageId: 'm-9', replyTo: 'bot-7' });
    expect(sent[0]).toMatchObject({ messageId: 'm-9', replyTo: 'bot-7' });
  });

  it('throws without a peerAddr (no silent drop)', () => {
    const ch = createContactThreadChannel({ sendToPeer: () => {} });
    expect(() => ch.sendTurn({ threadId: 't', text: 'x' })).toThrow(/peerAddr/);
  });
});

describe('createContactThreadChannel — replyHandler via the real peer router', () => {
  it('routes an inbound IN-subtype reply to onReply with a normalised shape', () => {
    const onReply = vi.fn();
    const ch = createContactThreadChannel({ sendToPeer: () => {} });

    const router = makePeerRouter({
      handlers: { [ch.subtypes.in]: ch.replyHandler(onReply) },
    });

    router({ from: 'bot-addr', payload: {
      subtype: 'contact-reply', threadId: 'thread-1', text: 'bedankt!',
      buttons: [{ id: 'send', label: 'Versturen' }], replyTo: 'm-1', messageId: 'r-1',
    } });

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith({
      fromAddr: 'bot-addr', threadId: 'thread-1', text: 'bedankt!',
      buttons: [{ id: 'send', label: 'Versturen' }], replyTo: 'm-1', messageId: 'r-1',
    });
  });

  it('ignores a foreign subtype (the handler is a no-op for non-matching payloads)', () => {
    const onReply = vi.fn();
    const ch = createContactThreadChannel({ sendToPeer: () => {} });
    const handler = ch.replyHandler(onReply);
    handler('bot-addr', { subtype: 'circle-chat-message', text: 'not mine' });
    expect(onReply).not.toHaveBeenCalled();
  });
});

describe('createContactThreadChannel — subtype injection (repo-boundary decoupling)', () => {
  it("a bot project can supply its own wire subtypes (e.g. feedback's fp-msg/fp-reply)", async () => {
    const sent = [];
    const onReply = vi.fn();
    const ch = createContactThreadChannel({
      sendToPeer: (a, p) => sent.push(p),
      subtypes: { out: 'fp-msg', in: 'fp-reply' },
    });

    ch.sendTurn({ peerAddr: 'fp-bot', threadId: 't', text: 'hi' });
    expect(sent[0].subtype).toBe('fp-msg');

    // The matching reply subtype routes; the generic default would NOT.
    const router = makePeerRouter({ handlers: { 'fp-reply': ch.replyHandler(onReply) } });
    router({ from: 'fp-bot', payload: { subtype: 'fp-reply', threadId: 't', text: 'ok' } });
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ threadId: 't', text: 'ok' }));
  });

  it('exposes the default generic subtypes', () => {
    const ch = createContactThreadChannel({ sendToPeer: () => {} });
    expect(ch.subtypes).toEqual(DEFAULT_CONTACT_SUBTYPES);
    expect(DEFAULT_CONTACT_SUBTYPES).toEqual({ out: 'contact-msg', in: 'contact-reply' });
  });
});

describe('createContactThreadChannel — messageHandler (S1 #3 peer DM)', () => {
  it('routes an inbound contact-msg (a peer DMing you) to onMessage', () => {
    const onMessage = vi.fn();
    const ch = createContactThreadChannel({ sendToPeer: () => {} });
    const router = makePeerRouter({ handlers: { [ch.subtypes.out]: ch.messageHandler(onMessage) } });
    router({ from: 'alice', payload: { subtype: 'contact-msg', text: 'hoi buurman', messageId: 'a-1' } });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ fromAddr: 'alice', text: 'hoi buurman' }));
    // a contact-reply does NOT trigger the message handler
    onMessage.mockClear();
    router({ from: 'bob', payload: { subtype: 'contact-reply', text: 'x' } });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('peer↔peer round-trip: Alice ↔ Bob over a fake mesh (both speak contact-msg)', async () => {
    // in-process mesh: sendTo(addr,payload) → addr's router({from, payload})
    const handlers = new Map();
    const peerFor = (self) => ({ sendTo: async (to, payload) => handlers.get(to)?.({ from: self, payload }) });

    const aliceInbox = [];
    const bobInbox = [];
    const aliceCh = createContactThreadChannel({ sendToPeer: (addr, p) => peerFor('alice').sendTo(addr, p) });
    const bobCh   = createContactThreadChannel({ sendToPeer: (addr, p) => peerFor('bob').sendTo(addr, p) });
    handlers.set('alice', makePeerRouter({ handlers: { [aliceCh.subtypes.out]: aliceCh.messageHandler((m) => aliceInbox.push(m)) } }));
    handlers.set('bob',   makePeerRouter({ handlers: { [bobCh.subtypes.out]:   bobCh.messageHandler((m) => bobInbox.push(m)) } }));

    // Alice → Bob
    await aliceCh.sendTurn({ peerAddr: 'bob', threadId: 'bob', text: 'heb jij een boormachine?' }).sent;
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0]).toMatchObject({ fromAddr: 'alice', text: 'heb jij een boormachine?' });

    // Bob → Alice (reply, also a contact-msg — symmetric)
    await bobCh.sendTurn({ peerAddr: 'alice', threadId: 'alice', text: 'ja hoor, kom maar langs' }).sent;
    expect(aliceInbox).toHaveLength(1);
    expect(aliceInbox[0]).toMatchObject({ fromAddr: 'bob', text: 'ja hoor, kom maar langs' });
  });
});

describe('createContactThreadChannel — the pre-send floor', () => {
  it('redacts the turn on this device before it leaves, persists the redacted body, and returns it', async () => {
    const sent = [];
    const added = [];
    const ch = createContactThreadChannel({
      sendToPeer: async (addr, payload) => { sent.push({ addr, payload }); },
      itemStore: { addItems: async (items) => { added.push(...items); return items.map((i) => ({ id: i.id ?? 'x' })); }, listOpen: async () => [] },
      now: () => 1000,
      floorFor: (peerAddr) => (peerAddr === 'bot-addr'
        ? { rules: [{ type: 'phone', pattern: '\\b06 ?\\d{8}\\b' }], placeholders: { phone: '[telefoon]' } }
        : null),
    });
    const r = ch.sendTurn({ peerAddr: 'bot-addr', threadId: 'thread-1', text: 'bel me op 06 12345678' });
    await r.sent;
    expect(r.text).toBe('bel me op [telefoon]');
    expect(r.redacted).toBe(1);
    expect(sent[0].payload.text).toBe('bel me op [telefoon]');
    // the durable copy is the redacted one too — what left the device is what the thread remembers
    const bodies = JSON.stringify(added);
    expect(bodies).toContain('[telefoon]');
    expect(bodies).not.toContain('12345678');
  });
  it('a contact without a floor sends the text verbatim and reports nothing redacted', async () => {
    const sent = [];
    const ch = createContactThreadChannel({ sendToPeer: async (addr, payload) => { sent.push(payload); }, floorFor: () => null });
    const r = ch.sendTurn({ peerAddr: 'someone', threadId: 't', text: 'bel me op 06 12345678' });
    await r.sent;
    expect(r.text).toBe('bel me op 06 12345678');
    expect(r.redacted).toBe(0);
    expect(sent[0].text).toBe('bel me op 06 12345678');
  });
});
