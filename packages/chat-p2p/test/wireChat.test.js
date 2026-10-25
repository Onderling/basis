/**
 * wireChat — byte-identity after the C3 fold (connectivity Phase 2 tail).
 *
 * wireChat's outbound SEND + PERSIST + DEDUP now route through the shared
 * `createAddressedDeliver` core (the same primitive `contactThreadChannel`
 * uses). This suite pins that the reroute is a NO-OP on the wire, on the
 * persisted item, and on dedup — a mixed-version network + persisted threads
 * must be unaffected. The golden shapes here are the pre-fold wireChat
 * envelope + `chat-message` item verbatim (see the module doc's wire table).
 */

import { describe, it, expect, vi } from 'vitest';
import { wireChat } from '../index.js';

/** Harness that captures BOTH halves: the wire (sendOneWay) + the persisted
 *  draft/opts (addItems). */
function buildHarness(overrides = {}) {
  const messageHandlers = [];
  const oneWayCalls = [];
  const addItemsCalls = [];
  const items = [];
  const transport = {
    sendOneWay: vi.fn(async (toPubKey, env) => { oneWayCalls.push({ toPubKey, env }); }),
  };
  const agent = {
    on:  (name, fn) => { if (name === 'message') messageHandlers.push(fn); },
    off: (name, fn) => {
      if (name === 'message') {
        const i = messageHandlers.indexOf(fn);
        if (i >= 0) messageHandlers.splice(i, 1);
      }
    },
    emit: vi.fn(),
    transport,
    transportFor: vi.fn(async () => transport),
  };
  const itemStore = {
    addItems: vi.fn(async (drafts, opts) => {
      addItemsCalls.push({ drafts, opts });
      const persisted = drafts.map((d) => ({ id: 'id-' + items.length, ...d }));
      items.push(...persisted);
      return persisted;
    }),
    getById:  vi.fn(),
    listOpen: vi.fn(async () => items),
  };
  const members = { resolveByWebid: vi.fn(async () => null), resolveByStableId: vi.fn(async () => null) };
  const ctrl = wireChat({
    agent, itemStore, members,
    muted: new Set(),
    metrics: { record: vi.fn() },
    localActor:    'urn:me',
    localStableId: 'me-stable',
    ...overrides,
  });
  return { agent, itemStore, oneWayCalls, addItemsCalls, items, messageHandlers, ctrl };
}

