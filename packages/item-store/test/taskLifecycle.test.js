/**
 * PLAN-capabilities-tasks-roles keystone (Option A) — the task lifecycle
 * VERBS as functions-over-CircleItemStore.
 *
 * Proves BEHAVIOURAL PARITY with `ItemStore`'s verbs: where practical each case
 * runs the SAME input against BOTH stores and asserts the SAME outcome
 * (side-by-side), so the port is verified against the original, not a fresh spec.
 *
 * Covers: claim CAS race (exactly one winner + `already-claimed`); reassign;
 * markComplete blocked by open deps then allowed (DAG gate); the
 * submit/approve/reject/revoke transitions; role-gate denials.
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';

import { ItemStore, computeStatus } from '../src/ItemStore.js';
import { CircleItemStore } from '../src/CircleItemStore.js';
import {
  claim, reassign, markComplete, submit, approve, reject, revoke, assigneesOf,
} from '../src/taskLifecycle.js';
import { listOpen } from '../src/taskCrud.js';
import { PermissionDeniedError, DependenciesOpenError, MissingArgumentError, InvalidLifecycleError } from '../src/errors.js';

const ROOT = 'pod://circle/';
const uriOf = (id) => `${ROOT}items/${id}.json`;

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

/** A CAS-capable "central pod": per-path etag + If-Match enforcement. */
function makeCasPodSource() {
  const store = new Map();
  let seq = 0;
  const nextEtag = () => `"etag-${++seq}"`;
  return {
    async read(path) { return store.get(path)?.data ?? null; },
    async readEtag(path) { return store.get(path)?.etag ?? null; },
    async write(path, data, opts = {}) {
      const cur = store.get(path);
      if (opts && opts.ifMatch != null && (cur?.etag ?? null) !== opts.ifMatch) {
        throw Object.assign(new Error('If-Match failed'), { code: 'CONFLICT', status: 412 });
      }
      const etag = nextEtag();
      store.set(path, { data, etag });
      return { etag };
    },
    async delete(path) { store.delete(path); },
    async list(prefix = '') { return [...store.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}

/** Seed a task directly (bypassing the verbs) into a CircleItemStore. */
async function seedTask(store, item) {
  return store.put({ type: 'task', ...item }, { by: 'sys' });
}

// ── claim: CAS race → exactly one winner ─────────────────────────────────────

describe('claim — CAS single-winner (Option A)', () => {
  it('two racers that BOTH read the unassigned task → exactly one wins, one already-claimed', async () => {
    const pod = makeCasPodSource();
    const store = new CircleItemStore({ dataSource: pod, rootContainer: ROOT });
    await seedTask(store, { id: 'shared', text: 'shared', assignee: null });

    // Snapshot the UNASSIGNED base (what a racing peer observed before either wrote).
    const staleData = await pod.read(uriOf('shared'));
    const staleEtag = await pod.readEtag(uriOf('shared'));

    // Anne claims for real (etag advances; assignee = anne).
    const anneRes = await claim(store, 'shared', { actor: ANNE });
    expect(anneRes.assignee).toBe(ANNE);

    // Bob races: he still observes the pre-claim snapshot (stale read) and threads
    // the stale base etag → the pod rejects his write (CONFLICT) → already-claimed.
    const realRead = pod.read.bind(pod);
    let served = false;
    pod.read = async (p) => {
      if (p === uriOf('shared') && !served) { served = true; return staleData; } // Bob's read-check
      return realRead(p);
    };
    const bobRes = await claim(store, 'shared', { actor: BOB, expectedEtag: staleEtag });
    pod.read = realRead;

    expect(bobRes.error).toBe('already-claimed');
    expect(bobRes.current.assignee).toBe(ANNE);           // re-read surfaces the winner

    // The pod holds exactly one winner.
    expect(JSON.parse(await pod.read(uriOf('shared'))).assignee).toBe(ANNE);
  });

  it('PARITY: an already-assigned task → same `already-claimed` shape as ItemStore', async () => {
    // ItemStore side.
    const is = new ItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    const [t] = await is.addItems([{ type: 'task', text: 't' }], { actor: 'sys' });
    await is.claim(t.id, { actor: ANNE });
    const isLoser = await is.claim(t.id, { actor: BOB });

    // CircleItemStore side (non-CAS MemorySource — read-check catches the assignee).
    const cis = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(cis, { id: 't', text: 't' });
    await claim(cis, 't', { actor: ANNE });
    const cisLoser = await claim(cis, 't', { actor: BOB });

    expect(isLoser.error).toBe('already-claimed');
    expect(cisLoser.error).toBe('already-claimed');
    expect(cisLoser.current.assignee).toBe(isLoser.current.assignee); // both = ANNE
  });

  it('claim sets assignee + claimedAt and fans out via the sync hook', async () => {
    const emitted = [];
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    store.setSyncHook({ publishItem: (it) => emitted.push(it.id) });
    await seedTask(store, { id: 'a', text: 'x' });     // one fan-out (the seed)
    const named = [];
    const res = await claim(store, 'a', { actor: ANNE, emit: (n) => named.push(n) });
    expect(res.assignee).toBe(ANNE);
    expect(typeof res.claimedAt).toBe('number');
    expect(emitted).toContain('a');                    // publish-on-write seam fired
    // A default (auto-confirm) task confirms the claim in the same step, so BOTH named events fire
    // (the master pre-delegated). The claim is CONFIRMED, not merely pending.
    expect(named).toEqual(['item-claimed', 'claim-confirmed']);
    expect(res.confirmedAssignee).toBe(ANNE);
  });
});

// ── co-ownership: assignees[] + maxAssignees (J2) ────────────────────────────

describe('claim — co-ownership (J2, maxAssignees > 1)', () => {
  const CARL = 'https://id.example/carl';

  it('a maxAssignees:2 task: two members BOTH claim → both in assignees[]; the mirror stays assignees[0]', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'co', text: 'shared chore', maxAssignees: 2 });

    const r1 = await claim(store, 'co', { actor: ANNE });
    expect(r1.assignees).toEqual([ANNE]);
    expect(r1.assignee).toBe(ANNE);              // mirror = assignees[0]

    const r2 = await claim(store, 'co', { actor: BOB });
    expect(r2.assignees).toEqual([ANNE, BOB]);   // CO-OWNED — appended, not overwritten
    expect(r2.assignee).toBe(ANNE);              // mirror unchanged (still first claimer)
  });

  it('a claim on a FULL set → already-claimed (same shape as the exclusive case)', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'co', text: 't', maxAssignees: 2 });
    await claim(store, 'co', { actor: ANNE });
    await claim(store, 'co', { actor: BOB });    // set now full (2/2)

    const third = await claim(store, 'co', { actor: CARL });
    expect(third.error).toBe('already-claimed');
    expect(third.current.assignees).toEqual([ANNE, BOB]);
  });

  it('BOTH co-owners see it in their "mine" set; ANY co-owner completes', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'co', text: 't', maxAssignees: 3 });
    await claim(store, 'co', { actor: ANNE });
    await claim(store, 'co', { actor: BOB });

    // listMine membership (what tasks-v0's listMineCore does).
    const open = await listOpen(store);
    const mineAnne = open.filter((t) => assigneesOf(t).includes(ANNE)).map((t) => t.id);
    const mineBob  = open.filter((t) => assigneesOf(t).includes(BOB)).map((t) => t.id);
    expect(mineAnne).toContain('co');
    expect(mineBob).toContain('co');

    // Any co-owner may complete — here the SECOND co-owner, not the mirror.
    const [done] = await markComplete(store, [{ id: 'co' }], { actor: BOB });
    expect(done.completedBy).toBe(BOB);
    expect(computeStatus(done)).toBe('complete');
  });

  it('SIDE-BY-SIDE J1 parity: a default (maxAssignees:1) task still rejects the 2nd claimer', async () => {
    // Co-ownable (maxAssignees:2) — 2nd claim SUCCEEDS.
    const coop = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(coop, { id: 'coop', text: 't', maxAssignees: 2 });
    await claim(coop, 'coop', { actor: ANNE });
    const coopSecond = await claim(coop, 'coop', { actor: BOB });
    expect(coopSecond.assignees).toEqual([ANNE, BOB]);   // no already-claimed

    // Default (no maxAssignees ⇒ 1) — 2nd claim REJECTED, exactly today's behaviour.
    const solo = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(solo, { id: 'solo', text: 't' });      // no maxAssignees
    const first = await claim(solo, 'solo', { actor: ANNE });
    expect(first.assignee).toBe(ANNE);
    expect(first.assignees).toEqual([ANNE]);
    const soloSecond = await claim(solo, 'solo', { actor: BOB });
    expect(soloSecond.error).toBe('already-claimed');
    expect(soloSecond.current.assignee).toBe(ANNE);      // mirror preserved
  });

  it('revoke with a target yanks ONE co-owner; the rest keep the task', async () => {
    const store = new CircleItemStore({ dataSource: makeCasPodSource(), rootContainer: ROOT });
    await seedTask(store, { id: 'co', text: 't', maxAssignees: 3, master: ANNE });
    await claim(store, 'co', { actor: ANNE });
    await claim(store, 'co', { actor: BOB });
    const res = await revoke(store, 'co', { reason: 'stepping down', assignee: ANNE }, { actor: ANNE });
    expect(res.assignees).toEqual([BOB]);      // ANNE removed
    expect(res.assignee).toBe(BOB);            // mirror re-points to new assignees[0]
    expect(computeStatus(res)).toBe('claimed');// still owned by BOB
  });
});

