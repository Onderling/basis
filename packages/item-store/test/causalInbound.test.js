/**
 * Objective L (+ unified Lamport clock #33) — causal inbound merge end-to-end through wireCircleStoreInbound +
 * CircleItemStore.put({origin}). Replaces v0 last-received-wins: a peer's OLDER edit (lower `clock`) no longer
 * clobbers a newer local one just because it arrived later; a NEWER inbound wins; concurrent edits converge
 * deterministically regardless of arrival order. Ordering is by the per-(device, circle) Lamport `clock`, not the
 * wall clock — a LOCAL write ticks (counter+1); an ORIGIN ingest maxes the local counter on the incoming clock.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { wireCircleStoreInbound } from '../src/circleStoreInbound.js';

function fakeEnvelope() {
  const subs = [];
  return {
    subscribe({ kind, callback }) { const e = { kind, callback }; subs.push(e); return () => { const i = subs.indexOf(e); if (i >= 0) subs.splice(i, 1); }; },
    emit(kind, envelope) { for (const s of subs.slice()) if (s.kind === kind) s.callback(envelope); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const PREFIX = '/household/circles/c1/items/';
const mk = () => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c1/' });
// A peer's payload as it arrives on the wire: it carries the ORIGIN's Lamport `clock` (+ writer id + a display updatedAt).
const item = (clock, updatedBy, extra = {}) =>
  ({ id: 'T1', type: 'task', text: 'x', clock, updatedAt: '2026-05-01T00:00:00.000Z', updatedBy, ...extra });

describe('CircleItemStore — LOCAL write stamps a Lamport clock (tick-on-write)', () => {
  it('successive local writes carry strictly increasing clocks', async () => {
    const store = mk();
    const a = await store.put({ id: 'A', type: 'task', text: 'a' }, { by: 'me', sync: false });
    const b = await store.put({ id: 'B', type: 'task', text: 'b' }, { by: 'me', sync: false });
    const c = await store.put({ id: 'A', type: 'task', text: 'a2' }, { by: 'me', sync: false });   // re-edit A
    expect(a.clock).toBe(1);
    expect(b.clock).toBe(2);
    expect(c.clock).toBe(3);   // a re-edit out-clocks everything seen
  });
});

describe('CircleItemStore.put({ origin:true }) — causal ingest', () => {
  it('preserves the origin clock/updatedAt/updatedBy instead of re-stamping', async () => {
    const store = mk();
    const stored = await store.put(item(7, 'alice'), { origin: true, sync: false });
    expect(stored.clock).toBe(7);                                // origin Lamport clock preserved
    expect(stored.updatedAt).toBe('2026-05-01T00:00:00.000Z');   // display clock preserved
    expect(stored.updatedBy).toBe('alice');
  });

  it('MAX-ON-RECEIVE: a local write after ingesting a higher clock out-clocks it', async () => {
    const store = mk();
    await store.put(item(42, 'alice'), { origin: true, sync: false });   // receive clock 42
    const local = await store.put({ id: 'L', type: 'task', text: 'mine' }, { by: 'me', sync: false });
    expect(local.clock).toBe(43);   // counter advanced to max(local, 42) then ticked
  });

  it('a causally OLDER inbound does NOT overwrite a newer local edit', async () => {
    const store = mk();
    await store.put(item(10, 'alice', { text: 'newer-local' }), { origin: true, sync: false });
    const res = await store.put(item(3, 'bob', { text: 'stale-peer' }), { origin: true, sync: false });
    expect(res.text).toBe('newer-local');                         // returned the kept local
    expect((await store.get('T1')).text).toBe('newer-local');     // and did not clobber
  });

  it('a causally NEWER inbound wins', async () => {
    const store = mk();
    await store.put(item(1, 'alice', { text: 'old-local' }), { origin: true, sync: false });
    await store.put(item(10, 'bob', { text: 'newer-peer' }), { origin: true, sync: false });
    expect((await store.get('T1')).text).toBe('newer-peer');
  });

  it('a clockless payload still ingests + replaces (last-received-wins)', async () => {
    const store = mk();
    await store.put({ id: 'T1', type: 'task', text: 'first' }, { origin: true, sync: false });
    await store.put({ id: 'T1', type: 'task', text: 'second', completedAt: 9 }, { origin: true, sync: false });
    const got = await store.get('T1');
    expect(got.text).toBe('second');
    expect(got.completedAt).toBe(9);
  });
});

describe('wireCircleStoreInbound — causal, arrival-order independent', () => {
  it('OLD-then-NEW and NEW-then-OLD converge to the SAME (newer) survivor', async () => {
    const older = { ref: `${PREFIX}T1`, payload: item(1, 'alice', { text: 'older' }) };
    const newer = { ref: `${PREFIX}T1`, payload: item(9, 'bob',   { text: 'newer' }) };

    const s1 = mk(); const e1 = fakeEnvelope();
    wireCircleStoreInbound({ notifyEnvelope: e1, store: s1, prefix: PREFIX });
    e1.emit('household-item', older); await tick();
    e1.emit('household-item', newer); await tick();

    const s2 = mk(); const e2 = fakeEnvelope();
    wireCircleStoreInbound({ notifyEnvelope: e2, store: s2, prefix: PREFIX });
    e2.emit('household-item', newer); await tick();   // reversed arrival order
    e2.emit('household-item', older); await tick();

    expect((await s1.get('T1')).text).toBe('newer');
    expect((await s2.get('T1')).text).toBe('newer');   // same result regardless of arrival order
  });

  it('concurrent edits (equal clock, different writer) converge deterministically either order', async () => {
    const alice = { ref: `${PREFIX}T1`, payload: item(5, 'alice', { text: 'A' }) };
    const bob   = { ref: `${PREFIX}T1`, payload: item(5, 'bob',   { text: 'B' }) };

    const s1 = mk(); const e1 = fakeEnvelope();
    wireCircleStoreInbound({ notifyEnvelope: e1, store: s1, prefix: PREFIX });
    e1.emit('household-item', alice); await tick();
    e1.emit('household-item', bob);   await tick();

    const s2 = mk(); const e2 = fakeEnvelope();
    wireCircleStoreInbound({ notifyEnvelope: e2, store: s2, prefix: PREFIX });
    e2.emit('household-item', bob);   await tick();
    e2.emit('household-item', alice); await tick();

    const r1 = (await s1.get('T1')).text;
    const r2 = (await s2.get('T1')).text;
    expect(r1).toBe(r2);       // deterministic convergence
    expect(r1).toBe('B');      // writer-id tiebreak: 'bob' > 'alice'
  });
});
