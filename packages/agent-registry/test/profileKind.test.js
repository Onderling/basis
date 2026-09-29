/**
 * A profile's KIND — whose it is: a person's, or a function's (a household bot that is its own node).
 *
 * The bot's web door follows it: a node enrolled for a person keeps that person's inbox and answers nothing; a node
 * running a function profile answers its inbox. So the field is part of the profile record, a closed set, set once
 * through its own mutation, and never lost when the record is written again for another reason.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry, PROFILE_KINDS } from '../src/AgentRegistry.js';
import { profileHasOtherDevices } from '../src/deviceDelegations.js';

const DEFAULT = { agentId: 'default', pubKey: 'pub-bot', agentUri: 'profile:default', role: 'profile', name: 'default' };

describe('a profile\'s kind', () => {
  let reg;
  beforeEach(() => {
    const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'box' });
    reg = createAgentRegistry({ pseudoPod, deviceId: 'box' });
  });

  it('person or function — anything else is refused', async () => {
    expect(PROFILE_KINDS).toEqual(['person', 'function']);
    await reg.register(DEFAULT);
    await reg.updateKind('default', 'function');
    expect((await reg.lookup('default')).kind).toBe('function');
    await expect(reg.updateKind('default', 'robot')).rejects.toThrow();
  });

  it('writing the record again for another reason keeps its kind', async () => {
    await reg.register(DEFAULT);
    await reg.updateKind('default', 'function');
    await reg.register({ ...DEFAULT, name: 'renamed' });
    const rec = await reg.lookup('default');
    expect(rec.name).toBe('renamed');
    expect(rec.kind).toBe('function');
  });

  it('a profile with another live device is a person\'s (the rule that keeps it from being named a function\'s)', () => {
    const withDevices = (map) => ({ properties: { deviceDelegations: { mode: 'own', value: map } } });
    expect(profileHasOtherDevices(withDevices({ box: {} }), 'box')).toBe(false);
    expect(profileHasOtherDevices(withDevices({ box: {}, phone: {} }), 'box')).toBe(true);
    expect(profileHasOtherDevices(withDevices({ box: {}, phone: { revoked: true } }), 'box')).toBe(false);
    expect(profileHasOtherDevices({}, 'box')).toBe(false);
  });
});
