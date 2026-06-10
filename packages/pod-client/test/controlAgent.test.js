import { describe, it, expect, vi } from 'vitest';
import { createControlAgent } from '../src/sealing/controlAgent.js';
import { generateKeypair, unwrapGroupKey } from '../src/sealing/index.js';

function setup({ roster = [] } = {}) {
  const grants = []; const revokes = [];
  const sharing = {
    grant: vi.fn(async (o) => { grants.push(o); }),
    revoke: vi.fn(async (o) => { revokes.push(o); }),
  };
  let stored = null;
  const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
  const controllerKey = generateKeypair();
  const agent = createControlAgent({ sharing, containerUri: 'https://pod/circle/', keyStore, controllerKey, roster });
  return { agent, sharing, grants, revokes, keyStore: { current: () => stored }, controllerKey };
}

describe('controlAgent — join', () => {
  it('grants ACL + seals the group key to the new member (and the controller can read it)', async () => {
    const { agent, grants, keyStore, controllerKey } = setup();
    const alice = generateKeypair();
    const { keyResource } = await agent.addMember({ webId: 'did:alice', publicKey: alice.publicKey, role: 'admin' });

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ containerUri: 'https://pod/circle/', agent: 'did:alice', modes: ['read', 'write'] });
    expect(unwrapGroupKey(keyResource, alice.privateKey)).toBeTruthy();        // alice can read
    expect(unwrapGroupKey(keyResource, controllerKey.privateKey)).toBeTruthy(); // controller too
    expect(agent.members().map((m) => m.webId)).toEqual(['did:alice']);
    expect(keyStore.current().version).toBe(1);
  });

  it('a second join is an O(1) re-wrap of the SAME key (same version); both members read it', async () => {
    const { agent } = setup();
    const a = generateKeypair(); const b = generateKeypair();
    const r1 = (await agent.addMember({ webId: 'a', publicKey: a.publicKey, role: 'admin' })).keyResource;
    const r2 = (await agent.addMember({ webId: 'b', publicKey: b.publicKey })).keyResource;
    expect(r2.version).toBe(1);                                  // grant does not bump version
    expect(unwrapGroupKey(r2, a.privateKey)).toBe(unwrapGroupKey(r1, a.privateKey));  // same group key
    expect(unwrapGroupKey(r2, b.privateKey)).toBe(unwrapGroupKey(r1, a.privateKey));  // b reads the same key
  });
});

describe('controlAgent — leave', () => {
  it('revokes ACL + rotates: the departed loses NEW content, remaining members keep access', async () => {
    const { agent, revokes } = setup();
    const a = generateKeypair(); const b = generateKeypair(); const leaver = generateKeypair();
    await agent.addMember({ webId: 'a', publicKey: a.publicKey, role: 'admin' });
    await agent.addMember({ webId: 'b', publicKey: b.publicKey });
    await agent.addMember({ webId: 'leaver', publicKey: leaver.publicKey });

    const { keyResource } = await agent.removeMember({ webId: 'leaver' });
    expect(revokes).toHaveLength(1);
    expect(revokes[0]).toMatchObject({ agent: 'leaver' });
    expect(keyResource.version).toBe(2);                          // rotated
    expect(unwrapGroupKey(keyResource, a.privateKey)).toBeTruthy();
    expect(() => unwrapGroupKey(keyResource, leaver.privateKey)).toThrow(/not a recipient/);
    expect(agent.members().map((m) => m.webId)).toEqual(['a', 'b']);
  });

  it('removing a non-member is a no-op', async () => {
    const { agent, revokes } = setup();
    const r = await agent.removeMember({ webId: 'ghost' });
    expect(r.removed).toBe(false);
    expect(revokes).toHaveLength(0);
  });
});

describe('controlAgent — ≥1-admin invariant', () => {
  it('refuses to remove the last admin; force (pod-owner break-glass) bypasses', async () => {
    const { agent } = setup();
    const a = generateKeypair(); const b = generateKeypair();
    await agent.addMember({ webId: 'admin1', publicKey: a.publicKey, role: 'admin' });
    await agent.addMember({ webId: 'member1', publicKey: b.publicKey, role: 'member' });
    await expect(agent.removeMember({ webId: 'admin1' })).rejects.toThrow(/last admin/);
    // force bypasses (break-glass)
    const r = await agent.removeMember({ webId: 'admin1', force: true });
    expect(r.removed).toBe(true);
  });

  it('removing a non-last admin is allowed', async () => {
    const { agent } = setup();
    const a = generateKeypair(); const b = generateKeypair();
    await agent.addMember({ webId: 'admin1', publicKey: a.publicKey, role: 'admin' });
    await agent.addMember({ webId: 'admin2', publicKey: b.publicKey, role: 'admin' });
    const r = await agent.removeMember({ webId: 'admin1' });
    expect(r.removed).toBe(true);
    expect(agent.members().map((m) => m.role)).toEqual(['admin']);
  });
});

describe('controlAgent — bootstrap', () => {
  it('builds an initial key resource for the roster + controller, idempotently', async () => {
    const a = generateKeypair();
    const { agent, controllerKey } = setup({ roster: [{ webId: 'a', publicKey: a.publicKey, role: 'admin' }] });
    const res = await agent.bootstrap();
    expect(res.version).toBe(1);
    expect(unwrapGroupKey(res, a.privateKey)).toBeTruthy();
    expect(unwrapGroupKey(res, controllerKey.privateKey)).toBeTruthy();
    expect(await agent.bootstrap()).toBeNull();                  // idempotent
  });

  it('validates its deps', () => {
    expect(() => createControlAgent({})).toThrow();
    expect(() => createControlAgent({ sharing: { grant() {}, revoke() {} }, keyStore: { read() {}, write() {} } })).toThrow(/controllerKey/);
  });
});
