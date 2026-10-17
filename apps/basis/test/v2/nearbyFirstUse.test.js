/**
 * THE NEARBY FIRST-USE QUESTION — "what may this room see of you?" — asked once per self on each device. The answer is
 * the self's level (it travels with the persona); the "asked" mark is the device's. A self whose level was chosen on
 * another device is shown it here and not asked again.
 */
import { describe, it, expect } from 'vitest';
import { nearbyFirstUse, nearbyLevelIsSet, nearbyAskedKey, NEARBY_LEVEL_KEY } from '../../src/v2/nearbyLevel.js';
import { createNearbyIdentity } from '../../src/v2/nearbyIdentity.js';

describe('when the room asks for a level', () => {
  it('a chosen self, never asked here, with no level of its own: ask', () => {
    expect(nearbyFirstUse({ self: { id: 'p-aaaaaaaaaaaa' }, asked: false, levelSet: false })).toEqual({ ask: true, mark: false });
  });
  it('asked on this device already: never again', () => {
    expect(nearbyFirstUse({ self: { id: 'default' }, asked: true, levelSet: false })).toEqual({ ask: false, mark: false });
  });
  it('the level was chosen ELSEWHERE: shown, not asked — and this device marks it asked', () => {
    expect(nearbyFirstUse({ self: { id: 'p-aaaaaaaaaaaa' }, asked: false, levelSet: true })).toEqual({ ask: false, mark: true });
  });
  it('while the room asks WHO enters: no level question (there is no self to set it for)', () => {
    expect(nearbyFirstUse({ self: { asking: true }, asked: false, levelSet: false })).toEqual({ ask: false, mark: false });
  });
  it('the mark is per self', () => {
    expect(nearbyAskedKey('p-aaaaaaaaaaaa')).not.toBe(nearbyAskedKey('default'));
  });
});

describe('whether a self chose a level', () => {
  it('nothing under `nearby` = not chosen (the floor default); any entry = chosen, `none` included', () => {
    expect(nearbyLevelIsSet(null)).toBe(false);
    expect(nearbyLevelIsSet({ perContext: { 'pair-abc': { handle: { enabled: true } } } })).toBe(false);
    expect(nearbyLevelIsSet({ perContext: { nearby: { [NEARBY_LEVEL_KEY]: { enabled: false, rung: 'none' } } } })).toBe(true);
  });
  it('the identity reads it for THE ROOM SELF', async () => {
    const seen = [];
    const callSkill = async (app, op, args) => {
      seen.push(args?.id);
      return { disclosure: args?.id === 'p-aaaaaaaaaaaa' ? { perContext: { nearby: { [NEARBY_LEVEL_KEY]: { enabled: true, rung: 'profile' } } } } : {} };
    };
    expect(await createNearbyIdentity({ callSkill, roomSelf: () => ({ id: 'p-aaaaaaaaaaaa', name: 'Werk' }) }).levelState()).toEqual({ level: 'profile', set: true });
    expect(await createNearbyIdentity({ callSkill, roomSelf: () => ({ id: 'default' }) }).levelState()).toEqual({ level: 'handle', set: false });
    expect(await createNearbyIdentity({ callSkill, roomSelf: () => null }).levelState(), 'no self entering: nothing, and nothing read').toEqual({ level: 'none', set: false });
    expect(seen).toEqual(['p-aaaaaaaaaaaa', 'default']);
  });
});
