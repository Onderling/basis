/**
 * Hold queue — the slot key (`opts.holdKey`).
 *
 * A catch-up request is re-issued every boot; one held for an offline peer is made pointless by the next.
 * Without a slot they stacked per (peer, lane, circle) up to the per-peer cap, and a peer back after a week
 * met all of them at once — each answered with a full batch. With the slot the newest supersedes.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '../src/createSecureAgent.js';

const HOLD = { firstSendTimeoutMs: 200, retryDelays: [], guarantee: 'hold-forward' };
const DEAD = 'dead-peer-address-0000000000000000000000000';
const agent = (opts = {}) => createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, ...opts });

describe('hold queue — slot keys', () => {
  it('the same holdKey supersedes: one held, the newest', async () => {
    const a = await agent();
    const first  = await a.peer.sendTo(DEAD, { subtype: 'x-request', frontier: 1 }, { ...HOLD, holdKey: 'x:c1' });
    const second = await a.peer.sendTo(DEAD, { subtype: 'x-request', frontier: 2 }, { ...HOLD, holdKey: 'x:c1' });
    expect(first.held).toBe(true);
    expect(second).toMatchObject({ held: true, deduped: false });
    expect(a.heldFor(DEAD)).toBe(1);
    await a.shutdown();
  });

  it('different holdKeys are different slots', async () => {
    const a = await agent();
    await a.peer.sendTo(DEAD, { subtype: 'x-request' }, { ...HOLD, holdKey: 'x:c1' });
    await a.peer.sendTo(DEAD, { subtype: 'x-request' }, { ...HOLD, holdKey: 'x:c2' });
    await a.peer.sendTo(DEAD, { subtype: 'y-request' }, { ...HOLD, holdKey: 'y:c1' });
    expect(a.heldFor(DEAD)).toBe(3);
    await a.shutdown();
  });

  it('a message id still dedupes (a repeat is the SAME message, not a newer one)', async () => {
    const a = await agent();
    await a.peer.sendTo(DEAD, { msgId: 'm1', text: 'hoi' }, HOLD);
    const again = await a.peer.sendTo(DEAD, { msgId: 'm1', text: 'hoi' }, HOLD);
    expect(again.deduped).toBe(true);
    expect(a.heldFor(DEAD)).toBe(1);
    await a.shutdown();
  });

  it('without either, every send is its own hold (unchanged)', async () => {
    const a = await agent();
    await a.peer.sendTo(DEAD, { subtype: 'x-request' }, HOLD);
    await a.peer.sendTo(DEAD, { subtype: 'x-request' }, HOLD);
    expect(a.heldFor(DEAD)).toBe(2);
    await a.shutdown();
  });

  it('a non-string holdKey is ignored, not a crash', async () => {
    const a = await agent();
    await a.peer.sendTo(DEAD, { subtype: 'x-request' }, { ...HOLD, holdKey: 42 });
    await a.peer.sendTo(DEAD, { subtype: 'x-request' }, { ...HOLD, holdKey: '' });
    expect(a.heldFor(DEAD)).toBe(2);
    await a.shutdown();
  });
});

/**
 * A SLOT HOLD THAT CHANGES NOTHING WRITES NOTHING (ledger L1103, counted on the seeded Samsung 2026-11-22): every start
 * sends the boot catch-up requests again, one slot per lane, circle and member; a member who is not there gets each one
 * held, and each superseded its own identical slot and rewrote the whole outbox. The same payload under the same slot is
 * now the same hold: kept as it is (its age too), nothing written. A different payload still supersedes.
 */
describe('hold queue — an unchanged slot', () => {
  const countingStore = () => {
    const s = { map: new Map(), writes: 0 };
    s.read = async (u) => (s.map.has(u) ? s.map.get(u) : null);
    s.write = async (u, b) => { s.writes += 1; s.map.set(u, String(b)); };
    return s;
  };
  it('the same payload under the same slot: deduped, no write, also after a restart', async () => {
    const store = countingStore();
    const a = await agent({ holdStore: store, holdStoreUri: 'mem://t/outbox.json' });
    await a.outboxRestored();
    await a.peer.sendTo(DEAD, { subtype: 'x-request', frontier: 7 }, { ...HOLD, holdKey: 'x:c1' });
    await a.outboxFlushed();
    const after1 = store.writes;
    const again = await a.peer.sendTo(DEAD, { subtype: 'x-request', frontier: 7 }, { ...HOLD, holdKey: 'x:c1' });
    await a.outboxFlushed();
    expect(again).toMatchObject({ held: true, deduped: true });
    expect(store.writes).toBe(after1);
    await a.shutdown();
    // THE NEXT START: the outbox restored, the boot sends the same request again
    const b = await agent({ holdStore: store, holdStoreUri: 'mem://t/outbox.json' });
    await b.outboxRestored();
    const before = store.writes;
    await b.peer.sendTo(DEAD, { subtype: 'x-request', frontier: 7 }, { ...HOLD, holdKey: 'x:c1' });
    await b.outboxFlushed();
    expect(b.heldFor(DEAD)).toBe(1);
    expect(store.writes, 'an unchanged slot at the next start wrote the outbox').toBe(before);
    // a CHANGED payload still supersedes, and is written
    await b.peer.sendTo(DEAD, { subtype: 'x-request', frontier: 8 }, { ...HOLD, holdKey: 'x:c1' });
    await b.outboxFlushed();
    expect(store.writes).toBeGreaterThan(before);
    await b.shutdown();
  }, 30_000);
});
