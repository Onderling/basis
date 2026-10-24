/**
 * Per-circle local-store scoping — the drift guard (PLAN-per-circle-store-scoping.md, Phase 5).
 * FAILS the moment two circles share a household store again.
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const texts = (r) => (Array.isArray(r?.items) ? r.items : []).map((i) => i.text ?? i.label);

describe('per-circle household store', () => {
  it('an item added in circle A is NOT visible in circle B (and IS in A)', async () => {
    const a = await createRealHouseholdAgent();
    await a.callSkill('household', 'addItem', { type: 'shopping', text: 'ZucchiniA', circleId: 'circle-A' });

    const inB = await a.callSkill('household', 'listOpenItems', { type: 'shopping', circleId: 'circle-B' });
    const inA = await a.callSkill('household', 'listOpenItems', { type: 'shopping', circleId: 'circle-A' });

    expect(texts(inB)).not.toContain('ZucchiniA');   // circle B is its own (empty) list
    expect(texts(inA)).toContain('ZucchiniA');        // circle A has it
  });

  it('two circles keep independent lists', async () => {
    const a = await createRealHouseholdAgent();
    await a.callSkill('household', 'addItem', { type: 'shopping', text: 'AppleA', circleId: 'c1' });
    await a.callSkill('household', 'addItem', { type: 'shopping', text: 'BananaB', circleId: 'c2' });

    expect(texts(await a.callSkill('household', 'listOpenItems', { type: 'shopping', circleId: 'c1' }))).toEqual(['AppleA']);
    expect(texts(await a.callSkill('household', 'listOpenItems', { type: 'shopping', circleId: 'c2' }))).toEqual(['BananaB']);
  });
});
