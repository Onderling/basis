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
import { claim } from '../src/taskLifecycle.js';
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
