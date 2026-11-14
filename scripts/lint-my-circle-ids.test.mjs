import { describe, it, expect } from 'vitest';
import { objectOnlyMaps } from './lint-my-circle-ids.mjs';

describe('lint-my-circle-ids', () => {
  it('names a list mapped as objects only', () => {
    expect(objectOnlyMaps("const ids = (r?.circles ?? []).map((b) => b?.groupId ?? b?.id).filter(Boolean);")).toEqual([1]);
    expect(objectOnlyMaps("x\nrows.map(c => c?.groupId ?? c?.id)")).toEqual([2]);
  });
  it('a map that reads a plain id first is fine', () => {
    expect(objectOnlyMaps("rows.map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id ?? null)))")).toEqual([]);
    expect(objectOnlyMaps('const ids = await myCircleIds(callSkill);')).toEqual([]);
  });
});
