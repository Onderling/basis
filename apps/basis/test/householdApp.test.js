/**
 * Household app over the circle store (cluster L · L3) — the FAITHFUL dissolve: household's real ops + model
 * (typed lists shopping/errand/repair/schedule + tasks, completedAt, match-by-text), only the store changed.
 * Exercised through createHouseholdService's callSkill, per circle.
 */
import { describe, it, expect } from 'vitest';
import { createHouseholdService, householdRegistry } from '../src/v2/householdApp.js';

const ctx = (circleId, by = 'webid:alice') => ({ circleId, by });

describe('household app over the circle store (L3 faithful dissolve)', () => {
  it('typed lists: addItem → listOpen → markComplete (by match) → removed from open', async () => {
    const svc = createHouseholdService();
    const c = ctx('c1');
    await svc.callSkill('addItem', { type: 'shopping', text: 'milk' }, c);
    await svc.callSkill('addItem', { type: 'shopping', text: 'bread' }, c);
    await svc.callSkill('addItem', { type: 'errand', text: 'post office' }, c);

    expect((await svc.callSkill('listOpenItems', { type: 'shopping' }, c)).map((i) => i.text).sort()).toEqual(['bread', 'milk']);
    expect((await svc.callSkill('listOpenItems', { type: 'errand' }, c)).map((i) => i.text)).toEqual(['post office']);

    const done = await svc.callSkill('markComplete', { match: 'milk' }, c);
    expect(done.ok).toBe(true);
    expect(done.item.completedAt).toBeGreaterThan(0);
    expect((await svc.callSkill('listOpenItems', { type: 'shopping' }, c)).map((i) => i.text)).toEqual(['bread']);  // milk gone from open
  });


  it('removeItem by match', async () => {
    const svc = createHouseholdService();
    const c = ctx('c1');
    await svc.callSkill('addItem', { type: 'repair', text: 'leaky tap' }, c);
    expect((await svc.callSkill('removeItem', { match: 'leaky' }, c)).ok).toBe(true);
    expect(await svc.callSkill('listOpenItems', { type: 'repair' }, c)).toEqual([]);

  });

  it('per-circle isolation + not-found + the registry rejects an unregistered list type', async () => {
    const svc = createHouseholdService();
    await svc.callSkill('addItem', { type: 'shopping', text: 'in A' }, ctx('A'));
    expect(await svc.callSkill('listOpenItems', { type: 'shopping' }, ctx('B'))).toEqual([]);   // isolated
    expect((await svc.callSkill('markComplete', { match: 'nope' }, ctx('A'))).ok).toBe(false);
    // 'bogus' isn't a registered type → store validation rejects
    await expect(svc.callSkill('addItem', { type: 'bogus', text: 'x' }, ctx('A'))).rejects.toThrow(/invalid "bogus"/);
  });

  it('householdRegistry registers the 4 list types (+ canonical task available)', async () => {
    const reg = householdRegistry();
    expect(reg.validate({ type: 'shopping', text: 'x', id: '1', createdAt: '2026-01-01T00:00:00Z', createdBy: 'a' }).ok).toBe(true);
    expect(reg.validate({ type: 'errand',   text: 'x', id: '1', createdAt: '2026-01-01T00:00:00Z', createdBy: 'a' }).ok).toBe(true);
  });
});

/**
 * §1b — callCapability: invoke by (atom × noun) instead of a bespoke op-id (PLAN-capability-arc §1b).
 * Bespoke-first: a pair a real op implements routes THROUGH that op (identical to callSkill); a noun that
 * merely DECLARES an atom with no op falls back to the generic store-backed CRUD — "declare a noun → get
 * CRUD free" — live on the same per-circle CircleItemStore, with zero handler code.
 */
describe('household callCapability — atom-dispatch over the live service (§1b)', () => {
  it('a declared noun with a bespoke op routes THROUGH the op (bespoke-first, no generic)', async () => {
    const svc = createHouseholdService();
    const c = ctx('c1');

    const added = await svc.callCapability('add', 'shopping', { text: 'milk' }, c);
    expect(added).toMatchObject({ ok: true, via: 'op', opId: 'addItem' });        // routed to household's own op
    expect((await svc.callSkill('listOpenItems', { type: 'shopping' }, c)).map((i) => i.text)).toEqual(['milk']);  // really stored

    const done = await svc.callCapability('complete', 'shopping', { match: 'milk' }, c);
    expect(done).toMatchObject({ ok: true, via: 'op', opId: 'markComplete' });
    expect(await svc.callSkill('listOpenItems', { type: 'shopping' }, c)).toEqual([]);

    // adding a task is not household's (the tasks app's addTask is): the noun declares no 'add'
    expect(await svc.callCapability('add', 'task', { text: 'fix fence' }, c)).toMatchObject({ ok: false, code: 'unimplemented' });
    expect(await svc.callCapability('create', 'shopping', { text: 'eggs' }, c)).toMatchObject({ ok: true, via: 'op', opId: 'addItem' }); // alias
  });

  it('declare a noun → get CRUD free: a declared-but-unimplemented noun is served by the generic handler', async () => {
    // `note` is a canonical type (registered) that household ships NO ops for — DECLARE it in the manifest
    // with CRUD atoms and the generic handler serves it, unwritten.
    const manifest = { app: 'household', itemTypes: ['note'], nouns: { note: { atoms: ['add', 'list', 'get', 'remove'] } }, operations: [] };
    const svc = createHouseholdService({ manifest });
    const c = ctx('c1');

    const added = await svc.callCapability('add', 'note', { body: 'buy stamps' }, c);
    expect(added).toMatchObject({ ok: true, via: 'generic', atom: 'add' });
    expect(added.result.item).toMatchObject({ type: 'note', body: 'buy stamps', createdBy: 'webid:alice' });
    const id = added.result.item.id;

    expect((await svc.callCapability('list', 'note', {}, c)).result.items.map((i) => i.id)).toContain(id);
    expect((await svc.callCapability('get', 'note', { id }, c)).result.item.body).toBe('buy stamps');
    expect((await svc.callCapability('remove', 'note', { id }, c)).result).toEqual({ ok: true, id });
    expect((await svc.callCapability('list', 'note', {}, c)).result.items).toEqual([]);
  });

  it('an undeclared/unimplemented capability is reported, never silently stored; scope is required', async () => {
    const svc = createHouseholdService();
    expect(await svc.callCapability('add', 'ghost', {}, ctx('c1'))).toMatchObject({ ok: false, code: 'unimplemented' });
    await expect(svc.callCapability('add', 'shopping', { text: 'x' }, {})).rejects.toThrow(/circleId/);
  });
});
