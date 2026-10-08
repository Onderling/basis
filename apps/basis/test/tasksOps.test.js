/**
 * The task noun's verbs over the circle's ONE store (the bot's chores), beside `listsOps` and the bot's calendar ops —
 * not a separate tasks agent. The same op ids and the same answers the tasks agent gave (the door's reply shaping
 * reads them): a host serves several people through one key, so the host's key is the authority and the person the
 * call is for (`actor`) is who the chore records — who added it, who holds it, who completed it.
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';
import { CircleItemStore } from '@onderling/item-store';
import { buildStandardRolePolicy } from '@onderling-app/tasks';
import { makeTasksOps } from '../src/v2/tasksOps.js';

const HOST = 'HOST-KEY';
function ops() {
  const stores = new Map();
  const storeFor = (id) => {
    if (!stores.has(id)) stores.set(id, new CircleItemStore({ dataSource: new MemorySource(), rootContainer: `pod://${id}/` }));
    return stores.get(id);
  };
  const tasks = makeTasksOps({ storeFor, activeCircle: () => 'household', hostActor: HOST, rolePolicy: buildStandardRolePolicy({ [HOST]: 'admin' }) });
  return { tasks, store: storeFor('household') };
}

describe('makeTasksOps — chores over the circle\'s store', () => {
  it('add, claim as a person, mine, complete — recorded as that person, in the household store', async () => {
    const { tasks, store } = ops();
    const { task } = await tasks.addTask({ text: 'ramen lappen', actor: 'telegram:7' });
    expect(task).toMatchObject({ type: 'task', text: 'ramen lappen', actor: 'telegram:7' });
    expect((await store.listByType('task')).map((t) => t.id)).toContain(task.id);

    const { result } = await tasks.claimTask({ id: task.id, actor: 'telegram:7' });
    expect(result.assignees ?? [result.assignee]).toContain('telegram:7');

    expect((await tasks.listMine({ actor: 'telegram:7' })).items.map((t) => t.id)).toEqual([task.id]);
    expect((await tasks.listMine({ actor: 'telegram:9' })).items).toEqual([]);

    const done = await tasks.completeTask({ id: task.id, actor: 'telegram:7' });
    expect(done.task.completedAt).toBeTruthy();
    expect((await tasks.listOpen({})).items.map((t) => t.id)).not.toContain(task.id);
  });

  it('a chore records the PERSON as its last writer, not the host key — the authority facts unchanged', async () => {
    const { tasks, store } = ops();
    const { task } = await tasks.addTask({ text: 'lamp vervangen', actor: 'telegram:7' });
    const { result } = await tasks.claimTask({ id: task.id, actor: 'telegram:7' });
    expect(result.updatedBy, 'a claim is written by the claimant').toBe('telegram:7');
    // what decides a claim is not who wrote it last: the confirmation reads as it always did
    expect(result).toMatchObject({ confirmedAssignee: 'telegram:7', claimSeq: 1 });
    expect(result.confirmedBy).toBe((await store.get(task.id)).confirmedBy);
    expect(result.confirmedBy).not.toBe('telegram:7');

    const edited = await tasks.editTask({ id: task.id, text: 'lamp ophangen', actor: 'telegram:7' });
    expect((edited.task ?? edited).updatedBy, 'an edit').toBe('telegram:7');
    const moved = await tasks.reassignTask({ id: task.id, newAssignee: 'telegram:9', actor: 'telegram:7' });
    expect(moved.task.updatedBy, 'a reassign').toBe('telegram:7');
    const done = await tasks.completeTask({ id: task.id, actor: 'telegram:9' });
    expect(done.task.updatedBy, 'a completion').toBe('telegram:9');

    const { task: other } = await tasks.addTask({ text: 'ramen lappen', actor: 'telegram:7' });
    expect((await store.get(other.id)).updatedBy, 'an add').toBe('telegram:7');
    await tasks.removeTask({ id: other.id, actor: 'telegram:7' });
  });

  it('listOpen is the chores only — a list line or an appointment in the same store is not one', async () => {
    const { tasks, store } = ops();
    await store.put({ type: 'list-item', text: 'melk' });
    await store.put({ type: 'calendar-event', title: 'tandarts' });
    await tasks.addTask({ text: 'vuilnis' });
    expect((await tasks.listOpen({})).items.map((t) => t.text)).toEqual(['vuilnis']);
  });

  it('reassign, edit, remove answer as the tasks agent did', async () => {
    const { tasks } = ops();
    const { task } = await tasks.addTask({ text: 'stofzuigen' });
    const moved = await tasks.reassignTask({ id: task.id, newAssignee: 'telegram:9' });
    expect(moved.task.assignee).toBe('telegram:9');
    const edited = await tasks.editTask({ id: task.id, text: 'stofzuigen boven' });
    expect(edited.task.text).toBe('stofzuigen boven');
    expect(await tasks.editTask({ id: task.id })).toEqual({ error: 'no fields to update' });
    expect(await tasks.editTask({ id: 'nope', text: 'x' })).toEqual({ error: 'not-found' });
    expect(await tasks.removeTask({ id: task.id })).toEqual({ id: task.id });
    expect((await tasks.listOpen({})).items).toEqual([]);
  });

  it('a second claim of a held chore says so', async () => {
    const { tasks } = ops();
    const { task } = await tasks.addTask({ text: 'boodschappen' });
    await tasks.claimTask({ id: task.id, actor: 'telegram:7' });
    const second = await tasks.claimTask({ id: task.id, actor: 'telegram:9' });
    expect(JSON.stringify(second)).toMatch(/already-claimed|claimed|full/i);
  });
});
