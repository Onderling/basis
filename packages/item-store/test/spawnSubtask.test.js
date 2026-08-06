/**
 * spawnSubtask — the STRUCTURAL step. Proves the canonical subtask verb establishes the item-store
 * CONTAINMENT edge (contains/containedBy — the same tree treeOf renders and shareContainerTree walks), NOT
 * tasks-v0's immutable `parentTaskId` field, and wires the parent's `dependencies[]` so the DAG gate holds
 * the parent `waiting` until the subtask completes. The authority gate (assignee/master/admin via
 * ctx.rolePolicy) is a separate later step — this one is authz-independent by design (establish + prove parity).
 */
import { describe, it, expect } from 'vitest';

import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { spawnSubtask, isAssignee } from '../src/taskLifecycle.js';
import { childIdsOf, parentsOf } from '../src/containment.js';
import { computeDagStatus } from '../src/dag.js';
import { treeOf } from '../src/embeds.js';

const ROOT = 'mem://circles/c/';
const newStore = () => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: ROOT });
const ANNE = 'webid:anne';
const BOB  = 'webid:bob';

describe('spawnSubtask — structural containment + DAG gate (no parentTaskId)', () => {
  it('creates a child CONTAINED by the parent (contains + containedBy), master=spawner, depth 1', async () => {
    const store = newStore();
    const parent = await store.put({ type: 'task', text: 'ship it', createdBy: ANNE });
    const { task: child, depth } = await spawnSubtask(store, parent.id, { text: 'write tests' }, { actor: ANNE });

    expect(childIdsOf(await store.get(parent.id))).toContain(child.id);   // parent → child (contains)
    expect(await parentsOf(store, child.id)).toEqual([parent.id]);        // child → parent (containedBy)
    expect(child.parentTaskId).toBeUndefined();                          // NOT the old flat field
    expect(child.master).toBe(ANNE);
    expect(child.text).toBe('write tests');
    expect(depth).toBe(1);
  });

  it('wires the parent dependencies so the DAG gate holds it waiting until the subtask completes', async () => {
    const store = newStore();
    const parent = await store.put({ type: 'task', text: 'parent', createdBy: ANNE });
    const { task: child } = await spawnSubtask(store, parent.id, { text: 'sub' }, { actor: ANNE });

    const fresh = await store.get(parent.id);
    expect(fresh.dependencies).toContain(child.id);
    // computeDagStatus reads dependencies[]: an OPEN subtask ⇒ parent is not ready.
    expect(computeDagStatus(fresh, [child], [])).not.toBe('ready');
  });

  it('appears under the parent in treeOf', async () => {
    const store = newStore();
    const parent = await store.put({ type: 'task', text: 'root', createdBy: ANNE });
    const { task: child } = await spawnSubtask(store, parent.id, { text: 'leaf' }, { actor: ANNE });
    const tree = await treeOf({ rootId: parent.id, getItem: (id) => store.get(id) });
    expect(JSON.stringify(tree)).toContain(child.id);
  });

  it('deepens the containment depth for a nested spawn', async () => {
    const store = newStore();
    const p = await store.put({ type: 'task', text: 'p', createdBy: ANNE });
    const { task: c1 } = await spawnSubtask(store, p.id, { text: 'c1' }, { actor: ANNE });
    const { task: c2, depth } = await spawnSubtask(store, c1.id, { text: 'c2' }, { actor: ANNE });
    expect(depth).toBe(2);                                  // p(0) → c1(1) → c2(2)
    expect(await parentsOf(store, c2.id)).toEqual([c1.id]);
  });

  // @guard the subtask-spawn gate bites — only an authorized actor can spawn under a parent
  it('the capability gate BITES — canSpawnSubtask=false throws; =true lets the authorized actor through', async () => {
    const store = newStore();
    const parent = await store.put({ type: 'task', text: 'p', createdBy: ANNE, assignees: [ANNE] });

    // A rolePolicy that DENIES → a PermissionDeniedError, and NO child is created.
    const deny = { canSpawnSubtask: () => false };
    await expect(spawnSubtask(store, parent.id, { text: 'nope' }, { actor: BOB, rolePolicy: deny }))
      .rejects.toThrow(/permission|denied/i);
    expect(childIdsOf(await store.get(parent.id))).toEqual([]);

    // The real item-relative rule (assignee/master + role): the parent's assignee is allowed, a stranger is not.
    const policy = {
      canSpawnSubtask: (actor, p) => isAssignee(p, actor) || (p?.master ?? p?.addedBy) === actor,
    };
    await expect(spawnSubtask(store, parent.id, { text: 'nope' }, { actor: BOB, rolePolicy: policy }))
      .rejects.toThrow(/permission|denied/i);
    const { task } = await spawnSubtask(store, parent.id, { text: 'ok' }, { actor: ANNE, rolePolicy: policy });
    expect(task.text).toBe('ok');
  });

  it('refuses a completed parent and requires an actor', async () => {
    const store = newStore();
    const done = await store.put({ type: 'task', text: 'done', completedAt: Date.now(), createdBy: ANNE });
    await expect(spawnSubtask(store, done.id, { text: 'x' }, { actor: ANNE })).rejects.toThrow();
    const open = await store.put({ type: 'task', text: 'open', createdBy: ANNE });
    await expect(spawnSubtask(store, open.id, { text: 'x' }, {})).rejects.toThrow();   // no actor
  });
});
