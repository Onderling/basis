/**
 * THE KEY'S AUDIENCE FOLLOWS THE MEMBERSHIP, on real agents: a holder the membership lane places OUT whose removal never
 * reached the key file is taken out by the key owner's audience round; everyone else keeps the key.
 *   - a removed member whose rotation was lost (the removal went through while the producer was not there) → revoked;
 *   - a member another instance admitted and this one never knew (removeMember there returned removed:false, nothing
 *     rotated) → revoked by the round the router runs after that event;
 *   - a member who is in keeps the key throughout.
 * A removed member's DEVICE (a second verified address on their row) maps to them the same way: pinboard's
 * keyHoldersFromRedemptions test pins that mapping.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { unwrapGroupKey, generateKeypair } from '@onderling/pod-client';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, sealCircleViaProducer, until, teardown,
} from './support/pairRealAgents.js';
import { runKeyAudienceCheck } from '../src/v2/keyAudienceCheck.js';
import { memberSealingPubKey } from './support/pairRealAgents.js';

const memberKey = (node, gid) => memberSealingPubKey(node, gid);

const GID = 'audience-follows';
const opensWith = (res, priv) => { try { unwrapGroupKey(res, priv); return true; } catch { return false; } };
const opens = (res, node) => opensWith(res, node.agent.circleSealingKeyPairFor(GID).privateKey);

describe('the key audience follows the membership', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  it('a lost removal is taken out by the round; a member keeps the key; a key nobody can name stays and is counted', async () => {
    [A, B, C] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C')]);
    await connectNodesOverBus([A, B, C]);
    await createCircle(A, { groupId: GID, name: 'Audience' });
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' });
    await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' });
    const producer = await sealCircleViaProducer({ admin: A, members: [B, C], groupId: GID });
    const call = (app, op, args) => A.agent.callSkill(app, op, args);
    const file = () => producer.controlAgent.keyStore.read();

    // the removal is LOST: C is out on the lane, the key file never rotated (the producer was not there)
    A.circlePods.delete(GID);
    const res = await call('pinboard', 'removeMember', { groupId: GID, memberWebid: C.pubKey });
    expect(res?.error, `removeMember refused: ${res?.error}`).toBeFalsy();
    A.circlePods.set(GID, producer);
    expect(opens(await file(), C), 'the lost removal left C in the key file').toBe(true);

    // the producer's start round (the key owner's device): C is revoked, B keeps the key
    const round = await runKeyAudienceCheck({ circleId: GID, producer, callSkill: call });
    expect(round.revoked, JSON.stringify(round)).toBe(1);
    expect(opens(await file(), C), 'C is out of the key').toBe(false);
    expect(opens(await file(), B), 'B keeps the key').toBe(true);
    expect(opens(await file(), A), 'the founder keeps the key').toBe(true);

    // a key nobody can name stays, and is counted
    const stranger = generateKeypair();
    await producer.controlAgent.grantRecipient({ publicKey: stranger.publicKey });
    const r3 = await runKeyAudienceCheck({ circleId: GID, producer, callSkill: call });
    expect(r3.revoked).toBe(0);
    expect(r3.counts.unmapped).toBe(1);
    expect((await file()).recipients).toContain(stranger.publicKey);
  }, 120_000);

  it('a member this instance never knew (another instance admitted them): removeMember here returns removed:false, the router\'s round takes them out', async () => {
    const GID2 = `${GID}-2`;
    await createCircle(A, { groupId: GID2, name: 'Audience two' });
    const sealed = await sealCircleViaProducer({ admin: A, members: [], groupId: GID2 });
    // B joins while this instance's producer is away, so its control agent never learns B …
    A.circlePods.delete(GID2);
    await joinExistingCircle(A, B, { groupId: GID2, handle: 'bee' });
    A.circlePods.set(GID2, sealed);
    // … and another instance's grant put B's key in the file
    await sealed.controlAgent.grantRecipient({ publicKey: memberKey(B, GID2) });
    const opensB = async () => opensWith(await sealed.controlAgent.keyStore.read(), B.agent.circleSealingKeyPairFor(GID2).privateKey);
    expect(await opensB(), 'B holds the key before the removal').toBe(true);
    const res = await A.agent.callSkill('pinboard', 'removeMember', { groupId: GID2, memberWebid: B.pubKey });
    expect(res?.error ?? null).toBeNull();
    expect(await until(async () => (!(await opensB()) ? true : null), { timeout: 10_000, step: 100 }), 'B is out after the router\'s round').toBe(true);
  }, 120_000);
});
