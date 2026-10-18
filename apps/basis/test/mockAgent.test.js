/**
 * basis — mock agent tests. v0.1 (web demo).
 */
import { describe, it, expect } from 'vitest';

import {
  createMockHouseholdAgent, mockHouseholdManifest,
} from '../src/core/agent/mockAgent.js';

describe('mockHouseholdManifest', () => {
  it('declares listOpen + markComplete with right surfaces', () => {
    const ops = Object.fromEntries(
      mockHouseholdManifest.operations.map((o) => [o.id, o]),
    );
    expect(ops.listOpen.verb).toBe('list');
    expect(ops.listOpen.surfaces.slash.command).toBe('/mine');
    expect(ops.listOpen.surfaces.chat.reply).toBe('list');
    expect(ops.markComplete.verb).toBe('complete');
    expect(ops.markComplete.surfaces.slash.command).toBe('/done');
    // (v0.7) added pickerSource — markComplete picks via listOpen.
    expect(ops.markComplete.params[0]).toEqual({
      name: 'choreId', kind: 'string', required: true,
      pickerSource: { listOp: 'listOpen' },
    });
  });
});

describe('createMockHouseholdAgent — listOpen', () => {
  it('returns 3 seed chores in open state', async () => {
    const a = createMockHouseholdAgent();
    const r = await a.callSkill('household', 'listOpen', {});
    expect(r.items.length).toBe(3);
    expect(r.items.map((c) => c.label).sort()).toEqual([
      'Bins out', 'Dishwasher', 'Vacuum living room',
    ]);
    expect(r.items.every((c) => c.state === 'open')).toBe(true);
  });

  it('omits chores marked complete', async () => {
    const a = createMockHouseholdAgent();
    await a.callSkill('household', 'markComplete', { choreId: 'c-1' });
    const r = await a.callSkill('household', 'listOpen', {});
    expect(r.items.length).toBe(2);
    expect(r.items.find((c) => c.id === 'c-1')).toBeUndefined();
  });
});

describe('createMockHouseholdAgent — markComplete', () => {
  it('flips a chore to done + returns ok:true with a message', async () => {
    const a = createMockHouseholdAgent();
    const r = await a.callSkill('household', 'markComplete', { choreId: 'c-2' });
    expect(r).toEqual({ ok: true, message: '✓ Done: Bins out', itemId: 'c-2' });
    const after = a.state().find((c) => c.id === 'c-2');
    expect(after.state).toBe('done');
  });

  it('rejects unknown id with ok:false', async () => {
    const a = createMockHouseholdAgent();
    const r = await a.callSkill('household', 'markComplete', { choreId: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No chore with id/);
  });

  it("rejects already-done chore", async () => {
    const a = createMockHouseholdAgent();
    await a.callSkill('household', 'markComplete', { choreId: 'c-1' });
    const r = await a.callSkill('household', 'markComplete', { choreId: 'c-1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already done/);
  });
});

describe('createMockHouseholdAgent — error paths', () => {
  it('throws on unknown appOrigin', async () => {
    const a = createMockHouseholdAgent();
    await expect(a.callSkill('pinboard', 'listOpen', {})).rejects.toThrow(
      /unknown appOrigin/,
    );
  });

  it('throws on unknown opId', async () => {
    const a = createMockHouseholdAgent();
    await expect(a.callSkill('household', 'unknown', {})).rejects.toThrow(
      /unknown opId/,
    );
  });
});

describe('createMockHouseholdAgent — reset + custom seed', () => {
  it('reset() returns to initial seed', async () => {
    const a = createMockHouseholdAgent();
    await a.callSkill('household', 'markComplete', { choreId: 'c-1' });
    expect(a.state().find((c) => c.id === 'c-1').state).toBe('done');
    a.reset();
    expect(a.state().find((c) => c.id === 'c-1').state).toBe('open');
  });

  it('custom seed is honoured', async () => {
    const a = createMockHouseholdAgent({ seed: [
      { id: 'x', label: 'Custom', type: 'chore', state: 'open' },
    ] });
    const r = await a.callSkill('household', 'listOpen', {});
    expect(r.items.length).toBe(1);
    expect(r.items[0].label).toBe('Custom');
  });
});
