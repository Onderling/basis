/**
 * Acting on behalf of someone — the authority and the attribution are two different strings.
 *
 * A host that serves several people through one key vouches for the person it acts for. The GATE reads the
 * key with authority (`ctx.actor`); what the item records about the person is the attribution:
 *   - `addTasks` carries a partial's `actor` (the person the task was added for) onto the item, while
 *     `addedBy` / `master` stay the authority's key;
 *   - `claim` with `ctx.onBehalfOf` gates on `ctx.actor` but puts the named person into the co-owner set,
 *     so "already claimed", co-ownership and every assignee reader compare PEOPLE, not the host's key.
 * Who may vouch is the caller's rule (the tasks engine allows only its host); this layer only keeps the
 * two strings apart.
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';

import { CircleItemStore } from '../src/CircleItemStore.js';
import { addTasks } from '../src/taskCrud.js';
import { claim, markComplete, submit, approve, reject, claimConfirmationStatement } from '../src/taskLifecycle.js';
import { PermissionDeniedError } from '../src/errors.js';

const ROOT = 'pod://circle/';
const HOST = 'https://id.example/host';
const ANN  = 'telegram:111';
const BO   = 'telegram:222';
const mkCis = () => new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });

/** A policy that knows the host (admin) and nobody else — a keyless contact has no role of its own. */
const hostOnly = { canAdd: (a) => a === HOST, canClaim: (a) => a === HOST };

describe('addTasks — actor rides on the item beside the authority', () => {
  it('the partial’s actor is stored; addedBy and master stay the authority key', async () => {
    const [t] = await addTasks(mkCis(), [{ text: 'bins out', actor: ANN }], { actor: HOST, rolePolicy: hostOnly });
    expect(t.actor).toBe(ANN);
    expect(t.addedBy).toBe(HOST);
    expect(t.master).toBe(HOST);
  });

  it('no actor on the partial → no actor field', async () => {
    const [t] = await addTasks(mkCis(), [{ text: 'bins out' }], { actor: HOST });
    expect('actor' in t).toBe(false);
  });
});

describe('claim — onBehalfOf: gate on the authority, record the person', () => {
  it('the host claims for Ann: Ann is the assignee and the confirmed claimant', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'dishes' }], { actor: HOST });
    const res = await claim(store, t.id, { actor: HOST, onBehalfOf: ANN, rolePolicy: hostOnly });
    expect(res.assignees).toEqual([ANN]);
    expect(res.assignee).toBe(ANN);
    expect(res.confirmedAssignee).toBe(ANN);
  });

  it('the gate still reads the authority: a denied authority is denied even when naming someone', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'dishes' }], { actor: HOST });
    await expect(claim(store, t.id, { actor: 'https://id.example/stranger', onBehalfOf: ANN, rolePolicy: hostOnly }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('a second person through the same host is a second claimant, not a repeat of the first', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'dishes', maxAssignees: 2 }], { actor: HOST });
    await claim(store, t.id, { actor: HOST, onBehalfOf: ANN, rolePolicy: hostOnly });
    const again = await claim(store, t.id, { actor: HOST, onBehalfOf: ANN, rolePolicy: hostOnly });
    expect(again.error).toBe('already-claimed');
    const bo = await claim(store, t.id, { actor: HOST, onBehalfOf: BO, rolePolicy: hostOnly });
    expect(bo.assignees).toEqual([ANN, BO]);
  });
});

