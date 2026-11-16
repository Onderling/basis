import { describe, it, expect, vi } from 'vitest';
import { createRosterReadCache, ROSTER_READ_OPS } from '../../src/v2/rosterReadCache.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('rosterReadCache — one answer per (op, circle) per window', () => {
  it('six lanes asking for the same roster inside the window cost ONE read', async () => {
    let t = 1_000;
    const c = createRosterReadCache({ ttlMs: 5_000, now: () => t });
    const run = vi.fn(async () => ({ members: [{ webid: 'a' }] }));
    const answers = await Promise.all(Array.from({ length: 6 }, () =>
      c.read('listGroupMembers', { groupId: 'c1' }, run)));
    expect(run).toHaveBeenCalledTimes(1);
    for (const a of answers) expect(a.members[0].webid).toBe('a');
    t += 5_001;
    await c.read('listGroupMembers', { groupId: 'c1' }, run);
    expect(run).toHaveBeenCalledTimes(2);                  // the window is a window, not a memo
  });

  it('the spineless variant and the plain read are DIFFERENT answers (the verifier asks for a different shape)', async () => {
    const c = createRosterReadCache({ ttlMs: 5_000 });
    const run = vi.fn(async () => ({}));
    await c.read('listGroupMembers', { groupId: 'c1' }, run);
    await c.read('listGroupMembers', { groupId: 'c1', spineless: true }, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a write through the waist forgets everything; a non-roster read forgets nothing', async () => {
    const c = createRosterReadCache({ ttlMs: 5_000 });
    const run = vi.fn(async () => ({}));
    await c.read('listGroupRoster', { groupId: 'c1' }, run);
    await c.read('listMyCircles', {}, run);
    c.afterWrite('listFeed');
    expect(c.size).toBe(2);
    c.afterWrite('addMember');
    expect(c.size).toBe(0);
    await c.read('listGroupRoster', { groupId: 'c1' }, run);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('a membership statement landing for ONE circle clears that circle (and the circle list), not the others', async () => {
    const c = createRosterReadCache({ ttlMs: 5_000 });
    const run = vi.fn(async () => ({}));
    await c.read('listGroupMembers', { groupId: 'c1' }, run);
    await c.read('listGroupMembers', { groupId: 'c2' }, run);
    await c.read('listMyCircles', {}, run);
    c.invalidate('c1');
    await c.read('listGroupMembers', { groupId: 'c1' }, run);   // re-read
    await c.read('listGroupMembers', { groupId: 'c2' }, run);   // served
    await c.read('listMyCircles', {}, run);                       // re-read
    expect(run).toHaveBeenCalledTimes(5);
  });

  it('a failed read is not served for the window', async () => {
    const c = createRosterReadCache({ ttlMs: 5_000 });
    let n = 0;
    const run = vi.fn(async () => { n += 1; if (n === 1) throw new Error('bus down'); return { ok: true }; });
    await expect(c.read('listGroupMembers', { groupId: 'c1' }, run)).rejects.toThrow('bus down');
    await tick();
    await expect(c.read('listGroupMembers', { groupId: 'c1' }, run)).resolves.toEqual({ ok: true });
  });

  it('ops outside the three reads pass straight through', async () => {
    const c = createRosterReadCache();
    const run = vi.fn(async () => 'x');
    await c.read('joinGroup', { groupId: 'c1' }, run);
    await c.read('joinGroup', { groupId: 'c1' }, run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(ROSTER_READ_OPS).toEqual(['listGroupMembers', 'listGroupRoster', 'listMyCircles']);
  });
});

describe('a read in flight across an invalidation never keeps its answer', () => {
  const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
  it('(a) a join lands while a read is in flight → the next read shows the new member', async () => {
    const cache = createRosterReadCache({ ttlMs: 30_000 });
    let members = ['ann'];
    const slow = deferred();
    const first = cache.read('listGroupMembers', { groupId: 'g' }, async () => { const snap = [...members]; await slow.p; return { members: snap }; });
    members = ['ann', 'bot'];          // the join lands…
    cache.invalidate('g');             // …and clears the circle's window
    slow.resolve();
    await first;
    const next = await cache.read('listGroupMembers', { groupId: 'g' }, async () => ({ members: [...members] }));
    expect(next.members, 'the next read served the pre-join answer').toEqual(['ann', 'bot']);
  });
  it('(b) an evict lands while a read is in flight → the next read does not show the removed member', async () => {
    const cache = createRosterReadCache({ ttlMs: 30_000 });
    let members = ['ann', 'bob'];
    const slow = deferred();
    const first = cache.read('listGroupMembers', { groupId: 'g' }, async () => { const snap = [...members]; await slow.p; return { members: snap }; });
    members = ['ann'];
    cache.invalidate('g');
    slow.resolve();
    await first;
    const next = await cache.read('listGroupMembers', { groupId: 'g' }, async () => ({ members: [...members] }));
    expect(next.members, 'a removed member is still on the next read').toEqual(['ann']);
  });
  it('(c) …and when the invalidation comes BEFORE the slow read settles but a SECOND read joins it first', async () => {
    const cache = createRosterReadCache({ ttlMs: 30_000 });
    let members = ['ann', 'bob'];
    const slow = deferred();
    const first = cache.read('listGroupMembers', { groupId: 'g' }, async () => { const snap = [...members]; await slow.p; return { members: snap }; });
    const joined = cache.read('listGroupMembers', { groupId: 'g' }, async () => ({ members: ['never-run'] }));
    members = ['ann'];
    cache.invalidate('g');
    slow.resolve();
    await Promise.all([first, joined]);
    const next = await cache.read('listGroupMembers', { groupId: 'g' }, async () => ({ members: [...members] }));
    expect(next.members).toEqual(['ann']);
  });
});