// ── reassign ─────────────────────────────────────────────────────────────────

describe('reassign', () => {
  it('reassigns to a new webid (claimBase records the superseded assignee)', async () => {
    const store = new CircleItemStore({ dataSource: makeCasPodSource(), rootContainer: ROOT });
    await seedTask(store, { id: 'r', text: 'r' });
    await claim(store, 'r', { actor: ANNE });
    const res = await reassign(store, 'r', BOB, { actor: ANNE });
    expect(res.assignee).toBe(BOB);
    expect(res.claimBase).toBe(ANNE);
  });

  it('releases (newAssignee null) → clears assignee + claimedAt', async () => {
    const store = new CircleItemStore({ dataSource: makeCasPodSource(), rootContainer: ROOT });
    await seedTask(store, { id: 'r', text: 'r' });
    await claim(store, 'r', { actor: ANNE });
    const res = await reassign(store, 'r', null, { actor: ANNE });
    expect(res.assignee).toBeUndefined();
    expect(res.claimedAt).toBeUndefined();
    expect(res.claimBase).toBe(ANNE);
  });
});

// ── markComplete + DAG dependency gate ────────────────────────────────

describe('markComplete — DAG dependency gate parity', () => {
  it('blocked by an open dependency, then allowed once the dep closes', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'dep', text: 'do first' });
    await seedTask(store, { id: 'main', text: 'do second', dependencies: ['dep'] });

    // Open dep → DependenciesOpenError (enforceDependencies on).
    await expect(
      markComplete(store, [{ id: 'main' }], { actor: ANNE, enforceDependencies: true }),
    ).rejects.toBeInstanceOf(DependenciesOpenError);

    // Close the dep, then the gate opens.
    await markComplete(store, [{ id: 'dep' }], { actor: ANNE, enforceDependencies: true });
    const [done] = await markComplete(store, [{ id: 'main' }], { actor: ANNE, enforceDependencies: true });
    expect(done.completedBy).toBe(ANNE);
    expect(typeof done.completedAt).toBe('number');
    expect(computeStatus(done)).toBe('complete');
  });

  it('PARITY: ItemStore + CircleItemStore both throw DEPENDENCIES_OPEN for the same graph', async () => {
    const mkIs = async () => {
      const s = new ItemStore({ dataSource: new MemorySource(), rootContainer: ROOT, enforceDependencies: true });
      const [dep]  = await s.addItems([{ type: 'task', text: 'first' }], { actor: 'sys' });
      const [main] = await s.addItems([{ type: 'task', text: 'second', dependencies: [dep.id] }], { actor: 'sys' });
      return { s, main };
    };
    const { s: is, main: isMain } = await mkIs();
    let isCode; try { await is.markComplete([{ id: isMain.id }], { actor: ANNE }); } catch (e) { isCode = e.code; }

    const cis = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(cis, { id: 'dep', text: 'first' });
    await seedTask(cis, { id: 'main', text: 'second', dependencies: ['dep'] });
    let cisCode; try { await markComplete(cis, [{ id: 'main' }], { actor: ANNE, enforceDependencies: true }); } catch (e) { cisCode = e.code; }

    expect(isCode).toBe('DEPENDENCIES_OPEN');
    expect(cisCode).toBe('DEPENDENCIES_OPEN');
  });

  it('actionOverride bypasses the dep gate (force-complete admin path)', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'dep', text: 'first' });
    await seedTask(store, { id: 'main', text: 'second', dependencies: ['dep'] });
    const [done] = await markComplete(store, [{ id: 'main' }], {
      actor: ANNE, enforceDependencies: true, actionOverride: 'force-complete',
    });
    expect(done.completedAt).toBeTruthy();
  });
});

