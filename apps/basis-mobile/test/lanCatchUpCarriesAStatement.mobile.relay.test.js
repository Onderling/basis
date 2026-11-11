/**
 * HOPPING ON THE PHONE — the member who reaches both sides, and carries, is a PHONE (the function matrix's
 * hopping × mobile cell; the node story is apps/basis/test/lanCatchUpCarriesAStatement.relay.test.js).
 *
 * Three members of one circle. Cas is on the relay only; Dana is on the "LAN" only; Anna — the phone, booted from its
 * own bundle with its own inbound wiring (test/support/mobileNode.js) — is on both. Cas posts. His fan cannot reach
 * Dana. Dana catches up (the pull every shell runs at boot and on reconnect) and can reach only Anna; Anna's PHONE
 * serves the circle's conversation through the chat lane its wiring composes. Dana then holds Cas's statement,
 * verified against her own roster.
 *
 * The LAN is a second relay only Anna and Dana are on; Anna's phone reaches it the way a phone reaches a circle's other
 * connection point (`reconnectPeer({ relayUrl })`, the join dial, which adds a relay beside the one it is on). The live
 * mDNS hop between two phones stays a step of the two-phone walk.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { EventLog } from '../../basis/src/eventLog.js';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import {
  bootRealAgentNode, createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, until, teardown,
} from '../../basis/test/support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../basis/src/v2/householdRosterPairing.js';
import { registerCircleAddressesOnRelays } from '../../basis/src/v2/circleAddressRegistration.js';
import { rosterBindingVerifier } from '../../basis/src/v2/membershipRail.js';
import { bootMobileNode } from './support/mobileNode.js';

const CIRCLE = 'lan-catch-up-phone';
const TEXT = 'de container staat bij nummer 12';
const chatIn = (node) => node.chatRail.storedStatements(CIRCLE).map((s) => s?.body?.payload?.text).filter(Boolean);

describe('the phone that reaches both sides serves the catch-up to a member only the LAN reaches', () => {
  let relay; let lan; let anna; let cas; let dana;
  afterAll(async () => {
    await teardown(cas, dana);
    await anna?.dispose();
    for (const r of [relay, lan]) { try { await r?.close?.(); } catch { /* */ } }
  });

  it("Cas posts on the relay; Dana, on the LAN only, holds his statement after her catch-up with Anna's phone", async () => {
    relay = await startJourneyRelay();
    lan = await startJourneyRelay();
    const danaRef = {};
    const lane = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });

    // Anna: the phone, on the relay its settings name, then on the LAN beside it (the join dial)
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    const toLan = await anna.bundle.reconnectPeer({ relayUrl: lan.url });
    expect(toLan.ok, `the phone could not add the LAN relay: ${JSON.stringify(toLan)}`).toBe(true);
    expect((anna.agent.relays?.list?.() ?? []).map((r) => r.url).sort(), 'the phone is on both rungs').toEqual([relay.url, lan.url].sort());

    cas = await bootRealAgentNode('cas', { agentOpts: lane() });
    dana = await bootRealAgentNode('dana', {
      agentOpts: lane(),
      verifyChatBinding: rosterBindingVerifier((app, op, args) => danaRef.node.agent.callSkill(app, op, args)),
    });
    danaRef.node = dana;
    await cas.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (e) => cas._routerRef.fn?.(e), awaitRelayReady: true });
    await dana.agent.connectPeerTransport({ relayUrl: lan.url, onPeerMessage: (e) => dana._routerRef.fn?.(e), awaitRelayReady: true });

    // the phone founds the circle through the same create path its wizard submits; Cas and Dana join by its invite
    await createCircle(anna, { groupId: CIRCLE, name: 'Straat' });
    const casJoin = await joinExistingCircle(anna, cas, { groupId: CIRCLE, handle: 'cas' });
    expect(casJoin.joined?.ok, JSON.stringify(casJoin.joined)).toBe(true);
    const danaJoin = await joinExistingCircle(anna, dana, { groupId: CIRCLE, handle: 'dana' });
    expect(danaJoin.joined?.ok, JSON.stringify(danaJoin.joined)).toBe(true);
    // the phone registers its presence the way it does after a join (its bundle's own registration); the nodes as
    // the relay tests do
    await anna.bundle.registerCirclePresence?.([CIRCLE]);
    await bindCircleAddresses([cas, dana], CIRCLE);
    // the phone's circle rides both points: its per-circle address on the LAN socket too (as the node story does)
    const points = () => [CIRCLE];
    points.pointsFor = () => [relay.url, lan.url];
    await registerCircleAddressesOnRelays({
      relays: anna.agent.relays.list(), circleIds: [CIRCLE], circlesForPoint: points, defaultRelayUrl: relay.url,
      circleAddressFor: (cid) => anna.agent.circleAddressFor(cid), circleAddressSignerFor: (cid) => anna.agent.circleAddressSignerFor(cid),
      alsoAddresses: anna.agent.ownAddressBindings?.() ?? [],
    });
    await Promise.all([anna, cas, dana].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));

    const casInDanasRoster = await until(async () => {
      const r = await dana.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE });
      return (r?.members ?? []).some((m) => m.webid === cas.pubKey) ? true : null;
    }, { timeout: 20_000, step: 250 });
    expect(casInDanasRoster, "Cas is not in Dana's roster — the catch-up question cannot be asked yet").toBe(true);

    const sent = await sendCircleChat(cas, { groupId: CIRCLE, msgId: 'cas-1', text: TEXT });
    expect(sent?.error ?? null, JSON.stringify(sent)).toBe(null);
    // the phone holds it: in its device log, where its chat lane keeps the circle's conversation
    expect(await until(async () => (anna.eventLog.query({ excludeMuted: true }).some((e) => e?.payload?.text === TEXT) ? true : null), { timeout: 20_000, step: 200 }),
      'the phone, on the same relay as Cas, never received his statement').toBe(true);
    expect(chatIn(dana), 'Dana received it live — the relay reached her, so this is not the LAN-only case').not.toContain(TEXT);

    const asked = await dana.chatCatchUp.requestCircle(CIRCLE, { callSkill: (app, op, args) => dana.agent.callSkill(app, op, args) });
    expect(asked.requested, 'Dana asked nobody').toBeGreaterThan(0);
    const got = await until(async () => (chatIn(dana).includes(TEXT) ? true : null), { timeout: 30_000, step: 250 });
    expect(got, "Dana does not hold Cas's statement after her catch-up with Anna's phone").toBe(true);
  }, 180_000);
});
