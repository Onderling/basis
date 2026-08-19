import { describe, it, expect, vi } from 'vitest';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';

describe('quickCreateCircle', () => {
  it('dispatches createGroupV2 with a slugified id + name and returns the result', async () => {
    const callSkill = vi.fn(async (app, op, args) => {
      expect(app).toBe('stoop');
      expect(op).toBe('createGroupV2');
      return { groupId: args.groupId, code: 'X' };
    });
    const res = await quickCreateCircle({ callSkill, name: 'Selwerd Circle!' });
    const args = callSkill.mock.calls[0][2];
    expect(args.name).toBe('Selwerd Circle!');
    expect(args.groupId).toBe('selwerd-circle'); // slugified
    expect(res.groupId).toBe('selwerd-circle');
  });

  it('rejects an empty name', async () => {
    await expect(quickCreateCircle({ callSkill: async () => ({}), name: '  ' }))
      .rejects.toThrow(/name/);
  });

  it('throws when the substrate returns an error', async () => {
    await expect(quickCreateCircle({ callSkill: async () => ({ error: 'nope' }), name: 'X' }))
      .rejects.toThrow('nope');
  });
});
