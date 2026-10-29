/**
 * THE PERSON'S OWN PROFILE IS THE PERSONA RECORD, through the real composition: the handle a person sets is the one
 * whoAmI says (and so the one a join presents), it lands on their profile as the `handle` attribute, no release ever
 * carries it, and the display name, availability and place land on the same record.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

describe('the own profile lives on the persona record', () => {
  const nodes = [];
  afterAll(async () => { await teardown(...nodes); });

  it('setMyHandle / setMyDisplayName / setHolidayMode / setMyLocation land on the default profile; whoAmI and getMyProfile read it', async () => {
    const node = await bootRealAgentNode('own-profile'); nodes.push(node);
    const call = (app, op, args = {}) => node.agent.callSkill(app, op, args);
    expect((await call('pinboard', 'setMyHandle', { handle: 'bea' }))?.error).toBeFalsy();
    await call('pinboard', 'setMyDisplayName', { displayName: 'Bea B.' });
    await call('pinboard', 'setHolidayMode', { on: true });
    await call('pinboard', 'setMyLocation', { cell: '500:1:1', label: 'Groningen', source: 'geocode' });

    expect((await call('pinboard', 'whoAmI'))?.handle).toBe('bea');
    const entry = (await call('pinboard', 'getMyProfile'))?.entry;
    expect(entry).toMatchObject({ handle: 'bea', displayName: 'Bea B.', availability: 'away', holidayMode: true, location: 'Groningen' });

    const props = (await call('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
    const value = (k) => props[k]?.value ?? props[k];
    expect([value('handle'), value('name'), value('availability'), value('location')]).toEqual(['bea', 'Bea B.', 'away', 'Groningen']);

    // the handle is presented by statements only: even an enabled disclosure entry releases nothing of it
    await call('agents', 'setProfileDisclosure', { id: 'default', contextId: 'c1', key: 'handle', enabled: true });
    const released = (await call('agents', 'getPersonaRelease', { id: 'default', contextId: 'c1', keys: 'handle' }))?.released ?? {};
    expect(released.handle).toBeUndefined();
  }, 60_000);
});
