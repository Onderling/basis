/**
 * A third-party noun SYNCS like any other, with no per-type code: a plant added on one member's device crosses the
 * circle's signed lane into another member's store when that member runs the extension too. A member WITHOUT it holds
 * nothing of it — the type is unknown there (as any unknown type), and nothing is kept aside.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { bootRealAgentNode, connectNodesOverBus, pairCircle, joinExistingCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { plantsManifest } from '../../example-plants/manifest.js';

const CIRCLE = 'plant-circle';
const EXT = { extensions: [{ origin: 'plants', manifest: plantsManifest }] };
const op = (atom) => encodeGenericOpId('plants', atom, 'plants.plant');
const wireInbound = (node) => {
  const shell = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; } catch { /* the shell's router */ }
    return shell?.(env);
  };
};
const plantsOn = async (node) => {
  const r = await node.agent.callSkill('plants', op('list'), { circleId: CIRCLE });
  return (r?.result?.items ?? r?.items ?? []).filter((i) => i.type === 'plants.plant');
};
// what a member's circle store holds, whatever the type (household's open listing reads the store whole)
const rowsOn = async (node) => {
  const r = await node.agent.callSkill('household', 'listOpen', { circleId: CIRCLE }).catch(() => null);
  return r?.items ?? r?.result?.items ?? [];
};

describe('a third-party noun across the circle', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  it('crosses to a member with the extension; a member without it holds none of it', async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true, agentOpts: EXT }),
      bootRealAgentNode('B', { taskLane: true, agentOpts: EXT }),
      bootRealAgentNode('C', { taskLane: true }),
    ]);
    await connectNodesOverBus([A, B, C]);   // one bus for all three (two pairwise buses would replace A's transport)
    wireInbound(B); wireInbound(C);
    await pairCircle(A, B, { groupId: CIRCLE, name: 'Planten', handle: 'bee' });
    await joinExistingCircle(A, C, { groupId: CIRCLE, handle: 'cee' });
    await bindCircleAddresses([A, B, C], CIRCLE);   // as the shells do after a join

    const warn = vi.spyOn(console, 'warn');
    const made = await A.agent.callSkill('plants', op('add'), { circleId: CIRCLE, body: 'Monstera', waterAt: '2026-10-20T08:00:00.000Z' });
    await A.agent.callSkill('plants', op('add'), { circleId: CIRCLE, body: 'Ficus' });
    expect(made?.ok, JSON.stringify(made)).not.toBe(false);
    await until(async () => (await plantsOn(B)).find((p) => p.body === 'Monstera'), { timeout: 15_000, step: 100 });
    await until(async () => (await plantsOn(B)).length === 2, { timeout: 15_000, step: 100 });
    expect((await plantsOn(B)).map((p) => p.body).sort()).toEqual(['Ficus', 'Monstera']);
    // C runs no such extension: what A writes still reaches it (a note, beside the plant) — the plant's row does not land
    await A.agent.callSkill('household', encodeGenericOpId('household', 'add', 'note'), { circleId: CIRCLE, body: 'Briefje voor iedereen' });
    const noteOnC = async () => {
      const r = await C.agent.callSkill('household', encodeGenericOpId('household', 'list', 'note'), { circleId: CIRCLE });
      return (r?.result?.items ?? r?.items ?? []).find((n) => n.body === 'Briefje voor iedereen') ?? null;
    };
    await until(noteOnC, { timeout: 15_000, step: 100 }).catch(() => null);
    expect(await noteOnC(), 'C hears from A').not.toBe(null);
    expect((await rowsOn(C)).filter((r) => r?.type === 'plants.plant')).toEqual([]);
    // C says ONCE that it holds no such type (two plants arrived): the row stays on its log for the day it is installed
    const said = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"plants.plant"') && l.includes('not held here'));
    expect(said).toHaveLength(1);
    warn.mockRestore();
    // …and its plants ops do not exist there
    expect((await C.agent.callSkill('plants', op('list'), { circleId: CIRCLE }))?.ok).toBe(false);
  }, 60_000);
});
