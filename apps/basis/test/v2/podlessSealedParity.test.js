/**
 * POD-LESS SEALED PARITY (PLAN-podless-enroll-completeness, the sealed walk) — the v1 gate: a
 * device enrolled by phrase + offer, with NO pod anywhere, OPENS content that was sealed before
 * it existed.
 *
 * The corridor: B creates a circle and A joins (the real redeem trail) · B seals the circle
 * through the REAL producer + control agent (group key wrapped to each member's sealing key; the
 * key-events fan over the bus and land in each member's key-event store) · B posts a sealed
 * envelope — at this point the tablet does not exist · A adds a second device through the enroll
 * offer + the phrase ceremony · the enrolled boot consumes: the roster seed from the sibling, and
 * — riding the same device-set-verified request — the sibling REPLAYS its group-key events
 * through the ordinary `group-key-event` door.
 *
 * The claim, as a person reads it: the new device folds the replayed chain with the person's own
 * sealing key (phrase-derived — every device of the person holds it) and OPENS the envelope. No
 * key was ever unwrapped in transit: the replayed events are the same sealed envelopes the
 * rotation fan always carries.
 *
 * The deny gate rides along: a STRANGER's seed request (a different profile's device, correctly
 * signed) is refused before the serve — no parcel, no key-events, silence.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses,
  sealCircleViaProducer, postSealed, readSealed, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../../src/v2/enrollOffer.js';

const CIRCLE = 'podless-sealed-circle';

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
};

describe('pod-less sealed parity — the enrolled device opens what was sealed before it existed', () => {
  let B; let A; let A2; let S; let bus;
  afterAll(async () => { await teardown(B, A, A2, S); });

  it('the key chain replays to the verified sibling device, and the envelope opens there', async () => {
    [B, A, S] = await Promise.all([
      bootRealAgentNode('B'),
      bootRealAgentNode('A', {
        agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() },
      }),
      bootRealAgentNode('S'),   // the stranger — a different person's device, honestly signed
    ]);
    bus = await connectNodesOverBus([B, A, S]);
    await createCircle(B, { groupId: CIRCLE, name: 'Sealed parity' });
    const okJoin = await joinExistingCircle(B, A, { groupId: CIRCLE, handle: 'anna' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([B, A], CIRCLE);
    await Promise.all([B, A].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));

    // B seals the circle through the REAL producer: the control agent wraps the v1 group key to
    // B's and A's sealing keys; the sink fans the key-events over the bus; A records its copies.
    await sealCircleViaProducer({ admin: B, members: [A], groupId: CIRCLE });
    const aHasChain = await until(() => (A.keyEventStore.list(CIRCLE).length > 0 ? true : null), { timeout: 8000, step: 50 });
    expect(aHasChain, 'the sibling never received the key-events — the replay source would be empty').toBe(true);

    // B posts a sealed envelope. The tablet does not exist yet — this is the content it must
    // later open. Precondition: A (an ordinary member) opens it today.
    const env = await postSealed({ admin: B, members: [A], groupId: CIRCLE, text: 'sealed before the tablet existed' });
    expect(await readSealed(A, env, CIRCLE), 'the ordinary member must open it — else the walk proves nothing').toBe('sealed before the tablet existed');

    // A adds a second device: offer → ceremony → enrolled reboot → consume (the parity corridor).
    const built = await A.agent.callSkill('household', 'buildEnrollOffer', {});
    expect(built.ok, JSON.stringify(built)).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, built.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'tablet' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', { agentOpts: vaults });
    const tx = new InternalTransport(bus, A2.pubKey);
    await A2.agent.sa.addSecureTransport('relay', tx);
    A2._busTransport = tx;
    await bindCircleAddresses([A2], CIRCLE);

    const consumed = await consumeEnrollOffer({
      agent: A2.agent,
      callSkill: (app, op, args) => A2.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => A2.agent.sendPeerMessage(to, payload, opts),
      storage,
    });
    const report = consumed.circles?.find((c) => c.circleId === CIRCLE);
    expect(report?.ok, JSON.stringify(consumed)).toBe(true);
    expect(report.steps).toContain('seed-requested');

    // ── THE GATE: the chain arrived, and the envelope OPENS on the device that did not exist
    // when it was sealed. The opener is the person's own phrase-derived sealing key; the chain
    // is exactly what the sibling held — same person, same entitlement, no unwrap in transit.
    const chainArrived = await until(() => (A2.keyEventStore.list(CIRCLE).length > 0 ? true : null), { timeout: 15000, step: 100 });
    expect(chainArrived, 'the key chain never reached the enrolled device').toBe(true);
    expect(await readSealed(A2, env, CIRCLE), 'the enrolled device opens pre-existing sealed content').toBe('sealed before the tablet existed');

    // ── THE DENY GATE: a stranger's honestly-signed request is refused BEFORE the serve — no
    // parcel, no key-events. (S's key is not in A's device set; the delegation chain fails.)
    const strangerReq = await S.agent.rosterSeed.buildRequest(CIRCLE, S.pubKey);
    await A.agent.rosterSeed.onRequest('hand', strangerReq);
    await new Promise((r) => setTimeout(r, 1200));
    expect(S.keyEventStore.list(CIRCLE), 'a stranger must receive NO key-events').toEqual([]);
    expect(
      S.received.some((m) => m?.payload?.subtype === 'roster-seed-batch'),
      'a stranger must receive NO seed parcel either',
    ).toBe(false);
  }, 180_000);
});
