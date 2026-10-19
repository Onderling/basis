/**
 * A circle item written through the FREE atoms (a noun declared, no op) rides the circle's signed lane like an op's
 * write. Before, the generic branch never wired the circle's publish valve, so such a write stayed on the writer's
 * device unless some other op had opened that circle first — true in a running shell, false on a fresh boot.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from './support/pairRealAgents.js';

const CIRCLE = 'notes-circle';
describe('a generic circle note', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });
  it('crosses to the other member with no other op first', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A', { taskLane: true }), bootRealAgentNode('B', { taskLane: true })]);
    await connectAgentsOverBus(A, B);
    const shell = B._routerRef.fn;
    B._routerRef.fn = (env) => { try { if (B.agent.householdSync.handleInbound(env?.from, env?.payload)) return; } catch { /* */ } return shell?.(env); };
    await pairCircle(A, B, { groupId: CIRCLE, name: 'Briefjes', handle: 'bee' });
    const made = await A.agent.callSkill('household', encodeGenericOpId('household', 'add', 'note'), { circleId: CIRCLE, body: 'Briefje' });
    expect(made?.ok).not.toBe(false);
    const seen = async () => {
      const r = await B.agent.callSkill('household', encodeGenericOpId('household', 'list', 'note'), { circleId: CIRCLE });
      return (r?.result?.items ?? r?.items ?? []).find((n) => n.body === 'Briefje') ?? null;
    };
    await until(seen, { timeout: 12_000, step: 200 }).catch(() => null);
    expect(await seen(), 'the note reached the other member').not.toBe(null);
  }, 60_000);
});
