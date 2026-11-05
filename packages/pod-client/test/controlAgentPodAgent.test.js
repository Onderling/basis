import { describe, it, expect, vi } from 'vitest';
import { createControlAgent } from '../src/sealing/controlAgent.js';
import { generateKeypair, unwrapGroupKey } from '../src/sealing/index.js';

// The roster ref names a member and keys the group-key wrap; no pod session signs in as it. The read grant has to
// name the member's pod WebID, or the member is refused by the pod however correct the wrap is.
function setup({ podAgents } = {}) {
  const grants = []; const revokes = [];
  const sharing = { grant: vi.fn(async (o) => { grants.push(o.agent); }), revoke: vi.fn(async (o) => { revokes.push(o.agent); }) };
  let stored = null;
  const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
  const controllerKey = generateKeypair();
  const make = (roster = [], pa = podAgents) => createControlAgent({ sharing, containerUri: 'https://pod/circle/', keyStore, controllerKey, roster, podAgents: pa });
  return { make, grants, revokes };
}
const WEBID = 'https://pods.example/bob/profile/card#me';

describe('controlAgent — the pod WebID a member signs in with', () => {
  it('grants the read to the pod WebID, not the roster ref, and keeps the wrap on the roster key', async () => {
    const { make, grants } = setup();
    const ca = make();
    const bob = generateKeypair();
    const { keyResource } = await ca.addMember({ webId: 'circle:c1:bob', publicKey: bob.publicKey, podAgent: WEBID });
    expect(grants).toEqual([WEBID]);
    expect(unwrapGroupKey(keyResource, bob.privateKey)).toBeTruthy();
    expect(ca.podAgents()).toEqual({ 'circle:c1:bob': WEBID });
  });

  it('a member without one is granted as today, and removal still works', async () => {
    const { make, grants, revokes } = setup();
    const ca = make();
    const a = generateKeypair(); const b = generateKeypair();
    await ca.addMember({ webId: 'a', publicKey: a.publicKey, role: 'admin' });
    await ca.addMember({ webId: 'b', publicKey: b.publicKey });
    expect(grants).toEqual(['a', 'b']);
    const out = await ca.removeMember({ webId: 'b' });
    expect(out.removed).toBe(true);
    expect(revokes).toEqual(['b']);
    expect(ca.podAgents()).toEqual({});
  });

  it('removal revokes exactly the pod WebID the grant named', async () => {
    const { make, revokes } = setup();
    const ca = make();
    const a = generateKeypair(); const b = generateKeypair();
    await ca.addMember({ webId: 'a', publicKey: a.publicKey, role: 'admin' });
    await ca.addMember({ webId: 'b', publicKey: b.publicKey, podAgent: WEBID });
    await ca.removeMember({ webId: 'b' });
    expect(revokes).toEqual([WEBID]);
    expect(ca.podAgents()).toEqual({});
  });

  it('after a reload the saved pod WebID comes back, so the removal still revokes it', async () => {
    const { make, grants, revokes } = setup({ podAgents: { b: WEBID } });
    const ca = make();                                       // a fresh agent, as on the admin's next boot
    const a = generateKeypair(); const b = generateKeypair();
    await ca.addMember({ webId: 'a', publicKey: a.publicKey, role: 'admin' });
    await ca.addMember({ webId: 'b', publicKey: b.publicKey });   // the roster seed carries no WebID
    expect(grants).toEqual(['a', WEBID]);
    await ca.removeMember({ webId: 'b' });
    expect(revokes).toEqual([WEBID]);
  });

  it('a member already on the roster who later gives a pod WebID gets the grant on it', async () => {
    const { make, grants } = setup();
    const ca = make();
    const b = generateKeypair();
    await ca.addMember({ webId: 'b', publicKey: b.publicKey });           // seeded before the redemption arrived
    await ca.addMember({ webId: 'b', publicKey: b.publicKey, podAgent: WEBID });
    expect(grants).toEqual(['b', WEBID]);
    expect(ca.members()).toHaveLength(1);
  });

  it('ignores a pod WebID that is not an http(s) address', async () => {
    const { make, grants } = setup();
    const ca = make();
    const b = generateKeypair();
    await ca.addMember({ webId: 'b', publicKey: b.publicKey, podAgent: 'did:key:zzz' });
    expect(grants).toEqual(['b']);
  });
});
