/**
 * THE KEY LANE FROM THE POINT, in a SEALED circle. The person's box removes a member while the phone is the point: the
 * box hands the act to the phone; the phone runs the key rotation from its own producer and signs the one key event;
 * the removed member cannot open what is sealed next, and the box (a full device of the person) can.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses,
  sealCircleViaProducer, postSealed, readSealed, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';

const CIRCLE = 'point-sealed-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };

describe('the key lane from the point, sealed', () => {
  let relay; let A; let B; let A2;
  afterAll(async () => { await teardown(A, B, A2); try { await relay?.close?.(); } catch { /* */ } });

  it('the box removes a member: one rotation by the point, the removed member is cut off, the box still reads', async () => {
    relay = await startJourneyRelay();
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() } }),
      bootRealAgentNode('B'),
    ]);
    await connectNodesOverRelay([A, B], { relayUrl: relay.url });
    await createCircle(A, { groupId: CIRCLE, name: 'Point sealed' });
    const joined = await joinExistingCircle(A, B, { groupId: CIRCLE, handle: 'bea' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await bindCircleAddresses([A, B], CIRCLE);
    await Promise.all([A, B].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    await sealCircleViaProducer({ admin: A, members: [B], groupId: CIRCLE });
    expect(await until(() => (B.keyEventStore.list(CIRCLE).length > 0 ? true : null), { timeout: 10000, step: 50 })).toBe(true);

    // the box, enrolled through the real offer: the phone (the existing device) claims the point
    const built = await A.agent.callSkill('household', 'buildEnrollOffer', {});
    expect(built.ok, JSON.stringify(built)).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, built.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', { agentOpts: vaults });
    await connectNodesOverRelay([A2], { relayUrl: relay.url });
    await bindCircleAddresses([A2], CIRCLE);
    const consumed = await consumeEnrollOffer({
      agent: A2.agent, callSkill: (a, o, x) => A2.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => A2.agent.sendPeerMessage(to, p, o), storage,
    });
    expect(consumed.circles?.find((c) => c.circleId === CIRCLE)?.ok, JSON.stringify(consumed)).toBe(true);
    const phoneId = A.agent.persona('default').enrolledDevice?.deviceId;
    expect(await until(() => (A.agent.spinePointClaim()?.deviceId === phoneId ? true : null), { timeout: 15000, step: 200 })).toBe(true);
    await A2.agent.spinePoint?.requestFromSiblings?.();
    expect(await until(() => (A2.agent.spinePointClaim()?.deviceId === phoneId ? true : null), { timeout: 15000, step: 200 }), 'the box does not know the point').toBe(true);

    // the box removes Bea — what it signs on the key lane itself is counted
    let boxKeyAppends = 0;
    const keyRail = A2.agent.keyRail;
    const origAppend = keyRail.append.bind(keyRail);
    keyRail.append = async (...x) => { boxKeyAppends += 1; return origAppend(...x); };
    const versionsOnA = () => A.keyEventStore.list(CIRCLE).map((e) => e.version);
    const before = Math.max(...versionsOnA());
    const r = await A2.agent.callSkill('pinboard', 'removeMember', { groupId: CIRCLE, memberWebid: B.pubKey });
    expect(r?.error ?? null, JSON.stringify(r)).toBeNull();
    expect(await until(() => (Math.max(...versionsOnA()) > before ? true : null), { timeout: 20000, step: 200 }),
      'the point never rotated the key').toBe(true);
    keyRail.append = origAppend;
    expect(boxKeyAppends, 'the box wrote on the key lane itself').toBe(0);

    // what is sealed next: Bea cannot open it; the box can (a full device of the person)
    const env = await postSealed({ admin: A, members: [A2], groupId: CIRCLE, text: 'na het verwijderen' });
    expect(() => readSealed(B, env, CIRCLE), 'the removed member opened what came after').toThrow();
    const opened = await until(() => { try { return readSealed(A2, env, CIRCLE) === 'na het verwijderen' ? true : null; } catch { return null; } }, { timeout: 15000, step: 200 });
    expect(opened, 'the box cannot read what its own person sealed').toBe(true);
  }, 240_000);
});
