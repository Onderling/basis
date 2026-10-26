/**
 * buildFindExtras — the shared find-result enrichment (used by web circleApp + mobile CircleLauncherScreen).
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildFindExtras } from '../src/findExtras.js';

describe('buildFindExtras', () => {
  it('returns empty extras for no query or no callSkill (guards)', async () => {
    expect(await buildFindExtras({ query: '', circleId: 'c', callSkill: async () => null })).toEqual({ offeringMatches: [] });
    expect(await buildFindExtras({ query: '   ', circleId: 'c', callSkill: async () => null })).toEqual({ offeringMatches: [] });
    expect(await buildFindExtras({ query: 'x', circleId: 'c' })).toEqual({ offeringMatches: [] }); // no callSkill
  });

  it('fetches the roster via the injected callSkill, and asks nothing else', async () => {
    const calls = [];
    const callSkill = async (op) => { calls.push(op); return { members: [] }; };
    const r = await buildFindExtras({ query: 'plumbing', circleId: 'c1', callSkill });
    expect(calls).toEqual(['listGroupMembers']);
    expect(r).toEqual({ offeringMatches: [] }); // no members → no matches
  });
});
