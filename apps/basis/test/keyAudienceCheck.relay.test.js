/**
 * THE KEY'S AUDIENCE FOLLOWS THE MEMBERSHIP, on real agents. The key owner's round takes out a holder whom THIS device
 * granted and the membership lane now places OUT, when the removal never reached the key file:
 *   - a removed member whose rotation was lost (the removal went through while the producer was not there) → revoked;
 *   - a removed member's DEVICE (enrolled with its owner named) → revoked, one per round;
 *   - a member who is in keeps the key; a key nobody granted here stays and is counted;
 *   - a holder ANOTHER instance granted (no note on this device) is kept and counted: naming it needs a link proof that
 *     binds the person (its own row);
 *   - a joiner presenting an address whose key is already in the file gets no note, so nothing is revoked for them.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { unwrapGroupKey, generateKeypair } from '@onderling/pod-client';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, sealCircleViaProducer, memberSealingPubKey, teardown,
} from './support/pairRealAgents.js';
import { runKeyAudienceCheck } from '../src/v2/keyAudienceCheck.js';

const GID = 'audience-follows';
const opensWith = (res, priv) => { try { unwrapGroupKey(res, priv); return true; } catch { return false; } };

describe('the key audience follows the membership', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  it('a lost removal and the removed member\'s device are taken out, one per round; a member keeps the key; an unnoted key stays', async () => {
    [A, B, C] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C')]);
    await connectNodesOverBus([A, B, C]);
    await createCircle(A, { groupId: GID, name: 'Audience' });
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' });
    await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' });
    const producer = await sealCircleViaProducer({ admin: A, members: [B, C], groupId: GID });
    const call = (app, op, args) => A.agent.callSkill(app, op, args);
    const file = () => producer.controlAgent.keyStore.read();
    const opens = async (node) => opensWith(await file(), node.agent.circleSealingKeyPairFor(GID).privateKey);
    expect(producer.keyHolders.of(memberSealingPubKey(C, GID)), 'this device noted whom it granted C\'s key for').toBe(C.pubKey);

    // a device of C, enrolled with its owner named (the announce handler's call)
    const device = generateKeypair();
    await A.circleControlAgentRouter.grantRecipient({ groupId: GID, publicKey: device.publicKey, ownerWebId: C.pubKey });
    expect((await file()).recipients).toContain(device.publicKey);

    // the removal is LOST: C is out on the lane, the key file never rotated (the producer was not there)
    A.circlePods.delete(GID);
    const res = await call('pinboard', 'removeMember', { groupId: GID, memberWebid: C.pubKey });
    expect(res?.error, `removeMember refused: ${res?.error}`).toBeFalsy();
    A.circlePods.set(GID, producer);
    expect(await opens(C), 'the lost removal left C in the key file').toBe(true);

    const r1 = await runKeyAudienceCheck({ circleId: GID, producer, callSkill: call });
    const r2 = await runKeyAudienceCheck({ circleId: GID, producer, callSkill: call });
    expect([r1.revoked, r2.revoked], 'one rotation per round').toEqual([1, 1]);
    expect(await opens(C), 'C is out of the key').toBe(false);
    expect((await file()).recipients, 'C\'s device is out of the key').not.toContain(device.publicKey);
    expect(await opens(B), 'B keeps the key').toBe(true);
    expect(await opens(A), 'the founder keeps the key').toBe(true);

    // a key nobody granted here stays, and is counted
    const stranger = generateKeypair();
    await producer.controlAgent.grantRecipient({ publicKey: stranger.publicKey });
    const r3 = await runKeyAudienceCheck({ circleId: GID, producer, callSkill: call });
    expect(r3.revoked).toBe(0);
    expect(r3.counts.unmapped).toBe(1);
    expect((await file()).recipients).toContain(stranger.publicKey);
  }, 120_000);

  it('a holder another instance granted (no note here) is kept and counted, even once they are removed', async () => {
    const GID2 = `${GID}-2`;
    await createCircle(A, { groupId: GID2, name: 'Audience two' });
    const sealed = await sealCircleViaProducer({ admin: A, members: [], groupId: GID2 });
    A.circlePods.delete(GID2);
    await joinExistingCircle(A, B, { groupId: GID2, handle: 'bee' });
    A.circlePods.set(GID2, sealed);
    await sealed.controlAgent.grantRecipient({ publicKey: memberSealingPubKey(B, GID2) });   // another instance's grant
    expect(sealed.keyHolders.of(memberSealingPubKey(B, GID2)), 'no note: this device did not grant it').toBeNull();
    const res = await A.agent.callSkill('pinboard', 'removeMember', { groupId: GID2, memberWebid: B.pubKey });
    expect(res?.error ?? null).toBeNull();
    const r = await runKeyAudienceCheck({ circleId: GID2, producer: sealed, callSkill: (a, o, x) => A.agent.callSkill(a, o, x) });
    expect(r.revoked).toBe(0);
    expect(r.counts.unmapped).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('a grant that finds the key already in the file leaves no note (a presented address of someone else)', async () => {
    const GID3 = `${GID}-3`;
    await createCircle(A, { groupId: GID3, name: 'Audience three' });
    await joinExistingCircle(A, B, { groupId: GID3, handle: 'bee' });
    const sealed = await sealCircleViaProducer({ admin: A, members: [B], groupId: GID3 });
    const bKey = memberSealingPubKey(B, GID3);
    expect(sealed.keyHolders.of(bKey)).toBe(B.pubKey);
    // C presents B's address: the key is already a recipient, so nothing is written and the note stays B's
    await A.circleControlAgentRouter.addMember({ webId: C.pubKey, publicKey: bKey, role: 'member', groupId: GID3 });
    expect(sealed.keyHolders.of(bKey), 'the first note stands; the presenter gets none').toBe(B.pubKey);
  }, 120_000);
});
