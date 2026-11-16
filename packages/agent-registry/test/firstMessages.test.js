/**
 * WHO MAY WRITE TO A PERSONA FIRST — the persona is the policy (Frits 2026-11-12). `request` holds a first message from
 * someone not chosen as a message request; `open` lets anyone write, within the stranger budgets. Absent, it follows the
 * kind: a function profile (a bot) is open, a person's is request. A profile property, so it travels with the profile's
 * facts to every device of the person.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import { FIRST_MESSAGE_POLICIES, FIRST_MESSAGES_KEY, firstMessagesOf } from '../src/firstMessages.js';

const withPolicy = (policy) => ({ properties: { [FIRST_MESSAGES_KEY]: { mode: 'own', value: policy } } });

const DEFAULT = { agentId: 'default', pubKey: 'pub-me', agentUri: 'profile:default', role: 'profile', name: 'default' };

describe('who may write to a persona first', () => {
  let reg;
  beforeEach(() => {
    const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'box' });
    reg = createAgentRegistry({ pseudoPod, deviceId: 'box' });
  });

  it('absent, it follows the kind: a person\'s is request, a function\'s is open', async () => {
    expect(FIRST_MESSAGE_POLICIES).toEqual(['request', 'open']);
    await reg.register(DEFAULT);
    expect(firstMessagesOf(await reg.lookup('default'))).toBe('request');
    await reg.updateKind('default', 'function');
    expect(firstMessagesOf(await reg.lookup('default'))).toBe('open');
  });

  it('set, it is the persona\'s own property: a person may open the door, a bot may close it; anything else is ignored', async () => {
    await reg.register({ ...DEFAULT, ...withPolicy('open') });
    expect(firstMessagesOf(await reg.lookup('default'))).toBe('open');
    await reg.updateKind('default', 'function');
    await reg.register({ ...DEFAULT, ...withPolicy('request') });
    expect(firstMessagesOf(await reg.lookup('default'))).toBe('request');
    expect(firstMessagesOf({ kind: 'person', ...withPolicy('anyone') })).toBe('request');
    expect(firstMessagesOf({ kind: 'function', ...withPolicy('anyone') })).toBe('open');
  });
});
