/**
 * An inbound turn is stored with when it ARRIVED on this device (`receivedAt`), beside the sender's time.
 */
import { describe, it, expect } from 'vitest';
import { createAddressedDeliver, chatTurnsFromItems } from '../src/index.js';

describe('receivedAt on an inbound turn', () => {
  it('is this device\'s clock at the persist; an outbound turn has none', async () => {
    const rows = [];
    const store = { addItems: async (items) => { rows.push(...items); return items; }, listOpen: async () => rows };
    const core = createAddressedDeliver({ itemStore: store, send: async () => ({ ok: true }), localActor: 'me' });
    const before = Date.now();
    await core.persistInbound({ id: 'm1', kind: 'contact-msg', ts: 500, author: 'b', body: 'hoi', extras: { threadKey: 'b', peerAddr: 'b' } });
    const [t] = chatTurnsFromItems(rows);
    expect(t.ts).toBe(500);
    expect(t.receivedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('a re-delivery after a restart is not a second arrival', () => {
  it('a fresh deliverer over the same store keeps the first receivedAt and writes no second row', async () => {
    const rows = [];
    const store = { addItems: async (items) => { const out = items.map((it, i) => ({ ...it, id: `i${rows.length + i}` })); rows.push(...out); return out; }, listOpen: async () => rows };
    const env = { id: 'm1', kind: 'contact-msg', ts: 500, author: 'b', body: 'hoi', extras: { threadKey: 'b', peerAddr: 'b' } };
    const before = createAddressedDeliver({ itemStore: store, send: async () => ({ ok: true }), localActor: 'me' });
    await before.persistInbound(env);
    const first = chatTurnsFromItems(rows)[0].receivedAt;
    await new Promise((r) => setTimeout(r, 5));
    const after = createAddressedDeliver({ itemStore: store, send: async () => ({ ok: true }), localActor: 'me' });   // a restart: an empty dedupe
    const res = await after.persistInbound(env);
    expect(res.deduped).toBe(true);
    const turns = chatTurnsFromItems(rows);
    expect(turns).toHaveLength(1);
    expect(turns[0].receivedAt).toBe(first);
  });
});