describe('complete · submit · approve · reject — onBehalfOf: the item says who did it, the gate reads the key', () => {
  const policy = { canAdd: (a) => a === HOST, canClaim: (a) => a === HOST, canComplete: (a) => a === HOST,
    canSubmit: (a) => a === HOST, canApprove: (a) => a === HOST, canReject: (a) => a === HOST };
  const claimed = async (store, extra = {}) => {
    const [t] = await addTasks(store, [{ text: 'dishes', ...extra }], { actor: HOST });
    await claim(store, t.id, { actor: HOST, onBehalfOf: ANN, rolePolicy: policy });
    return t;
  };

  it('the host completes on Ann\'s word: completedBy is Ann, not the host (and not the host\'s display name)', async () => {
    const store = mkCis();
    const t = await claimed(store);
    const [done] = await markComplete(store, [{ id: t.id }], { actor: HOST, actorDisplayName: 'Huisbot', onBehalfOf: ANN, rolePolicy: policy });
    expect(done.completedBy).toBe(ANN);
    expect(done.completedByDisplayName).toBeUndefined();
  });

  it('without onBehalfOf nothing changes: completedBy is the key', async () => {
    const store = mkCis();
    const t = await claimed(store);
    const [done] = await markComplete(store, [{ id: t.id }], { actor: HOST, rolePolicy: policy });
    expect(done.completedBy).toBe(HOST);
  });

  it('the review log names the person on submit, reject and approve; approve\'s completedBy too', async () => {
    const store = mkCis();
    const t = await claimed(store);
    await submit(store, t.id, { note: 'gedaan' }, { actor: HOST, onBehalfOf: ANN, rolePolicy: policy });
    await reject(store, t.id, { note: 'nog niet' }, { actor: HOST, onBehalfOf: BO, rolePolicy: policy });
    await submit(store, t.id, {}, { actor: HOST, onBehalfOf: ANN, rolePolicy: policy });
    const ok = await approve(store, t.id, {}, { actor: HOST, onBehalfOf: BO, rolePolicy: policy });
    expect(ok.reviewLog.map((e) => [e.decision, e.by])).toEqual([
      ['submit', ANN], ['reject', BO], ['submit', ANN], ['approve', BO],
    ]);
    expect(ok.completedBy).toBe(BO);
  });

  it('the gate still reads the key: a denied key completes nothing, whoever it names', async () => {
    const store = mkCis();
    const t = await claimed(store);
    await expect(markComplete(store, [{ id: t.id }], { actor: 'https://id.example/stranger', onBehalfOf: ANN, rolePolicy: policy }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('the write records the PERSON as its writer; the authority facts do not move', () => {
  const sign = (msg) => `sig(${msg})`;
  it('a claim for Ann is written by Ann; the signed confirmation is the one it always was', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'dishes' }], { actor: HOST });
    const res = await claim(store, t.id, { actor: HOST, onBehalfOf: ANN, rolePolicy: hostOnly, sign });
    expect(res.updatedBy).toBe(ANN);
    expect((await store.get(t.id)).updatedBy).toBe(ANN);
    // the authority of the claim: who pre-delegated it, its sequence, and the signature over (task, claimant, at, seq)
    expect(res.confirmedBy).toBe(HOST);
    expect(res.claimSeq).toBe(1);
    expect(res.confirmedSig).toBe(sign(claimConfirmationStatement({
      taskId: t.id, confirmedAssignee: ANN, confirmedAt: res.confirmedAt, claimSeq: 1,
    })));
  });

  it('with nobody named the authority is the writer, as before', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'dishes' }], { actor: HOST });
    const res = await claim(store, t.id, { actor: HOST, rolePolicy: hostOnly });
    expect(res.updatedBy).toBe(HOST);
  });

  it('an add and a completion for Bo are written by Bo; the item\'s own addedBy stays the authority', async () => {
    const store = mkCis();
    const [t] = await addTasks(store, [{ text: 'bins out' }], { actor: HOST, onBehalfOf: BO, rolePolicy: hostOnly });
    expect(t.createdBy).toBe(BO);
    expect(t.addedBy).toBe(HOST);
    await claim(store, t.id, { actor: HOST, onBehalfOf: BO, rolePolicy: hostOnly });
    const [done] = await markComplete(store, [{ id: t.id }], { actor: HOST, onBehalfOf: BO });
    expect(done.updatedBy).toBe(BO);
  });
});
