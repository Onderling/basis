import { describe, it, expect } from 'vitest';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { loadCircles } from '../../src/v2/circleModel.js';

const callSkill = async (op) => {
  if (op === 'getMyCircles') {
    return { circles: [{ circleId: 'c1', name: 'Circle', counts: { members: 3 } }] };
  }
  if (op === 'listMyCircles') {
    return { circles: ['selwerd', 'akkerstraat'] };
  }
  return null;
};

describe('circleSources', () => {
  it('fetchTasksCircles reads getMyCircles.circles', async () => {
    const s = circleSourcesFromAgent({ callSkill });
    expect(await s.fetchTasksCircles()).toHaveLength(1);
  });

  it('fetchGroups maps listMyCircles groupId strings to circle objects', async () => {
    const g = await circleSourcesFromAgent({ callSkill }).fetchGroups();
    expect(g.map((x) => x.id)).toEqual(['selwerd', 'akkerstraat']);
    expect(g[0].name).toBe('selwerd');
  });

  // REMOVED 2026-08-03 — this test proved the BRANCH while nothing proved the WIRING.
  //
  // It asserted `fetchCircles` appears when a `circlesStore` is passed and is omitted otherwise, using a
  // hand-made `{ list }` fake. Both halves passed. Meanwhile the real callers read `agent.circlesStore`,
  // which nothing has ever assigned — on any branch, in 4,422 commits — so in production the branch was
  // permanently `undefined` and the source silently never existed.
  //
  // That is the shape worth remembering: a green test over an injected fake says the code works IF something
  // calls it. It says nothing about whether anything does. The fake was the only caller it ever had.

  it('feeds loadCircles end-to-end (circles + circles merged + normalised)', async () => {
    const list = await loadCircles(circleSourcesFromAgent({ callSkill }));
    expect(list.map((c) => c.id).sort()).toEqual(['akkerstraat', 'c1', 'selwerd']);
    expect(list.find((c) => c.id === 'c1').memberCount).toBe(3);
  });

  it('tolerates a missing callSkill', async () => {
    const s = circleSourcesFromAgent({});
    expect(await s.fetchTasksCircles()).toEqual([]);
    expect(await s.fetchGroups()).toEqual([]);
  });
});

describe('makeResolvingCallSkill', () => {
  it('returns the first non-null result across origins, passing through op+args', async () => {
    const calls = [];
    const raw = async (app, op, args) => {
      calls.push([app, op]);
      return app === 'tasks' && op === 'getMyCircles' ? { circles: [], echoed: args.x } : null;
    };
    const resolve = makeResolvingCallSkill(raw, ['stoop', 'tasks', 'folio']);
    const res = await resolve('getMyCircles', { x: 7 });
    expect(res).toEqual({ circles: [], echoed: 7 });
    expect(calls).toEqual([['stoop', 'getMyCircles'], ['tasks', 'getMyCircles']]); // stopped at first hit
  });

  it('returns null when every origin yields null/throws or callSkill is missing', async () => {
    expect(await makeResolvingCallSkill(null)('op')).toBeNull();
    const raw = async () => { throw new Error('x'); };
    expect(await makeResolvingCallSkill(raw, ['stoop'])('op')).toBeNull();
  });
});
