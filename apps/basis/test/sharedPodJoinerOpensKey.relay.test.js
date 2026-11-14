/**
 * A JOINER OF A SHARED-POD CIRCLE CAN OPEN THE CIRCLE'S STORED GROUP KEY — through the app's own join.
 *
 * The founder's device owns the circle root on the pod and holds the circle's producer before anyone joins; the
 * member joins through the real invite → redeem path, whose grant (the redeem's `addMember`) wraps the group key
 * for the member; the member's device then builds ITS producer the way both shells build it (the agent's per-circle
 * sealing key pair handed in; the root not its own) over the SAME pod, and opens the stored key with the key it
 * really opens with. One pod, no second writer racing: a pseudo-pod shared by both devices, so a refusal here is
 * a wrong key, never a lost update (that race is the CSS sibling's job).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { PodClient, generateKeypair as podGenerateKeypair } from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses,
  memberSealingPubKey, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { createCirclePodProducer } from '../src/v2/circlePodProducer.js';

const CIRCLE = 'shared-pod-joiner-key';

/** ONE pod both devices reach (the circle's), as a real shared pod is one place for every member. */
function sharedPod() {
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'shared-circle-pod' });
  const client = new PodClient({ podRoot: 'pseudo-pod://shared-circle-pod/', auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
  return { makePodClient: () => client, circleRootUri: `pseudo-pod://shared-circle-pod/circles/${CIRCLE}` };
}

/** The producer as both shells build it (circleApp ensureCirclePod; mobile circlePods buildCirclePod). */
async function shellProducer(node, pod, { ownsRoot }) {
  let sealingKeyPair = null;
  try { sealingKeyPair = node.agent.circleSealingKeyPairFor?.(CIRCLE) ?? null; } catch { sealingKeyPair = null; }
  const producer = await createCirclePodProducer({
    circleId: CIRCLE, storagePosture: 'p2', vault: new VaultMemory(), generateKeypair: podGenerateKeypair, sealingKeyPair,
    makePodClient: pod.makePodClient, circleRootUri: pod.circleRootUri, ownsRoot,
  });
  node.circlePods.set(CIRCLE, producer);
  return { producer, sealingKeyPair };
}

describe('a shared-pod circle: the joiner opens the stored group key', () => {
  let relay; let A; let B;
  afterAll(async () => { await teardown(A, B); try { await relay?.close?.(); } catch { /* */ } });

  it('after the app join, B opens the group key the founder stored, with the key B opens with', async () => {
    relay = await startJourneyRelay();
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectNodesOverRelay([A, B], { relayUrl: relay.url });
    const pod = sharedPod();

    await createCircle(A, { groupId: CIRCLE, name: 'Shared pod' });
    await bindCircleAddresses([A], CIRCLE);
    const a = await shellProducer(A, pod, { ownsRoot: true });
    expect(a.sealingKeyPair?.publicKey, 'the founder has a per-circle sealing key pair').toBeTruthy();

    const joined = await joinExistingCircle(A, B, { groupId: CIRCLE, handle: 'bea' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await bindCircleAddresses([A, B], CIRCLE);
    await Promise.all([A, B].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));

    // the redeem's grant reached the founder's control agent: B's address image is in the stored audience
    const bWrapsFor = memberSealingPubKey(B, CIRCLE);
    const granted = await until(async () => {
      const res = await a.producer.podClient.read(`${pod.circleRootUri}/.keys/group.json`, { decode: 'text' }).catch(() => null);
      const body = typeof res === 'string' ? res : (typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? ''));
      return body.includes(bWrapsFor) ? true : null;
    }, { timeout: 10000, step: 50 });
    expect(granted, 'the founder wrapped the group key for B\'s per-circle address image').toBe(true);

    // B's device builds its producer as the shells do, and opens with what it opens with
    const b = await shellProducer(B, pod, { ownsRoot: false });
    const bOpensWith = await b.producer.sealingIdentity.ensure();
    expect(bOpensWith.publicKey, 'B opens with the key the founder wrapped for').toBe(bWrapsFor);
    const strategy = await b.producer.controlAgent.sealingStrategy(bOpensWith.privateKey);
    expect(strategy, 'B can open the stored group key').toBeTruthy();
  }, 60000);
});
