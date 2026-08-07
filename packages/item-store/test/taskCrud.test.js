/**
 * PLAN-capabilities-tasks-roles step 1 — the task CRUD + query surface as
 * functions-over-CircleItemStore (companion to `taskLifecycle.test.js`).
 *
 * Proves BEHAVIOURAL PARITY with `ItemStore`'s CRUD ops: where practical each
 * case runs the SAME input against BOTH stores and asserts the SAME outcome.
 *
 * Covers: addTasks materialise + DAG cycle rejection (side-by-side vs
 * ItemStore.addItems on the same cyclic input); listOpen/listClosed partition +
 * filter; update forbidden-field guard; removeItems + its gate.
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';

import { ItemStore } from '../src/ItemStore.js';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { detectCycle } from '../src/dag.js';
import {
  addTasks, listOpen, listClosed, getById, update, removeItems,
} from '../src/taskCrud.js';
import { claim, markComplete } from '../src/taskLifecycle.js';
import { PermissionDeniedError, ItemNotFoundError } from '../src/errors.js';

const ROOT = 'pod://circle/';
const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

const mkCis = () => new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
const mkIs  = (opts = {}) => new ItemStore({ dataSource: new MemorySource(), rootContainer: ROOT, ...opts });

// ── addTasks: materialise + defaults ─────────────────────────────────────────

describe('addTasks — materialise + defaults', () => {
  it('assigns id + createdBy/createdAt + master-default (= actor) and returns the item', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'fix the tap' }], { actor: ANNE });
    expect(typeof t.id).toBe('string');
    expect(t.type).toBe('task');           // defaulted
    expect(t.text).toBe('fix the tap');
    expect(t.master).toBe(ANNE);           // master defaults to the actor (parity)
    expect(t.createdBy).toBe(ANNE);        // CircleItemStore base metadata (put-stamped)
    expect(typeof t.createdAt).toBe('string');
    // persisted + readable back through the ported reader.
    expect((await getById(store, t.id)).text).toBe('fix the tap');
  });

  it('preserves optional fields + copies dependency/skill arrays (parity with #materialise)', async () => {
    const store = mkCis();
    const deps = ['x'];
    const [t] = await addTasks(store, [{
      text: 'work', type: 'task', dependencies: deps, requiredSkills: ['plumbing'],
      approval: 'creator', master: BOB, dueAt: 123,
    }], { actor: ANNE });
    expect(t.dependencies).toEqual(['x']);
    expect(t.dependencies).not.toBe(deps);            // copied, not aliased
    expect(t.requiredSkills).toEqual(['plumbing']);
    expect(t.approval).toBe('creator');
    expect(t.master).toBe(BOB);                       // explicit master wins over the actor-default
    expect(t.dueAt).toBe(123);
  });

  it('rejects a non-object / text-less partial (parity with #validatePartial)', async () => {
    const store = mkCis();
    await expect(addTasks(store, [{ text: '   ' }], { actor: ANNE })).rejects.toBeInstanceOf(TypeError);
    await expect(addTasks(store, [null], { actor: ANNE })).rejects.toBeInstanceOf(TypeError);
  });

  it('requires ctx.actor', async () => {
    const store = mkCis();
    await expect(addTasks(store, [{ text: 'x' }], {})).rejects.toBeInstanceOf(TypeError);
  });

  it('gates canAdd (denial → PermissionDeniedError)', async () => {
    const store = mkCis();
    await expect(
      addTasks(store, [{ text: 'x' }], { actor: ANNE, rolePolicy: { canAdd: () => false } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('fires the item-added named event + the publish-on-write sync hook', async () => {
    const store = mkCis();
    const fanned = [];
    const named = [];
    store.setSyncHook({ publishItem: (it) => fanned.push(it.id) });
    const [t] = await addTasks(store, [{ text: 'x' }], { actor: ANNE, emit: (n) => named.push(n) });
    expect(fanned).toContain(t.id);
    expect(named).toEqual(['item-added']);
  });
});

// ── addTasks: DAG cycle rejection (side-by-side parity) ──────────────────────

describe('addTasks — DAG cycle check (the guard ItemStore-consumers used)', () => {
  it('rejects a dependency cycle with code DEPENDENCY_CYCLE', async () => {
    const store = mkCis();
    // Seed `a` depending on the id we are about to mint for `b`, then add `b`
    // depending on `a` → a → b → a cycle.
    const [a] = await addTasks(store, [{ id: 'a', text: 'a' }], { actor: ANNE });
    await update(store, a.id, { dependencies: ['b'] }, { actor: ANNE });   // a → b
    let err;
    try {
      await addTasks(store, [{ id: 'b', text: 'b', dependencies: ['a'] }], { actor: ANNE });   // b → a
    } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.code).toBe('DEPENDENCY_CYCLE');
    expect(err.cycle).toEqual(expect.arrayContaining(['a', 'b']));
    // The cyclic task was NOT written.
    expect(await getById(store, 'b')).toBeNull();
  });

  it('rejects a self-cycle (task depends on itself)', async () => {
    const store = mkCis();
    await expect(
      addTasks(store, [{ id: 'self', text: 'x', dependencies: ['self'] }], { actor: ANNE }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });
  });

  it('allows an acyclic dependency', async () => {
    const store = mkCis();
    await addTasks(store, [{ id: 'dep', text: 'first' }], { actor: ANNE });
    const [t] = await addTasks(store, [{ id: 'main', text: 'second', dependencies: ['dep'] }], { actor: ANNE });
    expect(t.dependencies).toEqual(['dep']);
  });

  it('PARITY: the SAME cyclic graph trips `detectCycle` over an ItemStore AND makes addTasks throw', async () => {
    // The class-ItemStore world ran this exact guard (detectCycle over listOpen)
    // in its add-skill. Build the same two-node cyclic graph in an ItemStore and
    // confirm the guard fires there too — proving addTasks preserves it.
    const is = mkIs();
    const [a] = await is.addItems([{ type: 'task', text: 'a' }], { actor: 'sys' });
    const [b] = await is.addItems([{ type: 'task', text: 'b', dependencies: [a.id] }], { actor: 'sys' });
    await is.update(a.id, { dependencies: [b.id] }, { actor: 'sys' });         // close the loop a → b → a
    const isOpen = await is.listOpen();
    const isCycle = detectCycle({ id: a.id, dependencies: [b.id] }, isOpen);
    expect(isCycle).not.toBeNull();                                            // guard fires on ItemStore data

    // CircleItemStore side: addTasks runs the identical detectCycle guard.
    const cis = mkCis();
    await addTasks(cis, [{ id: 'a', text: 'a' }], { actor: ANNE });
    await update(cis, 'a', { dependencies: ['b'] }, { actor: ANNE });
    let cisCode;
    try { await addTasks(cis, [{ id: 'b', text: 'b', dependencies: ['a'] }], { actor: ANNE }); }
    catch (e) { cisCode = e.code; }
    expect(cisCode).toBe('DEPENDENCY_CYCLE');
  });
});

// ── listOpen / listClosed: partition + filter parity ─────────────────────────

describe('listOpen / listClosed — partition + filter parity', () => {
  it('partitions by completedAt (open = no completedAt; closed = has it)', async () => {
    const store = mkCis();
    await addTasks(store, [{ id: 'o1', text: 'open one' }, { id: 'c1', text: 'closed one' }], { actor: ANNE });
    await claim(store, 'c1', { actor: BOB });
    await markComplete(store, [{ id: 'c1' }], { actor: BOB });

    const open = await listOpen(store);
    const closed = await listClosed(store);
    expect(open.map((i) => i.id)).toEqual(['o1']);
    expect(closed.map((i) => i.id)).toEqual(['c1']);
  });

  it('honours an assignee filter (incl. null = unassigned)', async () => {
    const store = mkCis();
    await addTasks(store, [{ id: 'u', text: 'unassigned' }, { id: 'a', text: 'assigned' }], { actor: ANNE });
    await claim(store, 'a', { actor: BOB });

    expect((await listOpen(store, { assignee: BOB })).map((i) => i.id)).toEqual(['a']);
    expect((await listOpen(store, { assignee: null })).map((i) => i.id)).toEqual(['u']);
  });

  it('honours a requiredSkill filter', async () => {
    const store = mkCis();
    await addTasks(store, [
      { id: 'p', text: 'pipe', requiredSkills: ['plumbing'] },
      { id: 'e', text: 'wire', requiredSkills: ['electrics'] },
    ], { actor: ANNE });
    expect((await listOpen(store, { requiredSkill: 'plumbing' })).map((i) => i.id)).toEqual(['p']);
  });

  it('PARITY: ItemStore + CircleItemStore return the same open/closed partition for the same data', async () => {
    // ItemStore side.
    const is = mkIs();
    const [io] = await is.addItems([{ type: 'task', text: 'open' }], { actor: 'sys' });
    const [ic] = await is.addItems([{ type: 'task', text: 'closed' }], { actor: 'sys' });
    await is.markComplete([{ id: ic.id }], { actor: BOB });

    // CircleItemStore side, same shape.
    const cis = mkCis();
    await addTasks(cis, [{ id: 'open', text: 'open' }], { actor: ANNE });
    await addTasks(cis, [{ id: 'closed', text: 'closed' }], { actor: ANNE });
    await markComplete(cis, [{ id: 'closed' }], { actor: BOB });

    expect((await is.listOpen()).map((i) => i.text).sort()).toEqual((await listOpen(cis)).map((i) => i.text).sort());
    expect((await is.listClosed()).map((i) => i.text).sort()).toEqual((await listClosed(cis)).map((i) => i.text).sort());
    void io;
  });
});

// ── update: forbidden-field guard + merge ────────────────────────────────────

describe('update — forbidden-field guard + LWW merge', () => {
  it('edits an allowed body field (text) and preserves the rest', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'old', dueAt: 1 }], { actor: ANNE });
    const res = await update(store, t.id, { text: 'new' }, { actor: ANNE });
    expect(res.text).toBe('new');
    expect(res.dueAt).toBe(1);
    expect(res.master).toBe(ANNE);         // untouched
  });

  it.each([
    ['parentTaskId', { parentTaskId: 'p2' }],
    ['id', { id: 'other' }],
    ['assignee', { assignee: BOB }],
    ['completedAt', { completedAt: 1 }],
    ['master', { master: BOB }],
    ['reviewLog', { reviewLog: [] }],
    ['approval', { approval: 'creator' }],
    ['type', { type: 'offer' }],
    ['createdBy', { createdBy: BOB }],
  ])('rejects a patch touching the immutable field %s', async (_name, patch) => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'x' }], { actor: ANNE });
    await expect(update(store, t.id, patch, { actor: ANNE })).rejects.toBeInstanceOf(TypeError);
  });

  it('throws ItemNotFoundError for a missing id', async () => {
    const store = mkCis();
    await expect(update(store, 'nope', { text: 'x' }, { actor: ANNE })).rejects.toBeInstanceOf(ItemNotFoundError);
  });

  it('gates canEditBody (denial → PermissionDeniedError)', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'x' }], { actor: ANNE });
    await expect(
      update(store, t.id, { text: 'y' }, { actor: ANNE, rolePolicy: { canEditBody: () => false } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('PARITY: the SAME forbidden field is rejected by BOTH ItemStore.update and update()', async () => {
    const is = mkIs();
    const [it] = await is.addItems([{ type: 'task', text: 'x' }], { actor: 'sys' });
    let isThrew = false;
    try { await is.update(it.id, { parentTaskId: 'p' }, { actor: 'sys' }); } catch { isThrew = true; }

    const cis = mkCis();
    const [ct] = await addTasks(cis, [{ text: 'x' }], { actor: ANNE });
    let cisThrew = false;
    try { await update(cis, ct.id, { parentTaskId: 'p' }, { actor: ANNE }); } catch { cisThrew = true; }

    expect(isThrew).toBe(true);
    expect(cisThrew).toBe(true);
  });
});

// ── removeItems: resolve → delete + gate ─────────────────────────────────────

describe('removeItems — resolve → delete + canRemove gate', () => {
  it('deletes resolved refs and returns the removed ids', async () => {
    const store = mkCis();
    await addTasks(store, [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }], { actor: ANNE });
    const removed = await removeItems(store, [{ id: 'r1' }, 'r2'], { actor: ANNE });
    expect(removed.sort()).toEqual(['r1', 'r2']);
    expect(await getById(store, 'r1')).toBeNull();
    expect(await getById(store, 'r2')).toBeNull();
  });

  it('skips a missing ref (no throw, not in the returned ids)', async () => {
    const store = mkCis();
    await addTasks(store, [{ id: 'r1', text: 'a' }], { actor: ANNE });
    const removed = await removeItems(store, [{ id: 'ghost' }, { id: 'r1' }], { actor: ANNE });
    expect(removed).toEqual(['r1']);
  });

  it('gates canRemove (denial → PermissionDeniedError, item survives)', async () => {
    const store = mkCis();
    await addTasks(store, [{ id: 'r1', text: 'a' }], { actor: ANNE });
    await expect(
      removeItems(store, [{ id: 'r1' }], { actor: ANNE, rolePolicy: { canRemove: () => false } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await getById(store, 'r1')).not.toBeNull();
  });

  it('fires the item-removed named event', async () => {
    const store = mkCis();
    await addTasks(store, [{ id: 'r1', text: 'a' }], { actor: ANNE });
    const events = [];
    await removeItems(store, [{ id: 'r1' }], { actor: ANNE, emit: (n, p) => events.push([n, p.id]) });
    expect(events).toEqual([['item-removed', 'r1']]);
  });

  it('PARITY: ItemStore.removeItems + removeItems both return the removed id', async () => {
    const is = mkIs();
    const [it] = await is.addItems([{ type: 'task', text: 'x' }], { actor: 'sys' });
    const isRemoved = await is.removeItems([{ id: it.id }], { actor: 'sys' });

    const cis = mkCis();
    await addTasks(cis, [{ id: 'x', text: 'x' }], { actor: ANNE });
    const cisRemoved = await removeItems(cis, [{ id: 'x' }], { actor: ANNE });

    expect(isRemoved).toEqual([it.id]);
    expect(cisRemoved).toEqual(['x']);
  });
});
