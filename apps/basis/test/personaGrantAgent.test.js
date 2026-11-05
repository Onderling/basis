/**
 * A PERSONA ISSUES ITS AGENT GRANTS AS ITSELF. A capability token names its issuer (and the agent it is for), so a
 * grant a persona makes — or a grant letting a device run the persona — issued by the general persona would let its
 * holder link the persona to the person's general self. On a device holding two selves, `grantAgent` issues as the self
 * it names (`persona`), or as the persona a profile grant is for; naming none is refused.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

describe('a persona issues its agent grants as itself', () => {
  let a; let w; let selfId; let W;

  beforeAll(async () => {
    a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    w = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    W = a.persona(w).chatId.pubKey;
    selfId = (await a.callSkill('agents', 'listAgents', {})).items[0].id;
  }, 120_000);

  it('a grant named for Werk is issued by Werk, for Werk', async () => {
    // the grantee is someone else's key: what the token carries of the default would be the issuer's doing
    const g = await a.callSkill('agents', 'grantAgent', { agentId: selfId, skill: 'household.listOpenItems', persona: w, subject: 'grantee-key-elsewhere' });
    expect(g?.granted, JSON.stringify(g)).toBe(true);
    const token = await a.agentsTokenRegistry.get(W, 'household.listOpenItems');
    expect(token, 'a token for Werk').toBeTruthy();
    expect(token.issuer, 'issued by Werk').toBe(W);
    expect(JSON.stringify(token.toJSON()).includes(a.persona('default').chatId.pubKey), 'nothing of the default').toBe(false);
  });

  it('a profile grant for Werk (a device may run Werk) is issued by Werk', async () => {
    const g = await a.callSkill('agents', 'grantAgent', { agentId: selfId, profile: w });
    expect(g?.granted, JSON.stringify(g)).toBe(true);
    const token = await a.agentsTokenRegistry.get(W, '*');
    expect(token?.issuer, 'issued by Werk').toBe(W);
  });

  it('with two selves, a grant that names none is refused', async () => {
    const g = await a.callSkill('agents', 'grantAgent', { agentId: selfId, skill: 'household.addItem' });
    expect({ granted: g?.granted ?? false, error: g?.error ?? null }).toEqual({ granted: false, error: 'self-required' });
  });
});

describe('installing an agent with grants on a device holding two selves', () => {
  const CARD = {
    name: 'Werkhulp', url: 'https://third-party.invalid/werkhulp', version: '1.0',
    skills: [{ id: 'werkhulp.run' }],
    'x-onderling': { id: 'override:werkhulp', pubKey: 'pub-override-werkhulp', role: 'service' },
  };
  let a; let w; let W;

  beforeAll(async () => {
    a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    w = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    W = a.persona(w).chatId.pubKey;
  }, 120_000);

  it('naming no self is refused BEFORE anything is registered — never a half install', async () => {
    const res = await a.callSkill('agents', 'installAgent', { card: JSON.stringify(CARD), grants: JSON.stringify(['werkhulp.run']) });
    expect({ ok: res?.ok, error: res?.error, installed: res?.installed }).toEqual({ ok: false, error: 'self-required', installed: false });
    const view = await a.callSkill('agents', 'viewAgent', { agentId: 'override:werkhulp' });
    expect(view?.agent ?? view?.skills ?? null, 'nothing was registered').toBeFalsy();
  });

  it('naming Werk installs it with tokens issued by Werk', async () => {
    const res = await a.callSkill('agents', 'installAgent', { card: JSON.stringify(CARD), grants: JSON.stringify(['werkhulp.run']), persona: w });
    expect(res?.installed, JSON.stringify(res)).toBe(true);
    expect(res.granted.map((g) => g.granted)).toEqual([true]);
    const token = await a.agentsTokenRegistry.get(W, 'werkhulp.run');
    expect(token?.issuer, 'issued by Werk').toBe(W);
  });
});
