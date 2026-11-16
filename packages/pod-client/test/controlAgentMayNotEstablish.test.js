/**
 * A DEVICE THAT MAY NOT ESTABLISH A CIRCLE'S FIRST KEY NEVER MINTS ONE. In a circle without a pod every device holds its
 * own key store, so a member's control agent used to mint the circle's first key twice over: at its bootstrap, and in
 * addMember when its store was empty ("no key yet: the first one"). The member then sealed under a key the founder never
 * held (found 2026-11-14). With `mayEstablish: false` neither path writes anything; a key that exists is used as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { createControlAgent } from '../src/sealing/controlAgent.js';
import { generateKeypair } from '../src/sealing/index.js';

function setup(mayEstablish) {
  let stored = null;
  const writes = [];
  const keyStore = { read: async () => stored, write: async (r) => { writes.push(r); stored = r; } };
  const ca = createControlAgent({
    sharing: { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) },
    containerUri: 'https://pod/c1/', keyStore, controllerKey: generateKeypair(), roster: [], mayEstablish,
  });
  return { ca, writes, stored: () => stored };
}

describe('a control agent that may not establish the first key', () => {
  it('its bootstrap writes no key', async () => {
    const { ca, writes } = setup(false);
    await ca.bootstrap();
    expect(writes).toEqual([]);
  });

  it('adding a member to an empty store writes no key either', async () => {
    const { ca, writes } = setup(false);
    const bob = generateKeypair();
    await ca.addMember({ webId: 'bob', publicKey: bob.publicKey });
    expect(writes).toEqual([]);
  });

  it('a device that may establish it does, on both paths', async () => {
    const a = setup(true);
    await a.ca.bootstrap();
    expect(a.writes.length).toBe(1);
    const b = setup(true);
    await b.ca.addMember({ webId: 'bob', publicKey: generateKeypair().publicKey });
    expect(b.writes.length).toBe(1);
  });
});
