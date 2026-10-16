/**
 * A DEVICE'S OWN ADDRESS ANNOUNCEMENT IN A PERSONA'S CIRCLE NAMES THE PERSONA. The announcement is how a device adds its
 * per-circle address to its member's proven set (a join, a boot, an enrol, a restore — no readmission); the member it
 * names must be the circle's own self, never the default's webid in a persona's circle.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';

describe('own address announcement per circle self', () => {
  it('in a persona\'s circle it names the persona; in a default circle the default', async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    expect((await agent.callSkill('household', 'bindCirclePersona', { circleId: 'y', personaId: id })).ok).toBe(true);
    const inY = ownAnnouncementFor({ agent, circleId: 'y' });
    expect(inY?.memberWebid, 'the persona').toBe(agent.persona(id).chatId.pubKey);
    expect(inY?.circleAddress).toBe(agent.persona(id).circleAddressFor('y'));
    expect(ownAnnouncementFor({ agent, circleId: 'x' })?.memberWebid, 'the default').toBe(agent.identity.chat.pubKey);
    await agent.shutdown?.();
  }, 60_000);
});
