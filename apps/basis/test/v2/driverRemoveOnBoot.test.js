/**
 * A driver can be taken off again, through the waist, on a real boot: set a goal, remove it, it is gone from the
 * profile's drivers and from every circle's release; a coarse property (not a driver) is refused by the same op, so the op cannot clear anything else.
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';

describe('removeProfileDriver on a real boot', () => {
  it('removes a driver, and refuses a key that is not one', { timeout: 120_000 }, async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false });
    const set = await agent.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'zeilen', kind: 'goal', text: 'leren zeilen', tags: 'zeilen,water' });
    expect(set?.ok, JSON.stringify(set)).toBe(true);
    expect(Object.keys((await agent.callSkill('agents', 'getProfileDrivers', { id: 'default' }))?.drivers ?? {})).toContain('zeilen');

    // released in two circles; another key's release in the same circle must stay
    for (const contextId of ['kring-a', 'kring-b']) {
      await agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId, key: 'zeilen', enabled: true });
    }
    await agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: 'kring-a', key: 'place', enabled: true });

    expect(await agent.callSkill('agents', 'removeProfileDriver', { id: 'default', key: 'zeilen' })).toMatchObject({ ok: true });
    expect(Object.keys((await agent.callSkill('agents', 'getProfileDrivers', { id: 'default' }))?.drivers ?? {})).not.toContain('zeilen');
    // no dangling release: the removed key is gone from every circle's disclosure, the other key's stays
    const disclosure = await agent.callSkill('agents', 'getProfileDisclosure', { id: 'default' });
    const perContext = disclosure?.disclosure?.perContext ?? disclosure?.perContext ?? {};
    expect(perContext['kring-a']?.zeilen).toBeUndefined();
    expect(perContext['kring-b']?.zeilen).toBeUndefined();
    expect(perContext['kring-a']?.place?.enabled).toBe(true);

    await agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' });
    expect(await agent.callSkill('agents', 'removeProfileDriver', { id: 'default', key: 'place' })).toMatchObject({ ok: false, reason: 'not-a-driver' });
  });
});
