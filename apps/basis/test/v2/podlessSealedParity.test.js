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
 * The claim, as a person reads it: the new device announces its OWN per-circle address, the admin's
 * device — the one holding the circle's producer — wraps the group key to that address's sealing
 * key (one key family: a device's sealing key is its address key's image, so it is per device and
 * retired with the address), the re-issued key-event fans to the new device, and the envelope
 * OPENS there. No key was ever unwrapped in transit; a device never holds a sibling's key.
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
import { sealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import { makeKeyPeerHandler, KEY_STATEMENT_BROADCAST, projectKeyEventsIntoStore } from '../../src/v2/keyRail.js';

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

    // The replayed chain arrives — sealed to the SIBLING's key, which the tablet does not hold (one key
    // family: per device). It cannot open yet; that is the point, not a gap.
    const chainArrived = await until(() => (A2.keyEventStore.list(CIRCLE).length > 0 ? true : null), { timeout: 15000, step: 100 });
    expect(chainArrived, 'the key chain never reached the enrolled device').toBe(true);
    expect(() => readSealed(A2, env, CIRCLE), "sealed to the sibling's key, not the tablet's").toThrow();

    // ── THE GATE: the tablet announces its address; the admin's device (holding the producer) wraps the
    // group key to that address's sealing key — production does this in the announce handler
    // (`grantSealedAudience`); the harness performs the shell's act explicitly — the re-issued key-event
    // fans to the tablet, and the envelope OPENS on the device that did not exist when it was sealed.
    // The admin's device wraps the group key to the tablet's own address key — production does this in the
    // announce handler (`grantSealedAudience`) and fans the re-issued key-event to the tablet's per-circle
    // ADDRESS; the harness fans by webid, which two devices of one person share, so it performs the shell's
    // act explicitly: grant, then land the admin's key statements at the tablet's rail.
    await B.circleControlAgentRouter.grantRecipient({ groupId: CIRCLE, publicKey: sealingPublicKeyFromNetworkKey(A2.agent.circleAddressFor(CIRCLE)) });
    const onKeyA2 = makeKeyPeerHandler({ rail: A2.agent.keyRail });
    for (const stmt of B.agent.keyRail.storedStatements(CIRCLE)) {
      await onKeyA2('B', { subtype: KEY_STATEMENT_BROADCAST, circleId: CIRCLE, event: stmt });
    }
    await projectKeyEventsIntoStore({ rail: A2.agent.keyRail, store: A2.keyEventStore, circleId: CIRCLE });
    const opened = await until(() => {
      try { return readSealed(A2, env, CIRCLE) === 'sealed before the tablet existed' ? true : null; } catch { return null; }
    }, { timeout: 15000, step: 100 });
    expect(opened, 'the enrolled device opens pre-existing sealed content once granted').toBe(true);

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
