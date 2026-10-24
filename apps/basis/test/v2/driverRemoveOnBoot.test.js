/**
 * A driver can be taken off again, through the waist, on a real boot: set a goal, remove it, it is gone from the
 * profile's drivers; a coarse property (not a driver) is refused by the same op, so the op cannot clear anything else.
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';

describe('removeProfileDriver on a real boot', () => {
  it('removes a driver, and refuses a key that is not one', { timeout: 120_000 }, async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false });
    const set = await agent.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'zeilen', kind: 'goal', text: 'leren zeilen', tags: 'zeilen,water' });
    expect(set?.ok, JSON.stringify(set)).toBe(true);
    expect(Object.keys((await agent.callSkill('agents', 'getProfileDrivers', { id: 'default' }))?.drivers ?? {})).toContain('zeilen');

    expect(await agent.callSkill('agents', 'removeProfileDriver', { id: 'default', key: 'zeilen' })).toMatchObject({ ok: true });
    expect(Object.keys((await agent.callSkill('agents', 'getProfileDrivers', { id: 'default' }))?.drivers ?? {})).not.toContain('zeilen');

    await agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' });
    expect(await agent.callSkill('agents', 'removeProfileDriver', { id: 'default', key: 'place' })).toMatchObject({ ok: false, reason: 'not-a-driver' });
  });
});
