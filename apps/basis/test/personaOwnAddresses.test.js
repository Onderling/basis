/**
 * A PERSONA'S ADDRESSES ARE THE PERSON'S OWN (persona arc c4b): every address any self of this device speaks as — each
 * persona's chat key and person address, beside the default's — is "mine". What reads it: the roster/Contacten filter
 * (my own address never becomes a nameless contact row) and the pair-request gate (my own devices are admitted).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { SecurityLayer } from '@onderling/core';
import { SENDER_REASON } from '../src/v2/circleSenderAuthorization.js';

describe('own addresses cover every persona', () => {
  it('a persona\'s chat key and person address are among the device\'s own', async () => {
    const agent = await createRealHouseholdAgent({
      seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
    });
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const B = agent.persona(id);
    // the persona's person identity is made when it first speaks (bindCirclePersona) — bind one circle as it
    expect((await agent.callSkill('household', 'bindCirclePersona', { circleId: 'c-b', personaId: id })).ok).toBe(true);
    const mine = await agent.ownAddresses();
    expect(mine).toContain(agent.identity.chat.pubKey);
    expect(mine, 'the persona\'s chat key').toContain(B.chatId.pubKey);
    expect(mine, 'the persona\'s person address').toContain(B.personIdentity.pubKey);
    await agent.shutdown?.();
  }, 60_000);

  it('the sender check admits a persona\'s current person key as our own, as it does the default\'s', async () => {
    // the authorizer the agent installs at its security layer (captured as it is installed)
    let authorize = null;
    const orig = SecurityLayer.prototype.setSenderAuthorizer;
    SecurityLayer.prototype.setSenderAuthorizer = function (fn) { if (typeof fn === 'function') authorize = fn; return orig.call(this, fn); };
    let agent;
    try {
      agent = await createRealHouseholdAgent({
        seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
      });
    } finally { SecurityLayer.prototype.setSenderAuthorizer = orig; }
    expect(typeof authorize).toBe('function');
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    expect((await agent.callSkill('household', 'bindCirclePersona', { circleId: 'c-b', personaId: id })).ok).toBe(true);
    const B = agent.persona(id);
    const ownAddress = agent.circleAddressFor('some-circle');
    expect(authorize({ senderKey: B.personIdentity.pubKey, ownAddress })).toMatchObject({ allow: true, reason: SENDER_REASON.OWN_KEY });
    expect(authorize({ senderKey: 'a-stranger-key', ownAddress })?.reason).not.toBe(SENDER_REASON.OWN_KEY);
    await agent.shutdown?.();
  }, 60_000);
});
