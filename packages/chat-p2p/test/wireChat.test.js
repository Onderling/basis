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
    expect(res).toEqual({ ok: true, itemId: 'id-0' });

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

  it('send() persists the byte-identical chat-message item (+ actor)', async () => {
    const h = buildHarness();
    await h.ctrl.send({ toPubKey: 'peer-1', threadId: 't1', body: 'hoi', subtype: 'chat-message' });

    expect(h.addItemsCalls).toHaveLength(1);
    const { drafts, opts } = h.addItemsCalls[0];
    expect(drafts).toHaveLength(1);
    const item = drafts[0];
    const wireData = h.oneWayCalls[0].env.parts[0].data;

    // The persisted draft — verbatim pre-fold shape.
    expect(item.type).toBe('chat-message');
    expect(item.text).toBe('hoi');
    expect(item.visibility).toBe('household');
    expect(Object.keys(item.source)).toEqual([
      'threadId', 'fromWebid', 'fromStableId', 'toWebid', 'toPubKey', 'sentAt', 'nonce',
    ]);
    expect(item.source).toEqual({
      threadId:     't1',
      fromWebid:    'urn:me',
      fromStableId: 'me-stable',
      toWebid:      null,
      toPubKey:     'peer-1',
      sentAt:       wireData.sentAt,   // wire + storage stay consistent
      nonce:        wireData.nonce,
    });
    // Attribution actor unchanged.
    expect(opts).toEqual({ actor: 'urn:me' });
  });

  it('dedup is one shared set: an echo of my own outbound nonce is deduped on receive', async () => {
    const h = buildHarness();
    await h.ctrl.send({ toPubKey: 'peer-1', threadId: 't1', body: 'hoi', subtype: 'chat-message' });
    const myNonce = h.oneWayCalls[0].env.parts[0].data.nonce;
    expect(h.items).toHaveLength(1);

    // A relay echoes my own message back with the SAME nonce → deduped (no dup).
    await h.messageHandlers[0]({
      from: 'peer-pub',
      parts: [{ type: 'DataPart', data: {
        type: 'p2p-chat', subtype: 'chat-message', threadId: 't1',
        body: 'hoi', fromWebid: 'urn:me', nonce: myNonce,
      }}],
    });
    expect(h.items).toHaveLength(1);   // still 1 — shared seenNonces caught it

    // A genuinely new inbound nonce still persists.
    await h.messageHandlers[0]({
      from: 'peer-pub',
      parts: [{ type: 'DataPart', data: {
        type: 'p2p-chat', subtype: 'chat-message', threadId: 't1',
        body: 'echt nieuw', fromWebid: 'urn:peer', nonce: 'other-nonce',
      }}],
    });
    expect(h.items).toHaveLength(2);
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

  it('carries caller extras onto the wire byte-for-byte (contact-add-request)', async () => {
    const h = buildHarness();
    await h.ctrl.send({
      toPubKey: 'peer-1', subtype: 'contact-add-request',
      extras: { handle: 'ada', trustOffer: 'bekend' },
    });
    const data = h.oneWayCalls[0].env.parts[0].data;
    expect(data.subtype).toBe('contact-add-request');
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
    expect(res).toEqual({ ok: true, itemId: 'id-0' });

    // The reliable sender got the SAME wire the bare transport would have (byte-identical),
    // plus the hold-forward guarantee; the bare per-peer transport was NOT used.
    expect(reliableCalls).toHaveLength(1);
    expect(reliableCalls[0].to).toBe('peer-1');
    expect(reliableCalls[0].opts).toEqual({ guarantee: 'hold-forward' });
    const data = reliableCalls[0].wire.parts[0].data;
    expect(data.subtype).toBe('chat-message');
    expect(data.body).toBe('hoi');
    expect(h.oneWayCalls).toHaveLength(0);              // did not fall back to transportFor
    expect(h.addItemsCalls).toHaveLength(1);            // still persisted the outbound turn
  });

  it('a HELD send (offline peer) still persists the turn and reports ok — the DM is not lost', async () => {
    // hold-forward returns { held:true } rather than throwing when the peer is unreachable.
    const reliableSend = vi.fn(async () => ({ held: true, delivered: false, msgId: 'm2', pending: 1 }));
    const h = buildHarness({ reliableSend });

    const res = await h.ctrl.send({ toPubKey: 'peer-offline', threadId: 't1', body: 'later', subtype: 'chat-message' });
    expect(res.ok).toBe(true);                          // held counts as sent (flushes on reconnect)
    expect(res.itemId).toBe('id-0');
    expect(h.addItemsCalls).toHaveLength(1);            // the turn is durable locally
  });

  it('falls back to the bare per-peer transport when no reliableSend is injected (unchanged)', async () => {
    const h = buildHarness();                           // no reliableSend override
    await h.ctrl.send({ toPubKey: 'peer-1', threadId: 't1', body: 'hoi', subtype: 'chat-message' });
    expect(h.oneWayCalls).toHaveLength(1);              // the pre-Wave-B path
    expect(h.oneWayCalls[0].toPubKey).toBe('peer-1');
  });
});
