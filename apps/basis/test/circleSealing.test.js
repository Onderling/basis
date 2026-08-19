/**
 * Per-circle sealing — the SAFE offline slice of the S4 pod foundation
 * (circleSealingIdentity + circleControlAgent). Drives the REAL @onderling/pod-client
 * sealing substrate against an in-memory pod + mock ACL sharing — no real Solid
 * pod, no OIDC. Proves: a per-circle sealing identity is stable + scoped, and a
 * p2 circle's control agent bootstraps, grants ACL + seals the group key on join,
 * and revokes + rotates (forward secrecy) on leave.
 */
import { describe, it, expect } from 'vitest';
import { generateKeypair } from '@onderling/pod-client';
import { createCircleSealingIdentity } from '../src/v2/circleSealingIdentity.js';
import { createCircleControlAgent } from '../src/v2/circleControlAgent.js';

// ── in-memory fakes (no pod / no OIDC) ───────────────────────────────────────
class MemVault {
  #m = new Map();
  async get(k) { return this.#m.get(k); }
  async set(k, v) { this.#m.set(k, String(v)); }
  async delete(k) { this.#m.delete(k); }
  async has(k) { return this.#m.has(k); }
}
class MemPodClient {
  #m = new Map();
  async read(uri) {
    if (!this.#m.has(uri)) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
    return { content: this.#m.get(uri) };
  }
  async write(uri, content) { this.#m.set(uri, String(content)); }
}
function mockSharing() {
  const grants = []; const revokes = [];
  return { grant: async (o) => { grants.push(o); }, revoke: async (o) => { revokes.push(o); }, grants, revokes };
}

describe('createCircleSealingIdentity', () => {
  it('creates + persists a per-circle sealing identity, stable across reloads', async () => {
    const vault = new MemVault();
    const k1 = await createCircleSealingIdentity({ circleId: 'c1', store: vault }).ensure();
    expect(k1.publicKey).toBeTruthy();
    // a fresh wrapper over the same vault loads the SAME key (persisted).
    const k2 = await createCircleSealingIdentity({ circleId: 'c1', store: vault }).ensure();
    expect(k2.publicKey).toBe(k1.publicKey);

    const entry = await createCircleSealingIdentity({ circleId: 'c1', store: vault }).rosterEntry('did:alice', 'member');
    expect(entry).toMatchObject({ webId: 'did:alice', publicKey: k1.publicKey, role: 'member' });
  });

  it('scopes by circle: two circles get different sealing keys', async () => {
    const vault = new MemVault();
    const a = await createCircleSealingIdentity({ circleId: 'a', store: vault }).ensure();
    const b = await createCircleSealingIdentity({ circleId: 'b', store: vault }).ensure();
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it('rejects a missing circleId or store', () => {
    expect(() => createCircleSealingIdentity({ store: new MemVault() })).toThrow(/circleId/);
    expect(() => createCircleSealingIdentity({ circleId: 'c' })).toThrow(/store/);
  });
});

describe('createCircleControlAgent', () => {
  it('p0/p1 → null (no sealing, no control agent)', () => {
    expect(createCircleControlAgent({ circleId: 'c', storagePosture: 'p0' })).toBeNull();
    expect(createCircleControlAgent({ circleId: 'c', storagePosture: 'p1' })).toBeNull();
  });

  it('a sealed posture requires podClient + sharing + controllerKey', () => {
    expect(() => createCircleControlAgent({ circleId: 'c', storagePosture: 'p2' })).toThrow(/podClient|sharing|controllerKey/);
  });

  it('p2: bootstrap → addMember (ACL grant + group-key seal) → removeMember (revoke + rotate, forward secrecy)', async () => {
    const controller = generateKeypair();
    const alice = generateKeypair();
    const podClient = new MemPodClient();
    const sharing = mockSharing();

    const cca = createCircleControlAgent({
      circleId: 'c1', storagePosture: 'p2', podClient, sharing, controllerKey: controller,
    });
    expect(cca).not.toBeNull();
    expect(cca.storagePosture).toBe('p2');

    await cca.bootstrap();
    await cca.addMember({ webId: 'did:alice', publicKey: alice.publicKey });
    expect(sharing.grants).toHaveLength(1);
    expect(cca.members().map((m) => m.webId)).toContain('did:alice');

    // Alice (a current recipient) can resolve the circle's content-sealing strategy.
    const strat = await cca.sealingStrategy(alice.privateKey);
    expect(typeof strat?.seal).toBe('function');
    expect(typeof strat?.open).toBe('function');
    // round-trips through the group-key seal.
    expect(strat.open(strat.seal('hallo circle'))).toBe('hallo circle');

    // Leaving revokes ACL + rotates the key → Alice can no longer unwrap (forward secrecy).
    await cca.removeMember({ webId: 'did:alice' });
    expect(sharing.revokes).toHaveLength(1);
    expect(cca.members().map((m) => m.webId)).not.toContain('did:alice');
    await expect(cca.sealingStrategy(alice.privateKey)).rejects.toThrow();
  });

  it('p2 cross-version: a still-current member opens content sealed under an OLDER version after a rotation; a drop-out cannot', async () => {
    const controller = generateKeypair();
    const alice = generateKeypair();
    const bob = generateKeypair();
    const podClient = new MemPodClient();
    const sharing = mockSharing();

    const cca = createCircleControlAgent({
      circleId: 'cx', storagePosture: 'p2', podClient, sharing, controllerKey: controller,
    });
    await cca.bootstrap();
    await cca.addMember({ webId: 'did:alice', publicKey: alice.publicKey });
    await cca.addMember({ webId: 'did:bob', publicKey: bob.publicKey });

    // Alice seals content under the CURRENT (pre-rotation) group-key version.
    const stratV1 = await cca.sealingStrategy(alice.privateKey);
    const sealedV1 = stratV1.seal('van voor de rotatie');

    // Bob leaves → the group key ROTATES to a new version (Alice stays a member; v1 is retained in history[]).
    await cca.removeMember({ webId: 'did:bob' });

    // Alice (still current) gets a FRESH strategy that opens the OLD-version content AND current content.
    const stratV2 = await cca.sealingStrategy(alice.privateKey);
    expect(stratV2.open(sealedV1)).toBe('van voor de rotatie');                  // ← cross-version read
    expect(stratV2.open(stratV2.seal('na de rotatie'))).toBe('na de rotatie');   // current version still round-trips

    // Bob (a drop-out) is denied at the membership gate — NO access, historic or otherwise (forward secrecy).
    await expect(cca.sealingStrategy(bob.privateKey)).rejects.toThrow();
  });
});
