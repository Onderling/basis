/**
 * POD-LESS SEALED PARITY, OVER THE RELAY — the marquee variant of the sealed walk: the same
 * corridor as `podlessSealedParity.test.js`, but every hop crosses the REAL transport seam — a
 * live WebSocket relay, per-circle alias binding with the real signed challenge, hold-forward
 * delivery. On a relay the shared profile key is one address, one socket, so the sibling paths
 * (seed request, parcel, announce-back, the key LANE's catch-up pull) travel exactly the
 * production shape.
 *
 * The claim is the v1 gate again, on the wire people will actually use: a device enrolled by
 * phrase + offer, no pod anywhere, OPENS content sealed before it existed.
 */
import { sealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import { makeKeyPeerHandler, KEY_STATEMENT_BROADCAST, projectKeyEventsIntoStore } from '../../src/v2/keyRail.js';
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from '../support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses,
  sealCircleViaProducer, postSealed, readSealed, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../../src/v2/enrollOffer.js';

const CIRCLE = 'podless-sealed-relay-circle';

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
};

describe('pod-less sealed parity over the RELAY — the marquee walk', () => {
  let relay; let B; let A; let A2;
  afterAll(async () => {
    await teardown(B, A, A2);
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('the enrolled device opens pre-existing sealed content, every hop over the live relay', async () => {
    relay = await startJourneyRelay();
    const relayUrl = relay.url;
    [B, A] = await Promise.all([
      bootRealAgentNode('B'),
      bootRealAgentNode('A', {
        agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() },
      }),
    ]);
    await connectNodesOverRelay([B, A], { relayUrl });
    await createCircle(B, { groupId: CIRCLE, name: 'Sealed relay parity' });
    const okJoin = await joinExistingCircle(B, A, { groupId: CIRCLE, handle: 'anna' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([B, A], CIRCLE);
    await Promise.all([B, A].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));

    // Seal through the REAL producer; the key-events cross the relay to A.
    await sealCircleViaProducer({ admin: B, members: [A], groupId: CIRCLE });
    const aHasChain = await until(() => (A.keyEventStore.list(CIRCLE).length > 0 ? true : null), { timeout: 10000, step: 50 });
    expect(aHasChain, 'the sibling never received the key-events over the relay').toBe(true);
    const env = await postSealed({ admin: B, members: [A], groupId: CIRCLE, text: 'sealed before the tablet existed' });
    expect(await readSealed(A, env, CIRCLE)).toBe('sealed before the tablet existed');

    // Enroll the second device; it reaches the world ONLY through the relay.
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
    await connectNodesOverRelay([A2], { relayUrl });
    await bindCircleAddresses([A2], CIRCLE);   // the SIGNED alias challenge — real on a relay

    const consumed = await consumeEnrollOffer({
      agent: A2.agent,
      callSkill: (app, op, args) => A2.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => A2.agent.sendPeerMessage(to, payload, opts),
      storage,
    });
    const report = consumed.circles?.find((c) => c.circleId === CIRCLE);
    expect(report?.ok, JSON.stringify(consumed)).toBe(true);
    expect(report.steps).toContain('seed-requested');

    // The replayed chain arrives over the relay — sealed to the sibling's key, which the tablet does not hold
    // (one key family: per device). The gate: the admin's device wraps the group key to the tablet's own
    // address key on its announcement (production: the announce handler's `grantSealedAudience`; the harness
    // performs the shell's act), the re-issued key-event crosses the relay, and the envelope opens there.
    const chainArrived = await until(() => (A2.keyEventStore.list(CIRCLE).length > 0 ? true : null), { timeout: 20000, step: 100 });
    expect(chainArrived, 'the key chain never reached the enrolled device over the relay').toBe(true);
    expect(() => readSealed(A2, env, CIRCLE), "sealed to the sibling's key, not the tablet's").toThrow();
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
    }, { timeout: 20000, step: 100 });
    expect(opened, 'the enrolled device opens pre-existing sealed content over the relay once granted').toBe(true);
  }, 180_000);
});
