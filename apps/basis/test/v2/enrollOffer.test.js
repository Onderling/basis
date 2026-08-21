/**
 * The add-a-device offer (`onderling-enroll://`, the #54 tail) — the QR-carried transport
 * bootstrap, walked over the real harness. This is the production replacement for the enroll
 * walk's named hand-off ("A′ learns the circle id + B's address directly — the registry/QR-offer's
 * role"): the EXISTING device builds the offer; the fresh install stashes it, runs the phrase
 * ceremony (unchanged — the phrase IS the authority and never rides the offer), reboots enrolled,
 * and the consume half bootstraps every circle: the registry membership record (future boots
 * reopen), the announce to the sibling (the roster set grows — this device becomes reachable),
 * and the membership + governance catch-up pulls.
 *
 * Deliberately NOT asserted here: the fresh device's own derived roster projection — a pod-less
 * enrolled device holds no redemption trail and `projectCircleRoster` returns null without one
 * (the statement fold never runs). That is a standing gap of the enrolled-device story, filed on
 * the ledger, not a promise of this row.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses,
  until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import {
  ENROLL_SCHEME, encodeEnrollOffer, parseEnrollOffer,
  stashEnrollOffer, pendingEnrollOffer, clearEnrollOffer, consumeEnrollOffer,
} from '../../src/v2/enrollOffer.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'enroll-offer-circle';

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
};

function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

describe('the enroll offer — encode/parse', () => {
  it('round-trips, and every failure is a typed reason', () => {
    const uri = encodeEnrollOffer({
      relays: ['ws://relay.example'],
      circles: [{ id: 'c1', handle: 'anna', address: 'addr-1' }, { id: 'c2', address: 'addr-2' }],
    });
    expect(uri.startsWith(ENROLL_SCHEME)).toBe(true);
    const p = parseEnrollOffer(uri);
    expect(p.ok).toBe(true);
    expect(p.relays).toEqual(['ws://relay.example']);
    expect(p.circles).toEqual([
      { id: 'c1', handle: 'anna', address: 'addr-1' },
      { id: 'c2', handle: null, address: 'addr-2' },
    ]);

    expect(parseEnrollOffer('onderling-connect://abc').reason).toBe('not-an-enroll-uri');
    expect(parseEnrollOffer(ENROLL_SCHEME + '!!!').reason).toBe('unreadable');
    expect(parseEnrollOffer(ENROLL_SCHEME + btoa(JSON.stringify({ v: 9 })).replace(/=+$/, '')).reason).toBe('wrong-version');
    expect(parseEnrollOffer(ENROLL_SCHEME + btoa(JSON.stringify({ v: 1, c: [] })).replace(/=+$/, '')).reason).toBe('incomplete');
    expect(() => encodeEnrollOffer({ circles: [] })).toThrow();
  });

  it('the stash survives a parse-gate and clears', async () => {
    const storage = memStorage();
    const uri = encodeEnrollOffer({ circles: [{ id: 'c1', handle: 'anna', address: 'addr-1' }] });
    expect((await stashEnrollOffer(storage, 'garbage')).ok).toBe(false);
    expect(await pendingEnrollOffer(storage)).toBeNull();
    expect((await stashEnrollOffer(storage, uri)).ok).toBe(true);
    expect((await pendingEnrollOffer(storage))?.circles?.[0]?.id).toBe('c1');
    await clearEnrollOffer(storage);
    expect(await pendingEnrollOffer(storage)).toBeNull();
  });
});

describe('the enroll offer — the transport-bootstrap corridor over the real harness', () => {
  let B; let A; let A2; let bus;
  afterAll(async () => { await teardown(B, A, A2); });

  it('offer → ceremony → consume: the sibling learns the new device, the registry record lands, the lanes pull', async () => {
    // B creates the circle; A JOINS (write-on-join records A's registry membership {handle, address} —
    // the fact that puts a HANDLE on A's offer). A is the person who will add a second device.
    [B, A] = await Promise.all([
      bootRealAgentNode('B', { taskLane: true }),
      bootRealAgentNode('A', {
        taskLane: true,
        agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() },
      }),
    ]);
    bus = await connectNodesOverBus([B, A]);
    for (const n of [B, A]) wireMembershipReceiver(n);
    await createCircle(B, { groupId: CIRCLE, name: 'Enroll offer' });
    const okJoin = await joinExistingCircle(B, A, { groupId: CIRCLE, handle: 'anna' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([B, A], CIRCLE);
    await Promise.all([B, A].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));

    // The EXISTING device builds the offer: this circle, A's handle, A's per-circle address.
    const built = await A.agent.callSkill('household', 'buildEnrollOffer', { relayUrl: 'ws://relay.example' });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    const offer = parseEnrollOffer(built.uri);
    expect(offer.ok).toBe(true);
    const row = offer.circles.find((c) => c.id === CIRCLE);
    expect(row, 'the offer names the circle').toBeTruthy();
    expect(row.handle, 'the joiner\'s handle rides the offer (from the registry record)').toBe('anna');
    expect(row.address).toBe(A.agent.circleAddressFor(CIRCLE));

    // The NEW device: stash the offer (plain storage — it survives the ceremony reload), then the
    // phrase ceremony, unchanged: typed on the new device, never carried by the offer.
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, built.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'tablet' });
    expect(enrolled.ok).toBe(true);
    await teardown(pre);

    // The enrolled reboot, on the same bus.
    A2 = await bootRealAgentNode('A2', {
      agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) },
    });
    expect(A2.pubKey).toBe(A.pubKey);
    const tx = new InternalTransport(bus, A2.pubKey);
    await A2.agent.sa.addSecureTransport('relay', tx);
    A2._busTransport = tx;
    await bindCircleAddresses([A2], CIRCLE);
    wireMembershipReceiver(A2);

    // THE CONSUME — what the shells run once per boot.
    const consumed = await consumeEnrollOffer({
      agent: A2.agent,
      callSkill: (app, op, args) => A2.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => A2.agent.sendPeerMessage(to, payload, opts),
      storage,
    });
    expect(consumed.consumed).toBe(true);
    const report = consumed.circles.find((c) => c.circleId === CIRCLE);
    expect(report?.ok, JSON.stringify(consumed)).toBe(true);
    expect(report.steps, 'the registry record landed (future boots reopen through it)').toContain('registry');
    expect(consumed.cleared, 'a fully bootstrapped offer clears its stash').toBe(true);
    expect(await pendingEnrollOffer(storage)).toBeNull();

    // (a) The SIBLING learned the new device: A's own roster row grows into the proven SET —
    // exactly what the enroll walk used to hand-carry.
    const addrA2 = A2.agent.circleAddressFor(CIRCLE);
    const grew = await until(async () => {
      const r = await A.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
      const mine = (r?.members ?? []).find((m) => m.webid === A.pubKey);
      return mine?.circleAddresses?.includes(addrA2) ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(grew, 'the announce never grew the sibling\'s roster set').toBe(true);

    // (b) The registry membership record on the NEW device carries the handle + its OWN derived
    // address — what reopenMemberCircles reads on every future boot. (The statement-verification
    // side of a pod-less enrolled device — no roster without a trail, no trail without verified
    // statements — is the standing gap on the ledger, deliberately not asserted here.)
    const props = await A2.agent.callSkill('agents', 'getProfileProperties', { id: 'default' });
    const membership = props?.properties?.circleMemberships?.value?.[CIRCLE]
      ?? props?.properties?.circleMemberships?.[CIRCLE] ?? null;
    expect(membership, JSON.stringify(props).slice(0, 300)).toBeTruthy();
    expect(membership.handle).toBe('anna');
    expect(membership.address).toBe(addrA2);
  }, 120_000);
});
