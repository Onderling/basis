/**
 * A PRODUCER'S START NEVER PUTS ITS VAULT COPY OVER THE POD'S KEY FILE. The founder's producer keeps a copy of the
 * circle's key resource in its vault, for the in-memory pseudo-pod that forgets it on a reload. On a pod that holds the
 * file (a real pod, or one shared by two instances of the founder: two tabs, the page before and after a reload), a copy
 * older than the pod's file took the key from everyone the copy did not list: the join's rebuild, one step earlier.
 * The restore now writes only where nothing is stored; otherwise the pod wins and the vault copy is refreshed from it.
 */
import { describe, it, expect } from 'vitest';
import { PodClient, generateKeypair, unwrapGroupKey } from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { VaultMemory } from '@onderling/vault';
import { createCirclePodProducer } from '../src/v2/circlePodProducer.js';

const CIRCLE = 'restore-keeps-pod';
const KEY_FILE = `pseudo-pod://shared/circles/${CIRCLE}/.keys/group.json`;
const opens = (res, priv) => { try { unwrapGroupKey(res, priv); return true; } catch { return false; } };

/** One pod, a fresh client per instance (each with its own ETag memory), as each tab or device has. */
function sharedPod() {
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'shared' });
  return () => new PodClient({ podRoot: 'pseudo-pod://shared/', auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

async function copyVault(from, keys) {
  const to = new VaultMemory();
  for (const k of keys) { const v = await from.get(k); if (v != null) await to.set(k, v); }
  return to;
}

describe('a producer start with an older vault copy', () => {
  it('keeps the members and devices the pod file holds', async () => {
    const newClient = sharedPod();
    const founderPair = generateKeypair();
    const vaultA = new VaultMemory();
    const start = (vault) => createCirclePodProducer({
      circleId: CIRCLE, storagePosture: 'p2', vault, generateKeypair, sealingKeyPair: founderPair,
      makePodClient: () => newClient(), circleRootUri: `pseudo-pod://shared/circles/${CIRCLE}`,
    });
    const a = await start(vaultA);
    // B's vault: the founder's controller key and the key file AS IT WAS before anyone joined
    const vaultB = await copyVault(vaultA, [`cc.circle-controller-key:${CIRCLE}`, `cc.circle-groupkey:${CIRCLE}`]);

    const member = generateKeypair(); const device = generateKeypair();
    await a.controlAgent.addMember({ webId: 'ref:member', publicKey: member.publicKey });
    await a.controlAgent.grantRecipient({ publicKey: device.publicKey });
    await a.persist();

    const b = await start(vaultB);   // the second instance starts with the older copy
    const stored = await b.controlAgent.keyStore.read();
    expect(opens(stored, member.privateKey), 'the member added by the other instance still opens the key').toBe(true);
    expect(opens(stored, device.privateKey), 'the device enrolled by the other instance still opens the key').toBe(true);
    // …and B's vault copy now follows the pod
    const refreshed = JSON.parse(await vaultB.get(`cc.circle-groupkey:${CIRCLE}`));
    expect(opens(refreshed, member.privateKey), 'the vault copy is refreshed from the pod').toBe(true);
    expect(KEY_FILE).toContain('.keys/group.json');
  });

  it('on an empty pod (the in-memory pod after a reload) the vault copy is restored, the same key kept', async () => {
    const founderPair = generateKeypair();
    const vault = new VaultMemory();
    const mk = () => createCirclePodProducer({
      circleId: CIRCLE, storagePosture: 'p2', vault, generateKeypair, sealingKeyPair: founderPair,
      makePodClient: sharedPod(),   // a NEW empty pod each time, as a reload's in-memory pod is
      circleRootUri: `pseudo-pod://shared/circles/${CIRCLE}`,
    });
    const first = await mk();
    const v1 = await first.controlAgent.keyStore.read();
    const second = await mk();
    const v2 = await second.controlAgent.keyStore.read();
    expect(v2.sealed, 'the restored resource is the one saved').toBe(v1.sealed);
  });
});
