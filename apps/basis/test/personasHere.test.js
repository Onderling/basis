/**
 * The personas this device runs, for the header switcher: the default first, then each persona it holds, with the
 * names their registry entries carry and each self's webid. A persona the person has but this device does not hold is
 * not listed (the switcher toggles what is here).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe('the personas on this device', () => {
  it('the default first, then the held personas, each with its name and webid', async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    expect((await agent.personasHere()).map((p) => p.id)).toEqual(['default']);
    const made = await agent.callSkill('agents', 'createProfile', { name: 'Werk' });
    const list = await agent.personasHere();
    expect(list.map((p) => p.id)).toEqual(['default', made.id]);
    expect(list[1]).toMatchObject({ name: 'Werk', webid: agent.persona(made.id).chatId.pubKey });
    expect(list[0].webid).toBe(agent.persona('default').chatId.pubKey);
  });
});