describe('wireChat — byte-identity after routing through the shared deliver core', () => {
  it('send() produces the byte-identical wire envelope', async () => {
    const h = buildHarness();
    const res = await h.ctrl.send({
      toPubKey: 'peer-1', threadId: 't1', body: 'hoi', subtype: 'chat-message',
    });
    expect(res).toEqual({ ok: true, itemId: null });   // sent; nothing kept here

    const wire = h.oneWayCalls[0].env;
    // Outer transport frame — verbatim.
    expect(h.oneWayCalls[0].toPubKey).toBe('peer-1');
    expect(wire.type).toBe('message');
    expect(wire.parts).toHaveLength(1);
    expect(wire.parts[0].type).toBe('DataPart');

    const data = wire.parts[0].data;
    // EXACT key set + order of the DataPart payload (the pre-fold shape).
    expect(Object.keys(data)).toEqual([
      'type', 'subtype', 'threadId', 'body', 'fromWebid', 'fromStableId', 'sentAt', 'nonce',
    ]);
    expect(data.type).toBe('p2p-chat');
    expect(data.subtype).toBe('chat-message');
    expect(data.threadId).toBe('t1');
    expect(data.body).toBe('hoi');
    expect(data.fromWebid).toBe('urn:me');
    expect(data.fromStableId).toBe('me-stable');
    expect(typeof data.sentAt).toBe('number');
    expect(typeof data.nonce).toBe('string');
    expect(data.nonce.length).toBeGreaterThan(0);
  });

  it('a chat turn is not stored on either side — its record is the contact thread the basis shells keep', async () => {
    const h = buildHarness();
    await h.ctrl.send({ toPubKey: 'peer-1', threadId: 't1', body: 'hoi', subtype: 'chat-message' });
    expect(h.oneWayCalls).toHaveLength(1);
    expect(h.addItemsCalls).toHaveLength(0);
    await h.messageHandlers[0]({
      from: 'peer-pub',
      parts: [{ type: 'DataPart', data: { type: 'p2p-chat', subtype: 'chat-message', threadId: 't1', body: 'terug', fromWebid: 'urn:peer', nonce: 'n-in' } }],
    });
    expect(h.addItemsCalls).toHaveLength(0);
  });

  it('non-chat subtypes stay send-only (wire sent, nothing persisted)', async () => {
    const h = buildHarness();
    const res = await h.ctrl.send({
      toPubKey: 'peer-1', threadId: 't1', subtype: 'reveal-request',
    });
    expect(res).toEqual({ ok: true, itemId: null });
    expect(h.oneWayCalls).toHaveLength(1);
    expect(h.oneWayCalls[0].env.parts[0].data.subtype).toBe('reveal-request');
    // No sender-side persistence for a send-only subtype (pre-fold parity).
    expect(h.addItemsCalls).toHaveLength(0);
  });

  it('a transport failure returns the legacy soft error (and does NOT persist)', async () => {
    const h = buildHarness();
    h.agent.transportFor = vi.fn(async () => ({
      sendOneWay: vi.fn(async () => { throw new Error('no route'); }),
    }));
    const res = await h.ctrl.send({ toPubKey: 'peer-1', threadId: 't1', body: 'hoi' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('transport: no route');
    expect(h.addItemsCalls).toHaveLength(0);
  });

  it('carries caller extras onto the wire byte-for-byte (a broadcast post)', async () => {
    const h = buildHarness();
    await h.ctrl.send({
      toPubKey: 'peer-1', subtype: 'broadcast-post',
      extras: { handle: 'ada', trustOffer: 'bekend' },
    });
    const data = h.oneWayCalls[0].env.parts[0].data;
    expect(data.subtype).toBe('broadcast-post');
    expect(data.handle).toBe('ada');
    expect(data.trustOffer).toBe('bekend');
  });
});

describe('wireChat — host-injected hold-forward sender (Wave B: route DMs through deliver)', () => {
  it('routes the send through reliableSend (with guarantee) instead of the bare transport', async () => {
    const reliableCalls = [];
    const reliableSend = vi.fn(async (to, wire, opts) => { reliableCalls.push({ to, wire, opts }); return { held: false, delivered: true, msgId: 'm1' }; });
    const h = buildHarness({ reliableSend });

    const res = await h.ctrl.send({ toPubKey: 'peer-1', threadId: 't1', body: 'hoi', subtype: 'chat-message' });
    expect(res).toEqual({ ok: true, itemId: null });   // sent; nothing kept here

    // The reliable sender got the SAME wire the bare transport would have (byte-identical),
    // plus the hold-forward guarantee; the bare per-peer transport was NOT used.
    expect(reliableCalls).toHaveLength(1);
    expect(reliableCalls[0].to).toBe('peer-1');
    expect(reliableCalls[0].opts).toEqual({ guarantee: 'hold-forward' });
    const data = reliableCalls[0].wire.parts[0].data;
    expect(data.subtype).toBe('chat-message');
    expect(data.body).toBe('hoi');
    expect(h.oneWayCalls).toHaveLength(0);              // did not fall back to transportFor
  });

  it('a HELD send (offline peer) reports ok — the DM is held, not lost', async () => {
    // hold-forward returns { held:true } rather than throwing when the peer is unreachable.
    const reliableSend = vi.fn(async () => ({ held: true, delivered: false, msgId: 'm2', pending: 1 }));
    const h = buildHarness({ reliableSend });

    const res = await h.ctrl.send({ toPubKey: 'peer-offline', threadId: 't1', body: 'later', subtype: 'chat-message' });
    expect(res.ok).toBe(true);                          // held counts as sent (flushes on reconnect)
  });

  it('falls back to the bare per-peer transport when no reliableSend is injected (unchanged)', async () => {
    const h = buildHarness();                           // no reliableSend override
    await h.ctrl.send({ toPubKey: 'peer-1', threadId: 't1', body: 'hoi', subtype: 'chat-message' });
    expect(h.oneWayCalls).toHaveLength(1);              // the pre-Wave-B path
    expect(h.oneWayCalls[0].toPubKey).toBe('peer-1');
  });
});

describe('the attachment fetch route answers only the post\'s audience', () => {
  const post = { id: 'item-1', addedBy: 'urn:me', source: { attachments: [{ id: 'att-1', ref: 'r1', mime: 'image/jpeg', bytes: 3 }] } };
  const ask = (h, from) => h.messageHandlers[0]({
    from, parts: [{ type: 'DataPart', data: { type: 'p2p-chat', subtype: 'attachment-request', itemId: 'item-1', attId: 'att-1', fromWebid: from } }],
  });
  const responses = (h) => h.oneWayCalls.filter((c) => c.env.parts[0].data.subtype === 'attachment-response');
  const support = (extra = {}) => ({
    dataSource: { read: async () => new Uint8Array([1, 2, 3]), write: async () => {} },
    attachmentSupport: { attachmentPath: () => 'p', readAttachmentBytesB64: async () => 'AQID', maxBytesPerAttachment: 250_000, ...extra },
  });

  it('without an audience check the author serves no one (fail closed)', async () => {
    const h = buildHarness(support());
    h.itemStore.getById.mockResolvedValue(post);
    await ask(h, 'stranger');
    expect(responses(h)).toEqual([]);
  });

  it('with one, a requester in the audience gets the bytes, anyone else nothing', async () => {
    const mayServe = vi.fn(async (item, requester) => requester === 'member-pub');
    const h = buildHarness(support({ mayServe }));
    h.itemStore.getById.mockResolvedValue(post);
    await ask(h, 'stranger');
    expect(responses(h)).toEqual([]);
    await ask(h, 'member-pub');
    expect(responses(h).map((c) => c.toPubKey)).toEqual(['member-pub']);
    expect(mayServe).toHaveBeenCalledWith(post, 'member-pub');
  });
});
