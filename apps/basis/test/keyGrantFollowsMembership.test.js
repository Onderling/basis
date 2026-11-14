/**
 * A KEY GRANT FOLLOWS MEMBERSHIP, ASKED AGAIN ON EVERY COMPUTE. Each join's change to a sealed circle's group key asks
 * the membership lane (pinboard memberStatus) whether the member is still in AFTER the admission the grant follows:
 *   - a grant for someone REMOVED since (a stale event, the roster seed, a recompute after a lost race) is dropped:
 *     the removal stands, the key does not come back;
 *   - a removed member who is invited again and rejoins gets the key (the new join is after the eviction);
 *   - the founder (admitted by the circle's creation, no join) is in;
 *   - a status read that cannot answer stops the change loudly: nothing written.
 * Three real agents on one bus, the real join, the real removeMember op, the circle sealed through the real producer.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { unwrapGroupKey, generateKeypair } from '@onderling/pod-client';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, sealCircleViaProducer,
  memberSealingPubKey, until, teardown,
} from './support/pairRealAgents.js';
import { createCircleControlAgentRouter } from '../src/v2/circlePodProducer.js';

const GID = 'key-follows-membership';
const opens = (res, node) => { try { unwrapGroupKey(res, node.agent.circleSealingKeyPairFor(GID).privateKey); return true; } catch { return false; } };

describe('a key grant follows membership', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  it('a stale grant after a removal is dropped; the removed member who rejoins gets the key', async () => {
    [A, B, C] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C')]);
    await connectNodesOverBus([A, B, C]);
    await createCircle(A, { groupId: GID, name: 'Key follows' });
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' });
    await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' });
    const producer = await sealCircleViaProducer({ admin: A, members: [B, C], groupId: GID });
    const keyFile = () => producer.controlAgent.keyStore.read();
    expect(opens(await keyFile(), C), 'C holds the key after the seal').toBe(true);

    // A removes C through the real op: the key rotates past C
    const res = await A.agent.callSkill('pinboard', 'removeMember', { groupId: GID, memberWebid: C.pubKey });
    expect(res?.error, `removeMember refused: ${res?.error}`).toBeFalsy();
    expect(opens(await keyFile(), C), 'C is out of the key').toBe(false);
    expect((await A.agent.callSkill('pinboard', 'memberStatus', { groupId: GID, webid: C.pubKey }))?.status).toBe('out');

    // a stale grant for C (the roster seed, an old event, a recompute): no admission named → C's last join → out
    await A.circleControlAgentRouter.addMember({ webId: C.pubKey, publicKey: memberSealingPubKey(C, GID), role: 'member', groupId: GID });
    expect(opens(await keyFile(), C), 'the stale grant did not put C back').toBe(false);

    // a DEVICE of C announced after the removal: its owner is out, so it does not join the key's audience
    const device = generateKeypair();
    await A.circleControlAgentRouter.grantRecipient({ publicKey: device.publicKey, groupId: GID, ownerWebId: C.pubKey });
    expect((await keyFile()).recipients ?? [], 'the removed owner\'s device was not enrolled').not.toContain(device.publicKey);
    // …while a device of B, who is in, is
    const bDevice = generateKeypair();
    await A.circleControlAgentRouter.grantRecipient({ publicKey: bDevice.publicKey, groupId: GID, ownerWebId: B.pubKey });
    expect((await keyFile()).recipients ?? [], 'a member\'s device is enrolled').toContain(bDevice.publicKey);

    // the founder, admitted by the circle's creation, is in
    expect((await A.agent.callSkill('pinboard', 'memberStatus', { groupId: GID, webid: A.pubKey }))?.status).toBe('in');

    // C is invited again and rejoins: the new join comes after the eviction, so its grant stands
    // (a removed member needs a NEW invite: the admin rotates the code, as the person would)
    const rotated = await A.agent.callSkill('pinboard', 'rotateMyGroupCode', { groupId: GID });
    expect(rotated?.error, `rotateMyGroupCode refused: ${rotated?.error}`).toBeFalsy();
    const rejoined = await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' });
    expect(rejoined.joined?.ok, JSON.stringify(rejoined.joined)).toBe(true);
    expect(await until(async () => (opens(await keyFile(), C) ? true : null), { timeout: 10_000, step: 100 }), 'the rejoined C holds the key').toBe(true);
    expect(opens(await keyFile(), B), 'B kept the key throughout').toBe(true);
  }, 90_000);

  it('a status read that cannot answer stops the change: nothing written', async () => {
    const writes = [];
    const controlAgent = { addMember: async ({ isMember }) => { if ((await isMember()) !== true) throw Object.assign(new Error('cannot say'), { code: 'MEMBER_UNKNOWN' }); writes.push(1); } };
    const notes = [];
    const router = createCircleControlAgentRouter(() => ({ controlAgent }), {
      memberStatusOf: async () => null,   // the read failed or could not place the admission
      refusals: { note: (r) => notes.push(r) },
    });
    const warn = console.warn; console.warn = () => {};
    try { await router.addMember({ webId: 'ref:x', publicKey: 'pk', groupId: 'g' }); } finally { console.warn = warn; }
    expect(writes).toEqual([]);
    expect(notes.map((n) => n.reason)).toEqual(['member-unknown']);
  });
});
