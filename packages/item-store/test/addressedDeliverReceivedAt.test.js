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
