import { describe, it, expect } from 'vitest';
import { createMemberSealingIdentity } from '../src/sealing/memberIdentity.js';
import { seal, open, recipientId } from '../src/sealing/index.js';

// A Vault-shaped mock (get/set).
function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); } };
}

describe('createMemberSealingIdentity', () => {
  it('generates + persists a keypair on first use, then reuses it', async () => {
    const store = memStore();
    const id = createMemberSealingIdentity({ store });
    const a = await id.ensure();
    expect(a.publicKey).toBeTruthy();
    expect(a.privateKey).toBeTruthy();
    expect(store.m.has('cc.sealing-identity')).toBe(true);     // persisted
    const b = await id.ensure();
    expect(b.publicKey).toBe(a.publicKey);                      // stable across calls
    // a fresh wrapper over the SAME store loads the same identity (cross-session)
    const id2 = createMemberSealingIdentity({ store });
    expect((await id2.ensure()).publicKey).toBe(a.publicKey);
  });

  it('publicKey never exposes the private key; the keypair actually seals/opens', async () => {
    const id = createMemberSealingIdentity({ store: memStore() });
    const pub = await id.publicKey();
    const { privateKey } = await id.ensure();
    const env = seal('to me', pub);
    expect(open(env, privateKey)).toBe('to me');               // a roster wrap to this member works
  });

  it('rosterEntry is the { webId, publicKey, role } shape the control-agent consumes', async () => {
    const id = createMemberSealingIdentity({ store: memStore() });
    const entry = await id.rosterEntry('did:alice', 'admin');
    expect(entry).toMatchObject({ webId: 'did:alice', role: 'admin' });
    expect(recipientId(entry.publicKey)).toBeTruthy();
    await expect(id.rosterEntry()).rejects.toThrow(/webId/);
  });

  it('respects a custom vault key + requires a get/set store', async () => {
    const store = memStore();
    await createMemberSealingIdentity({ store, key: 'household/seal' }).ensure();
    expect(store.m.has('household/seal')).toBe(true);
    expect(() => createMemberSealingIdentity({ store: {} })).toThrow(/get\/set/);
  });

  it('tolerates a parsed-object (not just JSON-string) vault value', async () => {
    const kp = await createMemberSealingIdentity({ store: memStore() }).ensure();
    const store = memStore({ 'cc.sealing-identity': kp });     // stored as a raw object
    expect((await createMemberSealingIdentity({ store }).ensure()).publicKey).toBe(kp.publicKey);
  });
});
