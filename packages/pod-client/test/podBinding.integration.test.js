import { describe, it, expect, vi } from 'vitest';
import { createPodKeyStore, readGroupKey } from '../src/sealing/podKeyStore.js';
import {
  createControlAgent, createSealedPodClient, groupKeyStrategy,
  generateKeypair, isSealed,
} from '../src/sealing/index.js';

// A Map-backed fake pod (what the host holds). read returns {content}; missing → NOT_FOUND.
function fakePod() {
  const store = new Map();
  return {
    store,
    async read(uri) {
      if (!store.has(uri)) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
      return { uri, content: store.get(uri), contentType: 'text/plain', etag: 'W/1' };
    },
    async write(uri, content) { store.set(uri, content); return { uri, ok: true }; },
  };
}

function fakeSharing() {
  const acl = []; // {op, agent}
  return {
    acl,
    grant: vi.fn(async ({ agent }) => { acl.push({ op: 'grant', agent }); }),
    revoke: vi.fn(async ({ agent }) => { acl.push({ op: 'revoke', agent }); }),
  };
}

const KEY_URI = 'https://pod/circle/.keys/group.json';
const CONTENT_URI = 'https://pod/circle/list';

describe('pod binding — control-agent ↔ pod key resource ↔ sealed content (end-to-end)', () => {
  it('join grants ACL + persists a key resource each member can unwrap from the pod', async () => {
    const pod = fakePod();
    const sharing = fakeSharing();
    const keyStore = createPodKeyStore({ podClient: pod, uri: KEY_URI });
    const controller = generateKeypair();
    const agent = createControlAgent({ sharing, containerUri: 'https://pod/circle/', keyStore, controllerKey: controller });

    const alice = generateKeypair();
    const bob = generateKeypair();
    await agent.addMember({ webId: 'did:alice', publicKey: alice.publicKey, role: 'admin' });
    await agent.addMember({ webId: 'did:bob', publicKey: bob.publicKey });

    // ACL grants happened; the key resource is on the pod as JSON (host sees only the sealed blob).
    expect(sharing.acl).toEqual([{ op: 'grant', agent: 'did:alice' }, { op: 'grant', agent: 'did:bob' }]);
    const onPod = JSON.parse(pod.store.get(KEY_URI));
    expect(onPod.version).toBe(1);
    expect(isSealed(onPod.sealed)).toBe(true);

    // Each member independently reads the pod + unwraps the SAME group key.
    const aliceKey = await readGroupKey({ keyStore, privateKey: alice.privateKey });
    const bobKey = await readGroupKey({ keyStore, privateKey: bob.privateKey });
    expect(aliceKey).toBeTruthy();
    expect(bobKey).toBe(aliceKey);

    // Alice writes circle content through a SealedPodClient under the group key; the host holds ciphertext.
    const aliceClient = createSealedPodClient(pod, groupKeyStrategy({ groupKey: aliceKey }));
    await aliceClient.write(CONTENT_URI, 'milk, bread, soap');
    expect(isSealed(pod.store.get(CONTENT_URI))).toBe(true);
    expect(pod.store.get(CONTENT_URI)).not.toContain('milk');

    // Bob reads it back through his own client built from his unwrapped key.
    const bobClient = createSealedPodClient(pod, groupKeyStrategy({ groupKey: bobKey }));
    expect((await bobClient.read(CONTENT_URI)).content).toBe('milk, bread, soap');
  });

  it('leave revokes ACL + rotates: the departed cannot read content sealed AFTER they left', async () => {
    const pod = fakePod();
    const sharing = fakeSharing();
    const keyStore = createPodKeyStore({ podClient: pod, uri: KEY_URI });
    const controller = generateKeypair();
    const agent = createControlAgent({ sharing, containerUri: 'https://pod/circle/', keyStore, controllerKey: controller });

    const alice = generateKeypair();
    const leaver = generateKeypair();
    await agent.addMember({ webId: 'did:alice', publicKey: alice.publicKey, role: 'admin' });
    await agent.addMember({ webId: 'did:leaver', publicKey: leaver.publicKey });

    // leaver had access — read the v1 key.
    const leaverKeyV1 = await readGroupKey({ keyStore, privateKey: leaver.privateKey });
    expect(leaverKeyV1).toBeTruthy();

    // leaver departs → ACL revoke + key rotation persisted to the pod.
    await agent.removeMember({ webId: 'did:leaver' });
    expect(sharing.acl.at(-1)).toEqual({ op: 'revoke', agent: 'did:leaver' });
    expect(JSON.parse(pod.store.get(KEY_URI)).version).toBe(2);

    // leaver can no longer unwrap the current key from the pod...
    await expect(readGroupKey({ keyStore, privateKey: leaver.privateKey })).rejects.toThrow(/not a recipient/);

    // ...so new content (sealed under v2) is unreadable to them, but alice reads it.
    const aliceKeyV2 = await readGroupKey({ keyStore, privateKey: alice.privateKey });
    expect(aliceKeyV2).not.toBe(leaverKeyV1);
    const aliceClient = createSealedPodClient(pod, groupKeyStrategy({ groupKey: aliceKeyV2 }));
    await aliceClient.write(CONTENT_URI, 'post-leave secret');
    expect((await aliceClient.read(CONTENT_URI)).content).toBe('post-leave secret');
    const leaverStaleClient = createSealedPodClient(pod, groupKeyStrategy({ groupKey: leaverKeyV1 }));
    // the stale (v1) key fails to decrypt the v2-sealed body
    await expect(leaverStaleClient.read(CONTENT_URI)).rejects.toThrow();
  });

  it('readGroupKey returns null before the circle is bootstrapped', async () => {
    const pod = fakePod();
    const keyStore = createPodKeyStore({ podClient: pod, uri: KEY_URI });
    expect(await readGroupKey({ keyStore, privateKey: generateKeypair().privateKey })).toBeNull();
  });
});
