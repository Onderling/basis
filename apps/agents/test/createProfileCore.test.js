// Identity step 4 (app) — the createProfile op core: names a profile; the owner-root DERIVATION is
// the injected `profiles` collaborator (cores stay dependency-free).
import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '@onderling/agent-registry';
import { createProfile } from '../src/cores.js';

const mkReg = () => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' }),
  deviceId: 'd',
});

describe('createProfile core (step 4)', () => {
  let registry; let created;
  // a fake `profiles` collaborator standing in for the owner-root-backed registry createProfile
  const profiles = {
    async create({ profileId = 'p-0123456789ab', name, properties }) {   // the real one mints the id when absent
      created.push({ profileId, name, properties });
      await registry.register({ agentId: profileId, pubKey: `pk-${profileId}`, agentUri: `u:${profileId}`, role: 'profile', name, properties });
      return { entry: null, profileId };
    },
  };
  beforeEach(() => { registry = mkReg(); created = []; });

  it('calls the collaborator (parsing a JSON properties string) + returns the registered entry', async () => {
    const res = await createProfile({ registry, profiles }, {
      id: 'work', name: 'Work', properties: '{"relay":{"mode":"own","value":"wss://w"}}',
    });
    expect(res.created).toBe(true);
    expect(res.id).toBe('work');
    expect(created[0].profileId).toBe('work');
    expect(created[0].properties.relay).toEqual({ mode: 'own', value: 'wss://w' });   // JSON parsed
    expect(res.agent.agentId).toBe('work');
    expect(res.agent.role).toBe('profile');
  });

  it('accepts an object properties map directly', async () => {
    await createProfile({ registry, profiles }, { id: 'home', properties: { name: { mode: 'inherit' } } });
    expect(created[0].properties).toEqual({ name: { mode: 'inherit' } });
  });

  it('degraded (created:false) without a profiles collaborator — no derivation substrate', async () => {
    const res = await createProfile({ registry }, { id: 'work' });
    expect(res).toMatchObject({ created: false, reason: 'profiles-unavailable' });
  });

  it('a name alone: the id is minted, not taken from the name — and the name is kept as the name', async () => {
    const res = await createProfile({ registry, profiles }, { name: 'Buurt' });
    expect(created[0].profileId).toBe('p-0123456789ab');
    expect(created[0].name).toBe('Buurt');
    expect(res).toMatchObject({ created: true, id: 'p-0123456789ab' });
  });

  it('needs a name (or an id): neither → nothing created', async () => {
    const res = await createProfile({ registry, profiles }, {});
    expect(res).toMatchObject({ created: false, reason: 'name-required' });
    expect(created).toHaveLength(0);
  });

  it('a refusal by the derivation (delegation custody) is reported as one, not as created', async () => {
    const refusing = { create: async () => ({ ok: false, reason: 'ceremony-required' }) };
    const res = await createProfile({ registry, profiles: refusing }, { name: 'Werk' });
    expect(res).toMatchObject({ created: false, reason: 'ceremony-required' });
  });
});
