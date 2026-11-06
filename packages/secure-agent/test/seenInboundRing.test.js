/**
 * The durable inbound record (seenInbound.js): what it keeps, for how long, how much, and what it never says.
 */
import { describe, it, expect } from 'vitest';
import { RETAIN, RETENTION_DEFAULTS } from '@onderling/item-store';
import { VaultMemory } from '@onderling/vault';
import { createSeenInboundRing, seenInboundWindowMs, SEEN_INBOUND_CAP } from '../src/seenInbound.js';
import { createSecureAgent } from '../src/createSecureAgent.js';

function memStore() {
  const rows = new Map();
  return { rows, read: async (uri) => rows.get(uri) ?? null, write: async (uri, v) => { rows.set(uri, v); } };
}

describe('the durable inbound record', () => {
  it('its age window IS the table\'s short window — one number, read from one place', () => {
    expect(seenInboundWindowMs()).toBe(RETENTION_DEFAULTS[RETAIN.SHORT]);
    const ring = createSeenInboundRing({ store: memStore() });
    expect(ring.windowMs).toBe(RETENTION_DEFAULTS[RETAIN.SHORT]);
    expect(ring.cap).toBe(SEEN_INBOUND_CAP);
  });

  it('survives a restart through its store, and never stores a key in the clear', async () => {
    const store = memStore();
    const first = createSeenInboundRing({ store });
    await first.add('anna\u0000turn-1');
    await first.flush();
    const saved = [...store.rows.values()].join('');
    expect(saved).not.toContain('anna');
    expect(saved).not.toContain('turn-1');

    const second = createSeenInboundRing({ store });
    expect(await second.has('anna\u0000turn-1')).toBe(true);
    expect(await second.has('anna\u0000turn-2')).toBe(false);
  });

  it('forgets a message older than the window, at load and on ask', async () => {
    const store = memStore();
    let t = 1_000_000_000_000;
    const ring = createSeenInboundRing({ store, now: () => t });
    await ring.add('k');
    await ring.flush();
    t += seenInboundWindowMs() + 2_000;
    expect(await ring.has('k')).toBe(false);
    const reloaded = createSeenInboundRing({ store, now: () => t });
    expect(await reloaded.ready).toBe(0);
  });

  it('holds at most its cap; the oldest go first', async () => {
    const ring = createSeenInboundRing({ store: memStore(), cap: 3 });
    for (const k of ['a', 'b', 'c', 'd']) await ring.add(k);
    expect(ring.size()).toBe(3);
    expect(await ring.has('a')).toBe(false);
    expect(await ring.has('d')).toBe(true);
  });

  it('a store that cannot be read starts empty instead of failing the agent', async () => {
    const ring = createSeenInboundRing({ store: { read: async () => { throw new Error('locked'); }, write: async () => {} } });
    expect(await ring.ready).toBe(0);
    expect(await ring.has('x')).toBe(false);
  });

  it('the secure agent keeps it in the store it is handed, and flushes it on shutdown', async () => {
    const store = memStore();
    const handlers = {};
    const tx = {
      address: 'fake.addr', useSecurityLayer() {}, on(e, fn) { handlers[e] = fn; },
      async connect() {}, async disconnect() {}, async sendHello() {}, async sendOneWay() { return { ok: true }; },
    };
    const seen = [];
    const sa = await createSecureAgent({ vault: new VaultMemory(), seenInboundStore: store, onPeerMessage: (env) => { seen.push(env.payload.msgId); } });
    await sa.addSecureTransport('relay', tx);
    await handlers.envelope({ _from: 'anna', _id: 'f1', _p: 'OW', payload: { subtype: 'x', msgId: 'm1' } });
    await sa.shutdown();
    expect(store.rows.size, 'nothing written by shutdown').toBe(1);
    const again = createSeenInboundRing({ store });
    expect(await again.has('anna\u0000m1')).toBe(true);
    expect(seen).toEqual(['m1']);
  });
});
