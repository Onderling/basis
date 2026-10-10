/**
 * STOOP'S "ME" IN A PERSONA'S CIRCLE (persona arc c3b2): once a circle is bound to a persona, the device's own stoop
 * calls about that circle are the persona's — whoAmI answers with the persona's webid — while a circle of the default
 * stays the default's. Calls that name no circle stay on the default identity.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const boot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });

describe('stoop\'s self follows the circle\'s persona', () => {
  it('whoAmI in a persona\'s circle is the persona; in a default circle the default', async () => {
    const agent = await boot();
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const B = agent.persona(id);
    const C = 'circle-of-buurt';
    expect((await agent.callSkill('household', 'bindCirclePersona', { circleId: C, personaId: id })).ok).toBe(true);

    const inB = await agent.callSkill('stoop', 'whoAmI', { groupId: C });
    expect(inB?.webid).toBe(B.chatId.pubKey);
    const inDefault = await agent.callSkill('stoop', 'whoAmI', { groupId: 'a-default-circle' });
    expect(inDefault?.webid).toBe(agent.identity.chat.pubKey);
    const noCircle = await agent.callSkill('stoop', 'whoAmI', {});
    expect(noCircle?.webid).toBe(agent.identity.chat.pubKey);
    await agent.shutdown?.();
  }, 60_000);
});