// ── submit / approve / reject / revoke transitions ───────────────────────────

describe('DoD lifecycle transitions', () => {
  async function freshClaimed(id = 's') {
    const store = new CircleItemStore({ dataSource: makeCasPodSource(), rootContainer: ROOT });
    await seedTask(store, { id, text: 'task', approval: 'creator' });
    await claim(store, id, { actor: BOB });
    return store;
  }

  it('submit: claimed → submitted', async () => {
    const store = await freshClaimed();
    const res = await submit(store, 's', { note: 'ready' }, { actor: BOB });
    expect(computeStatus(res)).toBe('submitted');
    expect(res.reviewLog.at(-1).decision).toBe('submit');
  });

  it('approve: submitted → complete', async () => {
    const store = await freshClaimed();
    await submit(store, 's', {}, { actor: BOB });
    const res = await approve(store, 's', { note: 'ok' }, { actor: ANNE });
    expect(computeStatus(res)).toBe('complete');
    expect(res.completedBy).toBe(ANNE);
  });

  it('reject: submitted → rejected (mandatory note), then re-submit works', async () => {
    const store = await freshClaimed();
    await submit(store, 's', {}, { actor: BOB });
    await expect(reject(store, 's', {}, { actor: ANNE })).rejects.toBeInstanceOf(MissingArgumentError);
    const rej = await reject(store, 's', { note: 'redo it' }, { actor: ANNE });
    expect(computeStatus(rej)).toBe('rejected');
    const re = await submit(store, 's', { note: 'v2' }, { actor: BOB });
    expect(computeStatus(re)).toBe('submitted');
  });

  it('revoke: claimed → open (mandatory reason), master preserved', async () => {
    const store = new CircleItemStore({ dataSource: makeCasPodSource(), rootContainer: ROOT });
    await seedTask(store, { id: 'v', text: 'task', master: ANNE });
    await claim(store, 'v', { actor: BOB });
    await expect(revoke(store, 'v', {}, { actor: ANNE })).rejects.toBeInstanceOf(MissingArgumentError);
    const res = await revoke(store, 'v', { reason: 'reassigning' }, { actor: ANNE });
    expect(computeStatus(res)).toBe('open');
    expect(res.assignee).toBeUndefined();
    expect(res.master).toBe(ANNE);
  });

  it('approve on a non-submitted item → InvalidLifecycleError (state guard)', async () => {
    const store = await freshClaimed();   // claimed, not submitted
    await expect(approve(store, 's', {}, { actor: ANNE })).rejects.toBeInstanceOf(InvalidLifecycleError);
  });

  it('PARITY: submit→approve reaches `complete` on BOTH stores', async () => {
    // ItemStore path.
    const is = new ItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    const [t] = await is.addItems([{ type: 'task', text: 't', approval: 'creator' }], { actor: 'sys' });
    await is.claim(t.id, { actor: BOB });
    await is.submit(t.id, {}, { actor: BOB });
    const isDone = await is.approve(t.id, {}, { actor: ANNE });

    // CircleItemStore path, same sequence.
    const cis = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(cis, { id: 'c', text: 't', approval: 'creator' });
    await claim(cis, 'c', { actor: BOB });
    await submit(cis, 'c', {}, { actor: BOB });
    const cisDone = await approve(cis, 'c', {}, { actor: ANNE });

    expect(computeStatus(isDone)).toBe('complete');
    expect(computeStatus(cisDone)).toBe('complete');
    expect(cisDone.completedBy).toBe(isDone.completedBy);
  });
});

