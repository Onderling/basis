/**
 * The claim router's hook, through the agent: a claim with a circle runs the hook (mirror the task into "Mijn dingen")
 * and answers the claim. Web sets the hook; its claims threw "args is not defined" (found 2026-09-30), because the
 * hook's call read a variable the reply adapter does not have. Nothing tested the hook through the agent.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const nodes = [];
afterAll(() => teardown(nodes));

describe('the claim hook, through the agent', () => {
  it('a claim with a circle answers ok and hands the hook the task and the circle', async () => {
    const node = await bootRealAgentNode('claim-hook');
    nodes.push(node);
    const seen = [];
    node.agent.setAfterClaimHook(async (e) => { seen.push(e); });
    const added = await node.agent.callSkill('tasks', 'addTask', { text: 'ladder terugbrengen', circleId: 'c-1' });
    const id = added?.itemId ?? added?.task?.id;
    expect(id, JSON.stringify(added)).toBeTruthy();
    const claimed = await node.agent.callSkill('tasks', 'claimTask', { id, circleId: 'c-1' });
    expect(claimed, JSON.stringify(claimed)).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([expect.objectContaining({ circleId: 'c-1', task: expect.objectContaining({ id }) })]);
  }, 90_000);
});
