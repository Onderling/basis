/**
 * AN ADMISSION NEVER ROUTES ITS GRANT TO NOTHING. The key owner's device builds a circle's pod producer when the circle
 * is opened; an admission before that (the circle not opened since a restart) found none, and the joiner's pod WebID,
 * which travels only to that grant, was lost: the later seed re-added the key but never the pod read grant. The router
 * now builds the producer for a pod circle, and with still none keeps the WebID in the device-local pod-agents note that
 * the producer reads when it is built.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCircleControlAgentRouter, notePodAgentFor } from '../../src/v2/circlePodProducer.js';

const memVault = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, m }; };

describe('an admission before the producer is built', () => {
  it('builds the producer for a pod circle, and the grant reaches it with the joiner\'s pod WebID', async () => {
    const pods = new Map();
    const addMember = vi.fn(async () => ({ added: true }));
    const router = createCircleControlAgentRouter((id) => pods.get(id) ?? null, {
      policyOf: async () => ({ pod: 'shared', storagePosture: 'p2' }),
      ensureCirclePod: async (gid) => { pods.set(gid, { controlAgent: { addMember } }); return pods.get(gid); },
      notePodAgent: vi.fn(),
    });
    await router.addMember({ groupId: 'c1', webId: 'pk-bram', publicKey: 'seal-bram', podAgent: 'https://pod/bram/profile/card#me' });
    expect(addMember).toHaveBeenCalledWith(expect.objectContaining({ webId: 'pk-bram', podAgent: 'https://pod/bram/profile/card#me' }));
  });

  it('with still no producer, keeps the pod WebID in the device-local note the producer reads', async () => {
    const vault = memVault();
    const router = createCircleControlAgentRouter(() => null, {
      policyOf: async () => ({ pod: 'shared', storagePosture: 'p2' }),
      ensureCirclePod: async () => null,   // e.g. not signed in to a pod yet
      notePodAgent: (gid, webId, podAgent) => notePodAgentFor({ vault, circleId: gid, webId, podAgent }),
    });
    await router.addMember({ groupId: 'c1', webId: 'pk-bram', publicKey: 'seal-bram', podAgent: 'https://pod/bram/profile/card#me' });
    expect(JSON.parse(vault.m.get('cc.circle-groupkey:pod-agents:c1'))).toEqual({ 'pk-bram': 'https://pod/bram/profile/card#me' });
  });

  it('a circle without a pod builds nothing', async () => {
    const ensure = vi.fn();
    const router = createCircleControlAgentRouter(() => null, { policyOf: async () => ({ pod: 'none' }), ensureCirclePod: ensure, notePodAgent: vi.fn() });
    await router.addMember({ groupId: 'c1', webId: 'pk-bram', publicKey: 'seal-bram' });
    expect(ensure).not.toHaveBeenCalled();
  });
});
