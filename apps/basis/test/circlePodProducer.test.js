/**
 * Per-circle pod producer (S4 structural slice) — drives the REAL sealing substrate
 * over an in-memory @onderling/pseudo-pod (no OIDC, no CSS, runs in CI). Proves a p2
 * circle gets a real per-circle control agent that bootstraps + seals to its own
 * pod, a p0 circle gets neither (no control agent, no sealing identity — it never seals), and two circles
 * never share a sealing key. This is the in-browser counterpart of the CSS real-pod
 * verify (circleSealing.css.test.js).
 */
import { describe, it, expect } from 'vitest';
import { PodClient, createSealedPodClient, createSealedPodDataSource, generateKeypair } from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster } from '../src/v2/circlePodProducer.js';

class MemVault {
  #m = new Map();
  async get(k) { return this.#m.get(k); }
  async set(k, v) { this.#m.set(k, String(v)); }
  async delete(k) { this.#m.delete(k); }
  async has(k) { return this.#m.has(k); }
}

/** A browser-shaped in-memory pod client factory (what the web host injects). */
function makePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

describe('createCirclePodProducer', () => {
  it('p0 circle → crypto-free no-op (no control agent, no sealing identity)', async () => {
    const vault = new MemVault();
    const prod = await createCirclePodProducer({ circleId: 'c0', storagePosture: 'p0', vault });
    expect(prod.controlAgent).toBeNull();
    expect(prod.podClient).toBeNull();
    expect(prod.sealingIdentity).toBeNull();   // p0 never seals → no x25519 keygen (browser-safe)
  });

  it('rejects a sealed circle without generateKeypair + makePodClient', async () => {
    const vault = new MemVault();
    await expect(createCirclePodProducer({ circleId: 'c', storagePosture: 'p2', vault }))
      .rejects.toThrow(/generateKeypair|makePodClient/);
  });

  it('p2 circle → a real control agent bootstrapped over its own pseudo-pod; sealed round-trip', async () => {
    const vault = new MemVault();
    const alice = generateKeypair();
    const prod = await createCirclePodProducer({
      circleId: 'alpha', storagePosture: 'p2', vault,
      roster: [{ webId: 'did:alice', publicKey: alice.publicKey, role: 'admin' }],
      generateKeypair, makePodClient,
    });
    expect(prod.controlAgent).not.toBeNull();
    expect(prod.storagePosture).toBe('p2');
    // bootstrap ran → alice (the initial roster) can resolve the group key + seal/open round-trips
    const strat = await prod.controlAgent.sealingStrategy(alice.privateKey);
    expect(strat.open(strat.seal('hoi'))).toBe('hoi');
    // and the sealed content really lands on the circle's pod, opened back transparently
    const sealed = createSealedPodClient(prod.podClient, strat);
    await sealed.write(`${prod.circleRootUri}/shared/n.txt`, 'alleen voor alpha');
    expect((await sealed.read(`${prod.circleRootUri}/shared/n.txt`)).content).toBe('alleen voor alpha');
  });

  it('persists the controller key across producers for the same circle (vault-backed)', async () => {
    const vault = new MemVault();
    const mk = (n = 0) => createCirclePodProducer({
      circleId: 'beta', storagePosture: 'p2', vault, generateKeypair, makePodClient, bootstrap: n === 0,
    });
    await mk(0);
    const k1 = await vault.get('cc.circle-controller-key:beta');
    await mk(1);
    const k2 = await vault.get('cc.circle-controller-key:beta');
    expect(k1).toBe(k2);                       // same controller key reused, not regenerated
    expect(JSON.parse(k1)).toHaveProperty('privateKey');
  });

  it('persists the group key across reloads: a fresh producer (new pod, same vault) restores it + opens prior content', async () => {
    const vault = new MemVault();
    const text = 'overleeft een reload';
    // session 1 — seal a string under the circle's group key
    const p1 = await createCirclePodProducer({ circleId: 'dur', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const id1 = await p1.sealingIdentity.ensure();
    const sealed = (await p1.controlAgent.sealingStrategy(id1.privateKey)).seal(text);
    expect(await vault.get('cc.circle-groupkey:dur')).toBeTruthy();   // group key persisted to the vault
    // session 2 — SAME vault, FRESH pseudo-pod (makePodClient mints a new in-memory backend)
    const p2 = await createCirclePodProducer({ circleId: 'dur', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const id2 = await p2.sealingIdentity.ensure();
    expect(id2.publicKey).toBe(id1.publicKey);                        // same persisted sealing identity
    const s2 = await p2.controlAgent.sealingStrategy(id2.privateKey);
    expect(s2.open(sealed)).toBe(text);                              // restored group key opens session-1 ciphertext
  });

  it('control-agent router grows the roster: a redeemed member becomes able to decrypt the circle', async () => {
    const vault = new MemVault();
    const bob = generateKeypair();
    const prod = await createCirclePodProducer({ circleId: 'rg', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const pods = new Map([['rg', prod]]);
    const router = createCircleControlAgentRouter((id) => pods.get(id) ?? null);

    // before redeem: bob is NOT a recipient of the group key
    await expect(prod.controlAgent.sealingStrategy(bob.privateKey)).rejects.toThrow();
    // redeem → stoop routes addMember(bob, groupId:rg) to this circle's producer
    await router.addMember({ webId: 'did:bob', publicKey: bob.publicKey, role: 'member', groupId: 'rg' });
    // now bob can open content sealed by the circle (the local self identity)
    const self = await prod.sealingIdentity.ensure();
    const sealed = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('voor de hele circle');
    expect((await prod.controlAgent.sealingStrategy(bob.privateKey)).open(sealed)).toBe('voor de hele circle');

    // leave → revoke + rotate; bob can no longer unwrap (forward secrecy)
    await router.removeMember({ webId: 'did:bob', groupId: 'rg' });
    await expect(prod.controlAgent.sealingStrategy(bob.privateKey)).rejects.toThrow();
  });

  it('seedCircleRoster wraps the group key to members who joined before the producer was live', async () => {
    const vault = new MemVault();
    const bob = generateKeypair();
    const prod = await createCirclePodProducer({ circleId: 'seed', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const pods = new Map([['seed', prod]]);
    const router = createCircleControlAgentRouter((id) => pods.get(id) ?? null);
    await expect(prod.controlAgent.sealingStrategy(bob.privateKey)).rejects.toThrow();   // not a recipient yet

    // listGroupMembers surfaces bob with his sealing public key (from the redemption trail)
    const callSkill = async (app, op) => (op === 'listGroupMembers'
      ? { members: [{ webid: 'did:bob', sealingPublicKey: bob.publicKey, role: 'member' }, { webid: 'did:anne', role: 'admin' }] }
      : {});
    const n = await seedCircleRoster({ callSkill, circleId: 'seed', router });
    expect(n).toBe(1);   // only bob had a sealing key

    const self = await prod.sealingIdentity.ensure();
    const sealed = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('voor iedereen');
    expect((await prod.controlAgent.sealingStrategy(bob.privateKey)).open(sealed)).toBe('voor iedereen');
  });

  it('seedCircleRoster no-ops without callSkill / router / members', async () => {
    expect(await seedCircleRoster({})).toBe(0);
    expect(await seedCircleRoster({ callSkill: async () => ({ members: [] }), circleId: 'x', router: { addMember: async () => {} } })).toBe(0);
  });

  it('router no-ops for an unknown / unsealed circle', async () => {
    const router = createCircleControlAgentRouter(() => null);
    await expect(router.addMember({ webId: 'x', publicKey: 'k', groupId: 'none' })).resolves.toBeUndefined();
    await expect(router.removeMember({ webId: 'x', groupId: 'none' })).resolves.toBeUndefined();
  });

  it('scopes by circle: two sealed circles get different sealing identities', async () => {
    const vault = new MemVault();
    const mk = (circleId) => createCirclePodProducer({ circleId, storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const a = await (await mk('x')).sealingIdentity.ensure();
    const b = await (await mk('y')).sealingIdentity.ensure();
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

/**
 * Group-key PROVISIONING at the substrate seam (the gap this branch closes): a sealed
 * circle's bootstrap must write the group-key resource AND yield a non-null content
 * strategy that engages L1b's `createSealedPodDataSource` for a granted member — while a
 * non-granted member never gets plaintext. Covers BOTH sealed postures (p2 group-key,
 * p3 recipient) — p3 previously returned a null strategy (the discovered bug), so L1b
 * stayed dormant for it.
 */
describe('circle group-key provisioning → getCircleSealStrategy activates L1b', () => {
  /** A minimal in-memory `SolidPodSource`-shaped source for `createSealedPodDataSource`. */
  function memPodSource() {
    const store = new Map();
    return {
      async read(uri) { if (!store.has(uri)) { const e = new Error('nf'); e.code = 'NOT_FOUND'; throw e; } return { content: store.get(uri) }; },
      async write(uri, content) { store.set(uri, String(content)); },
      async delete(uri) { store.delete(uri); },
      async list(prefix) { return { entries: [...store.keys()].filter((k) => k.startsWith(prefix)).map((uri) => ({ uri })) }; },
    };
  }

  for (const posture of ['p2', 'p3']) {
    it(`${posture}: bootstrap provisions the key; a granted member round-trips through createSealedPodDataSource`, async () => {
      const vault = new MemVault();
      const prod = await createCirclePodProducer({ circleId: `prov-${posture}`, storagePosture: posture, vault, generateKeypair, makePodClient });

      // bootstrap wrote the group-key resource to the circle's pod key store
      const keyRes = await prod.podClient.read(`${prod.circleRootUri}/.keys/group.json`, { decode: 'string' });
      expect(typeof keyRes === 'string' ? keyRes : keyRes?.content).toBeTruthy();

      // a granted member (the local self identity) resolves a real, non-null strategy
      const self = await prod.sealingIdentity.ensure();
      const strategy = await prod.controlAgent.sealingStrategy(self.privateKey);
      expect(strategy).not.toBeNull();

      // …and that strategy engages L1b: a sealed pod-backed DataSource round-trips plaintext
      const ds = createSealedPodDataSource({ podSource: memPodSource(), strategy });
      expect(ds.sealed).toBe(true);
      const uri = `${prod.circleRootUri}/items/x.json`;
      await ds.write(uri, JSON.stringify({ hoi: 'circle' }));
      expect(JSON.parse(await ds.read(uri))).toEqual({ hoi: 'circle' });
      expect(await ds.list(`${prod.circleRootUri}/items/`)).toEqual([uri]);
    });

    it(`${posture}: a NON-granted member gets no plaintext (strategy gate rejects; ciphertext stays sealed)`, async () => {
      const vault = new MemVault();
      const outsider = generateKeypair();
      const prod = await createCirclePodProducer({ circleId: `deny-${posture}`, storagePosture: posture, vault, generateKeypair, makePodClient });

      // the outsider is not a recipient of the group-key resource → the strategy gate rejects
      // (getCircleSealStrategy catches this → null, so L1b never engages with a bogus strategy).
      await expect(prod.controlAgent.sealingStrategy(outsider.privateKey)).rejects.toThrow();

      // and even holding the ciphertext, the outsider's key cannot open content sealed to the roster
      const self = await prod.sealingIdentity.ensure();
      const insider = await prod.controlAgent.sealingStrategy(self.privateKey);
      const sealed = insider.seal('geheim');
      const { recipientStrategy, groupKeyStrategy, generateGroupKey } = await import('@onderling/pod-client');
      const outsiderStrat = posture === 'p3'
        ? recipientStrategy({ recipients: [outsider.publicKey], privateKey: outsider.privateKey })
        : groupKeyStrategy({ groupKey: generateGroupKey() /* a valid but WRONG group key */ });
      expect(() => outsiderStrat.open(sealed)).toThrow();   // no silent plaintext
    });
  }

  it('re-bootstrap is idempotent: no rotation, no duplicate roster, SAME group key', async () => {
    const vault = new MemVault();
    const prod = await createCirclePodProducer({ circleId: 'idem', storagePosture: 'p2', vault, generateKeypair, makePodClient });
    const self = await prod.sealingIdentity.ensure();
    const before = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('v1-ct');

    // a second bootstrap must NOT rotate (it would break the ≥1-version invariant + orphan prior ciphertext)
    const second = await prod.controlAgent.bootstrap();
    expect(second).toBeNull();                                            // idempotent no-op
    const after = await prod.controlAgent.sealingStrategy(self.privateKey);
    expect(after.open(before)).toBe('v1-ct');                            // same group key still opens prior ciphertext

    // re-adding an already-granted member is likewise a no-op (no roster duplication, no re-wrap)
    const membersBefore = prod.controlAgent.members().length;
    const selfEntry = prod.controlAgent.members()[0];
    await prod.controlAgent.addMember({ webId: 'dup', publicKey: selfEntry.publicKey, role: 'member' });
    expect(prod.controlAgent.members().length).toBe(membersBefore);       // unchanged
  });
});