// ── role-gate denials ────────────────────────────────────────────────────────

describe('role gating (injected rolePolicy in ctx)', () => {
  const denyAll = { canClaim: () => false, canComplete: () => false, canApprove: () => false };

  it('claim denial throws PermissionDeniedError (same gate as ItemStore)', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'g', text: 'g' });
    await expect(claim(store, 'g', { actor: BOB, rolePolicy: denyAll })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('markComplete denial throws PermissionDeniedError', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'g', text: 'g' });
    await expect(markComplete(store, [{ id: 'g' }], { actor: BOB, rolePolicy: denyAll }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('PARITY: ItemStore + CircleItemStore both deny claim with PERMISSION_DENIED', async () => {
    const is = new ItemStore({ dataSource: new MemorySource(), rootContainer: ROOT, rolePolicy: denyAll });
    const [t] = await is.addItems([{ type: 'task', text: 't' }], { actor: 'sys' });
    let isCode; try { await is.claim(t.id, { actor: BOB }); } catch (e) { isCode = e.code; }

    const cis = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(cis, { id: 't', text: 't' });
    let cisCode; try { await claim(cis, 't', { actor: BOB, rolePolicy: denyAll }); } catch (e) { cisCode = e.code; }

    expect(isCode).toBe('PERMISSION_DENIED');
    expect(cisCode).toBe('PERMISSION_DENIED');
  });

  it('allow policy lets the action through', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await seedTask(store, { id: 'g', text: 'g' });
    const res = await claim(store, 'g', { actor: BOB, rolePolicy: { canClaim: () => true } });
    expect(res.assignee).toBe(BOB);
  });
});
