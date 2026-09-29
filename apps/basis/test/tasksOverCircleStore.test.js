/**
 * On the bot, a task on a list IS the tasks engine's task: one store per circle, the engine's verbs over it.
 *
 * Found probing the household template (2026-09-29): a task added to Klusjes through the lists ops landed in the
 * household circle's store, while the tasks engine ran its primary circle as `cc-default` — another circle, another
 * store — so `listOpen` never saw the task and `claimTask` could not reach it. An "engine" is verbs, not storage: the
 * box now runs the tasks engine in the household circle (`tasksCircleId`), so the lists' store is the engine's.
 * Composed as the box composes it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';

const nodes = [];
afterAll(() => teardown(nodes));

describe('a task on a list, and the tasks engine', () => {
  it('a task added to Klusjes is listed, claimed and completed by the tasks engine', async () => {
    const node = await bootRealAgentNode('bot', { taskLane: true, agentOpts: { tasksCircleId: 'household' } });
    nodes.push(node);
    const call = (a, o, x) => node.agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: call, t: (k) => ({ 'circle.lists.template.chores': 'Klusjes' }[k] ?? k.split('.').pop()) });
    const add = await call('lists', 'addToList', { list: 'Klusjes', text: 'band plakken' });
    expect(add).toMatchObject({ ok: true, kind: 'task' });
    const open = await call('tasks', 'listOpen', {});
    expect((open?.items ?? []).map((t) => t.id), 'the engine sees the list\'s task').toContain(add.itemId);
    const claim = await call('tasks', 'claimTask', { id: add.itemId });
    expect(claim?.error, JSON.stringify(claim)).toBeUndefined();
    const done = await call('tasks', 'completeTask', { id: add.itemId });
    expect(done?.error, JSON.stringify(done)).toBeUndefined();
  }, 90_000);
});
