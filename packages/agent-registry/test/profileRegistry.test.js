// Identity step 2 — profile fields (properties + ownerFingerprint) round-trip through the
// real registry (pseudo-pod backed) AND survive later mutations (grant/updateCapabilities).
import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import { own, inherit, resolveProperty } from '../index.js';

const mkPod = (deviceId = 'laptop-anne') =>
  createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });

const DEFAULT_PROFILE = {
  agentId: 'default', pubKey: 'pub-default', agentUri: 'uri:default', role: 'profile',
  ownerFingerprint: 'abcdef0123456789',
  properties: { relay: own('wss://home'), name: own('Alice') },
};
const FACE_PROFILE = {
  agentId: 'face', pubKey: 'pub-face', agentUri: 'uri:face', role: 'profile',
  ownerFingerprint: 'abcdef0123456789',
  properties: { name: own('Anon') },   // inherits relay from default
};

describe('registry — profile fields persist + drive own/inherit resolution', () => {
  let reg;
  beforeEach(async () => {
    reg = createAgentRegistry({ pseudoPod: mkPod(), deviceId: 'laptop-anne' });
    await reg.register(DEFAULT_PROFILE);
    await reg.register(FACE_PROFILE);
  });

  it('properties + ownerFingerprint round-trip through register/lookup', async () => {
    const d = await reg.lookup('default');
    expect(d.ownerFingerprint).toBe('abcdef0123456789');
    expect(d.properties.relay).toEqual({ mode: 'own', value: 'wss://home' });
    expect(d.properties.name).toEqual({ mode: 'own', value: 'Alice' });
  });

  it('resolves the face inheriting the default substrate off the live registry', async () => {
    const list = await reg.list();
    const byId = Object.fromEntries(list.map((a) => [a.agentId, a]));
    const getProfile = (id) => byId[id] ?? null;
    // face declares no relay → implicitly inherits the default's; overrides name
    expect(resolveProperty(getProfile, 'face', 'relay', { defaultProfileId: 'default' })).toBe('wss://home');
    expect(resolveProperty(getProfile, 'face', 'name',  { defaultProfileId: 'default' })).toBe('Anon');
  });

  it('a later mutation (updateCapabilities) preserves the profile fields', async () => {
    await reg.updateCapabilities('default', ['pinboard', 'tasks']);
    const d = await reg.lookup('default');
    expect(d.capabilities).toEqual(['pinboard', 'tasks']);
    expect(d.ownerFingerprint).toBe('abcdef0123456789');       // NOT dropped by the spread-mutation
    expect(d.properties.relay).toEqual({ mode: 'own', value: 'wss://home' });
  });

  it('an explicit inherit(`from`) also resolves', async () => {
    await reg.register({ agentId: 'child', pubKey: 'p', agentUri: 'u', role: 'profile',
      properties: { relay: inherit('default') } });
    const list = await reg.list();
    const byId = Object.fromEntries(list.map((a) => [a.agentId, a]));
    expect(resolveProperty((id) => byId[id] ?? null, 'child', 'relay', {})).toBe('wss://home');
  });
});
