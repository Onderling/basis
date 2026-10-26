/**
 * The own profile over the persona record: a persona keeps its own handle and name (taking the general persona's
 * would link the two selves on every circle that sees both), and inherits availability and place like any property.
 */
import { describe, it, expect } from 'vitest';
import { setOwn } from '@onderling/agent-registry';
import { createRegistrySelfProfile } from '../../src/v2/selfProfileOverRegistry.js';

function fakeRegistry(entries) {
  const byId = new Map(entries.map((e) => [e.agentId, e]));
  return { lookup: async (id) => byId.get(id) ?? null, register: async (e) => { byId.set(e.agentId, e); } };
}

describe('the self profile over the registry', () => {
  const ME = 'me-key', WORK = 'work-key';
  let dflt = { agentId: 'default', properties: {} };
  dflt = { ...dflt, properties: setOwn(setOwn(setOwn(dflt.properties, 'handle', 'bea'), 'name', 'Bea Bakker'), 'availability', 'away') };
  const reg = fakeRegistry([dflt, { agentId: 'p-work', properties: {} }]);
  const sp = createRegistrySelfProfile({ registry: reg, profileIdOf: (w) => ({ [ME]: 'default', [WORK]: 'p-work' })[w] ?? null });

  it('a persona does not take the general handle or name, but does take availability', async () => {
    expect(await sp.get(WORK)).toEqual({ handle: null, displayName: null, availability: 'away', location: null });
  });

  it('a persona\'s own values are its own; the general persona is untouched', async () => {
    await sp.set(WORK, { handle: 'b-work', displayName: 'B.' });
    expect(await sp.get(WORK)).toMatchObject({ handle: 'b-work', displayName: 'B.' });
    expect(await sp.get(ME)).toMatchObject({ handle: 'bea', displayName: 'Bea Bakker' });
  });

  it('answers nothing for a webid that is not one of this device\'s selves', async () => {
    expect(await sp.get('someone-else')).toBeNull();
    expect(await sp.set('someone-else', { handle: 'x-x-x' })).toBeNull();
  });
});
