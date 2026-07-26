import { describe, it, expect, vi } from 'vitest';
import { createControlAgent } from '../src/sealing/controlAgent.js';
import { generateKeypair, unwrapGroupKey, buildGroupKeyResource, generateGroupKey, grantMember } from '../src/sealing/index.js';

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

  it('re-adding an already-granted member (same public key) is an idempotent no-op', async () => {
    const { agent, grants, keyStore } = setup();
    const a = generateKeypair();
    await agent.addMember({ webId: 'did:alice', publicKey: a.publicKey, role: 'admin' });
    const v1 = keyStore.current();
    // same sealing key again (e.g. seedCircleRoster re-runs, or a duplicate redeem) → no re-grant,
    // no re-wrap, no roster duplication, no version bump.
    const { keyResource, members } = await agent.addMember({ webId: 'did:alice', publicKey: a.publicKey });
    expect(grants).toHaveLength(1);                       // no second ACL grant
    expect(members.map((m) => m.webId)).toEqual(['did:alice']);  // no duplicate roster entry
    expect(keyResource).toBe(v1);                          // exact same resource object (not rewritten)
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

describe('controlAgent — emits log key-events (self-distributing key, no pod)', () => {
  function sealedSetup() {
    const sharing = { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };
    let stored = null;
    const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
    const controllerKey = generateKeypair();
    const log = [];
    const keyEventLog = { append: (e) => { log.push(e); } };
    const agent = createControlAgent({ sharing, containerUri: 'https://pod/c/', keyStore, controllerKey, keyEventLog, groupId: 'c1' });
    return { agent, controllerKey, log, keyStore: { current: () => stored } };
  }

  it('grant + remove each emit a key-event, and the rotation key-event excludes the departed member', async () => {
    const { agent, log } = sealedSetup();
    const bob = generateKeypair();
    const carol = generateKeypair();

    await agent.addMember({ webId: 'did:bob', publicKey: bob.publicKey, role: 'admin' });
    await agent.addMember({ webId: 'did:carol', publicKey: carol.publicKey });
    const afterAdds = log.length;
    expect(afterAdds).toBeGreaterThanOrEqual(2);                 // an establish/grant event per add
    expect(log.every((e) => e.kind === 'group-key-event' && e.groupId === 'c1')).toBe(true);
    const beforeRemove = log[log.length - 1];
    expect(beforeRemove.recipients).toContain(carol.publicKey);  // carol is a recipient while a member

    await agent.removeMember({ webId: 'did:carol' });
    expect(log.length).toBe(afterAdds + 1);                      // removal emitted exactly one rotation event
    const rotation = log[log.length - 1];
    expect(rotation.version).toBe(beforeRemove.version + 1);     // a NEW version
    expect(rotation.recipients).not.toContain(carol.publicKey);  // sealed to the REMAINING members only
    expect(rotation.recipients).toContain(bob.publicKey);
  });
});

// ── Rotation audience: current HOLDERS minus the departing member, not the roster ──────────────────────
//
// This resource can hold recipients who are NOT roster members — an out-of-circle CANONICAL SHARE grants by
// adding the recipient's sealing key here (`createCanonicalShare.share` → `grantMember`). Rotating to the
// roster alone evicted every such grantee whenever ANY member was removed: a silent access loss for someone
// unrelated to the removal (stories 1.6 / 11.2 in plans/NOTE-multi-device-user-stories.md — the third place
// this bug class appeared, hence the rule now stated in removeMember).
describe('controlAgent — removeMember rotates to holders MINUS the departed, not to the roster', () => {
  const canOpen = (resource, privateKey) => {
    try { return !!unwrapGroupKey(resource, privateKey); } catch { return false; }
  };

  /** A control agent over a store we can also read/write directly (to splice in an out-of-circle grantee). */
  function harness() {
    const controllerKey = generateKeypair();
    const bram = generateKeypair();
    let stored = buildGroupKeyResource({
      version: 1, groupKey: generateGroupKey(), recipients: [controllerKey.publicKey, bram.publicKey],
    });
    const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
    const sharing = { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };
    const agent = createControlAgent({
      sharing, containerUri: 'https://pod/circle/', keyStore, controllerKey,
      roster: [{ webId: 'did:me', publicKey: controllerKey.publicKey, role: 'admin' },
               { webId: 'did:bram', publicKey: bram.publicKey, role: 'member' }],
    });
    return { agent, controllerKey, bram, current: () => stored, keyStore };
  }

  it('an out-of-circle grantee SURVIVES an unrelated member removal', async () => {
    const h = harness();
    const cato = generateKeypair();
    // Grant Cato exactly as canonicalShare.share does — a re-wrap into THIS resource.
    await h.keyStore.write(grantMember(h.current(), {
      newRecipient: cato.publicKey,
      granterPrivateKey: h.controllerKey.privateKey,
      currentRecipients: h.current().recipients,
    }));
    expect(canOpen(h.current(), cato.privateKey)).toBe(true);

    await h.agent.removeMember({ webId: 'did:bram' });

    expect(canOpen(h.current(), h.bram.privateKey)).toBe(false);        // the departed IS evicted
    expect(canOpen(h.current(), cato.privateKey)).toBe(true);           // ← used to be false (the bug)
    expect(canOpen(h.current(), h.controllerKey.privateKey)).toBe(true);
  });

  it('still evicts the departed under the ban policy, and still keeps the grantee', async () => {
    const h = harness();
    const cato = generateKeypair();
    await h.keyStore.write(grantMember(h.current(), {
      newRecipient: cato.publicKey,
      granterPrivateKey: h.controllerKey.privateKey,
      currentRecipients: h.current().recipients,
    }));

    await h.agent.removeMember({ webId: 'did:bram', policy: 'ban' });

    expect(canOpen(h.current(), h.bram.privateKey)).toBe(false);
    expect(canOpen(h.current(), cato.privateKey)).toBe(true);
  });
});
