/**
 * A member's join must not drop anyone who already holds the circle's group key. The stored key resource is the
 * authority on who holds it: an enrolled device (grantRecipient), a grantee another device of the founder added, a
 * canonical-share recipient. A join recomputed from this device's own in-memory roster lost every one of them.
 */
import { describe, it, expect, vi } from 'vitest';
import { createControlAgent } from '../src/sealing/controlAgent.js';
import { generateKeypair, unwrapGroupKey } from '../src/sealing/index.js';

function setup() {
  const sharing = { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };
  let stored = null;
  const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
  const controllerKey = generateKeypair();
  return { sharing, keyStore, controllerKey, current: () => stored };
}

describe('controlAgent: a join keeps every current holder of the group key', () => {
  it('a device enrolled before the join can still open the key after it', async () => {
    const s = setup();
    const agent = createControlAgent({ sharing: s.sharing, containerUri: 'https://pod/c/', keyStore: s.keyStore, controllerKey: s.controllerKey });
    const founder = generateKeypair(); const device = generateKeypair(); const bea = generateKeypair();
    await agent.addMember({ webId: 'ref:founder', publicKey: founder.publicKey, role: 'admin' });
    await agent.grantRecipient({ publicKey: device.publicKey });
    await agent.addMember({ webId: 'ref:bea', publicKey: bea.publicKey });
    expect(() => unwrapGroupKey(s.current(), bea.privateKey), 'the joiner opens it').not.toThrow();
    expect(() => unwrapGroupKey(s.current(), device.privateKey), 'the enrolled device still opens it').not.toThrow();
  });

  it('a member granted by another agent over the same key resource is kept when this one adds a member', async () => {
    const s = setup();
    const one = createControlAgent({ sharing: s.sharing, containerUri: 'https://pod/c/', keyStore: s.keyStore, controllerKey: s.controllerKey });
    const two = createControlAgent({ sharing: s.sharing, containerUri: 'https://pod/c/', keyStore: s.keyStore, controllerKey: s.controllerKey });
    const founder = generateKeypair(); const bea = generateKeypair(); const cas = generateKeypair();
    await one.addMember({ webId: 'ref:founder', publicKey: founder.publicKey, role: 'admin' });
    await one.addMember({ webId: 'ref:bea', publicKey: bea.publicKey });
    await two.addMember({ webId: 'ref:cas', publicKey: cas.publicKey });
    expect(() => unwrapGroupKey(s.current(), cas.privateKey)).not.toThrow();
    expect(() => unwrapGroupKey(s.current(), bea.privateKey), 'bea, granted by the other agent, still opens it').not.toThrow();
  });
});
