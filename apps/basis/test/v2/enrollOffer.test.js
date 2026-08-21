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
 * With the ROSTER SEED (pod-less enroll S1) the old gap is closed and ASSERTED here: the sibling
 * serves its membership-redemption trail rows (device-set signed, id-preserved), the fresh
 * device's projection derives a real roster, and fanned membership statements — refused before
 * for want of binding rows — land and fold on top.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InternalTransport, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses,
  until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST, MEMBERSHIP_CATCHUP_SUBTYPES } from '../../src/v2/membershipRail.js';
import { makeGovernanceCatchUp } from '../../src/v2/governanceCatchUp.js';
import {
  ROSTER_SEED_VERSION, buildRosterSeedRequest, makeRosterSeedServer, makeRosterSeedReceiver,
} from '../../src/v2/rosterSeed.js';

import {
  ENROLL_SCHEME, encodeEnrollOffer, parseEnrollOffer, enrollOfferLink, enrollOfferFromLink,
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

/** The membership catch-up pair (serve + receive), wired per-test exactly as the shells wire it —
 *  the consume's membership pull is answered through this. */
function wireMembershipCatchUp(node) {
  const cu = makeGovernanceCatchUp({
    rail: node.agent.membershipRail,
    sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
    subtypes: MEMBERSHIP_CATCHUP_SUBTYPES,
  });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    const st = env?.payload?.subtype;
    if (st === cu.subtypes.request) { cu.onRequest(env?.from, env.payload); return undefined; }
    if (st === cu.subtypes.batch) { cu.onBatch(env?.from, env.payload); return undefined; }
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

  it('the LINK form wraps the identical payload — the person chooses how to share', () => {
    const uri = encodeEnrollOffer({ relays: ['ws://r'], circles: [{ id: 'c1', handle: 'anna', address: 'addr-1' }] });
    const link = enrollOfferLink('https://app.onderling.example/basis/', uri);
    expect(link.ok).toBe(true);
    expect(link.link.startsWith('https://app.onderling.example/basis/#enroll=')).toBe(true);

    // Recovered from the full href, from a bare hash, and from the raw code — one box takes all.
    for (const input of [link.link, `#enroll=${link.link.split('#enroll=')[1]}`, uri]) {
      const back = enrollOfferFromLink(input);
      expect(back.ok, input.slice(0, 40)).toBe(true);
      expect(back.uri).toBe(uri);
      expect(back.circles[0]).toEqual({ id: 'c1', handle: 'anna', address: 'addr-1' });
    }
    expect(enrollOfferLink('not-a-url', uri).reason).toBe('bad-app-url');
    expect(enrollOfferFromLink('https://app.example/#other=1').reason).toBe('not-an-enroll-link');
    expect(enrollOfferFromLink('').reason).toBe('not-an-enroll-link');
  });

  it('the stash accepts BOTH forms and normalises to the raw code', async () => {
    const storage = memStorage();
    const uri = encodeEnrollOffer({ circles: [{ id: 'c1', handle: 'anna', address: 'addr-1' }] });
    const { link } = enrollOfferLink('https://app.example/', uri);
    expect((await stashEnrollOffer(storage, link)).ok).toBe(true);
    expect((await pendingEnrollOffer(storage))?.circles?.[0]?.id).toBe('c1');
    await clearEnrollOffer(storage);
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
    for (const n of [B, A]) { wireMembershipReceiver(n); wireMembershipCatchUp(n); }
    await createCircle(B, { groupId: CIRCLE, name: 'Enroll offer' });
    const okJoin = await joinExistingCircle(B, A, { groupId: CIRCLE, handle: 'anna' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([B, A], CIRCLE);
    await Promise.all([B, A].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    // The join statement was fanned before A bound its per-circle address (the known
    // send-into-the-void window; production closes it on the next presence re-fan) — hand-carry
    // B's membership lane to A through the production ingest gate, so the SIBLING actually holds
    // the statements A2's pull will ask it for.
    for (const stmt of B.agent.membershipRail.storedStatements(CIRCLE)) {
      await A.agent.membershipRail.ingest(CIRCLE, stmt);
    }

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
    wireMembershipCatchUp(A2);

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
    // address — what reopenMemberCircles reads on every future boot.
    const props = await A2.agent.callSkill('agents', 'getProfileProperties', { id: 'default' });
    const membership = props?.properties?.circleMemberships?.value?.[CIRCLE]
      ?? props?.properties?.circleMemberships?.[CIRCLE] ?? null;
    expect(membership, JSON.stringify(props).slice(0, 300)).toBeTruthy();
    expect(membership.handle).toBe('anna');
    expect(membership.address).toBe(addrA2);

    // (c) THE ROSTER SEED (pod-less enroll S1): the sibling served its trail rows and the
    // TRAIL-LESS device now derives a REAL roster — both members, with the address facts the
    // binding verifiers read. This is the circularity broken.
    expect(report.steps, 'the seed was requested').toContain('seed-requested');
    expect(report.steps, 'the roster derived from the seed before the pulls').toContain('roster-derived');
    const rows = (await A2.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? [];
    const webids = rows.map((m) => m.webid ?? m.addr ?? m.ref);
    expect(webids, 'the person\'s own row derives').toContain(A.pubKey);
    expect(webids, 'the other member derives').toContain(B.pubKey);
    expect(rows.some((m) => m.circleAddress || (m.circleAddresses ?? []).length > 0),
      'the derived rows carry the address facts the binding gates read').toBe(true);

    // (d) …and fanned membership statements — refused before for want of binding rows — now LAND:
    // the membership pull (answered by the sibling's catch-up serve) folds on top of the seed.
    const landed = await until(async () => {
      const n = A2.agent.membershipRail ? A2.agent.membershipRail.storedStatements(CIRCLE).length : 0;
      return n > 0 ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(landed, 'no membership statement passed the ingest gate on the seeded device').toBe(true);
  }, 120_000);
});

describe('the roster seed — the device-set gate, unit-level', () => {
  const mkIdentity = () => AgentIdentity.generate(new VaultMemory());

  it('a stranger\'s request is refused without reply; a device-set request serves; tampering kills the parcel', async () => {
    const self = await mkIdentity();       // the profile identity (both devices' floor)
    const stranger = await mkIdentity();
    const rows = [{ id: 'r1', type: 'membership-redemption', text: 'joined', source: { groupId: 'c1', redeemedBy: 'w1' } }];
    const sent = [];
    const server = makeRosterSeedServer({
      callSkill: async (app, op) => (op === 'listOpen' ? { items: rows } : {}),
      signerPromise: Promise.resolve({ identity: self }),
      verifyDeviceSet: async ({ author }) => author === self.pubKey,   // the floor, stubbed
      selfPubKey: self.pubKey,
      sendToPeer: (to, payload) => { sent.push({ to, payload }); },
    });

    // The stranger: a WELL-FORMED, correctly SIGNED request — refused purely on the device set.
    const forged = await buildRosterSeedRequest({ signer: { identity: stranger }, circleId: 'c1', replyTo: 'addr-x' });
    await server('x', forged);
    expect(sent).toHaveLength(0);

    // The sibling: served, to the SIGNED replyTo, with the rows and a verifiable signature.
    const good = await buildRosterSeedRequest({ signer: { identity: self }, circleId: 'c1', replyTo: 'addr-new' });
    await server('x', good);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('addr-new');
    expect(sent[0].payload.body.rows).toHaveLength(1);

    // The receiver: an untampered parcel applies; a tampered one (rows swapped after signing) is
    // refused before any store write.
    const applied = [];
    const receiver = makeRosterSeedReceiver({
      callSkill: async (app, op, args) => { applied.push({ op, args }); return { ok: true }; },
      verifyDeviceSet: async ({ author }) => author === self.pubKey,
      selfPubKey: self.pubKey,
    });
    const tampered = { ...sent[0].payload, body: { ...sent[0].payload.body, rows: [{ id: 'evil' }] } };
    await receiver('x', tampered);
    expect(applied).toHaveLength(0);
    await receiver('x', sent[0].payload);
    expect(applied).toHaveLength(1);
    expect(applied[0].op).toBe('recordRosterSeed');
    expect(applied[0].args.rows).toHaveLength(1);
    expect(ROSTER_SEED_VERSION).toBe(sent[0].payload.body.v);
  });
});
