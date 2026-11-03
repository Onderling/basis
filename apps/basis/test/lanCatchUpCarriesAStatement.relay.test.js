/**
 * THE MEMBER ONLY THE LAN REACHES, BY CATCH-UP — does today's catch-up already carry a statement to a member the
 * sender cannot reach?
 *
 * Three members of one circle. Cas is on the relay only; Dana is on the "LAN" only; Anna is on both. Cas posts. His
 * fan cannot reach Dana. When Dana catches up — the pull every shell runs at boot and on reconnect, at each member's
 * per-circle address — she can reach only Anna, and Anna serves the circle's conversation to a fellow member. If Dana
 * then holds Cas's statement, verified against HER roster (the production binding, not the harness's in-process
 * shortcut), the eventual half of "a member carries for a member" exists today, with no consent setting needed:
 * serving a circle's content to a member of that circle is ordinary membership.
 *
 * The LAN is modelled as a second relay only Anna and Dana are on, which Anna's circle rides as a second connection
 * point (the same registration the shells make for a circle with two points). A real LAN rung (mDNS) is the phones'
 * transport; what is under test here is the catch-up, not the medium.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { registerCircleAddressesOnRelays } from '../src/v2/circleAddressRegistration.js';
import { rosterBindingVerifier } from '../src/v2/membershipRail.js';

const CIRCLE = 'lan-catch-up-circle';
const chatIn = (node) => node.chatRail.storedStatements(CIRCLE).map((s) => s?.body?.payload?.text).filter(Boolean);

describe('a member only the LAN reaches catches up a statement from the member who reaches both', () => {
  let relay; let lan; let anna; let cas; let dana;
  afterAll(async () => {
    await teardown(anna, cas, dana);
    for (const r of [relay, lan]) { try { await r?.close?.(); } catch { /* */ } }
  });

  it("Cas posts on the relay; Dana, on the LAN only, holds his statement after her catch-up with Anna", async () => {
    relay = await startJourneyRelay();
    lan = await startJourneyRelay();
    const danaRef = {};
    const lane = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
    [anna, cas] = await Promise.all([
      bootRealAgentNode('anna', { agentOpts: lane() }),
      bootRealAgentNode('cas', { agentOpts: lane() }),
    ]);
    dana = await bootRealAgentNode('dana', {
      agentOpts: lane(),
      // Dana verifies the way a device does: against the roster she holds, nothing in-process
      verifyChatBinding: rosterBindingVerifier((app, op, args) => danaRef.node.agent.callSkill(app, op, args)),
    });
    danaRef.node = dana;

    await anna.agent.connectPeerTransport({ relayUrl: relay.url, extraRelayUrls: [lan.url], onPeerMessage: (e) => anna._routerRef.fn?.(e), awaitRelayReady: true });
    await cas.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (e) => cas._routerRef.fn?.(e), awaitRelayReady: true });
    await dana.agent.connectPeerTransport({ relayUrl: lan.url, onPeerMessage: (e) => dana._routerRef.fn?.(e), awaitRelayReady: true });
    expect((anna.agent.relays?.list?.() ?? []).map((r) => r.url).sort(), 'Anna is on both rungs').toEqual([relay.url, lan.url].sort());

    await createCircle(anna, { groupId: CIRCLE, name: 'Straat' });
    const casJoin = await joinExistingCircle(anna, cas, { groupId: CIRCLE, handle: 'cas' });
    expect(casJoin.joined?.ok, JSON.stringify(casJoin.joined)).toBe(true);
    const danaJoin = await joinExistingCircle(anna, dana, { groupId: CIRCLE, handle: 'dana' });
    expect(danaJoin.joined?.ok, JSON.stringify(danaJoin.joined)).toBe(true);
    await bindCircleAddresses([anna, cas, dana], CIRCLE);
    // Anna's circle rides both points: her per-circle address on the LAN socket too (the shells' registration)
    const points = () => [CIRCLE];
    points.pointsFor = () => [relay.url, lan.url];
    await registerCircleAddressesOnRelays({
      relays: anna.agent.relays.list(), circleIds: [CIRCLE], circlesForPoint: points, defaultRelayUrl: relay.url,
      circleAddressFor: (cid) => anna.agent.circleAddressFor(cid), circleAddressSignerFor: (cid) => anna.agent.circleAddressSignerFor(cid),
      alsoAddresses: anna.agent.ownAddressBindings?.() ?? [],
    });
    await Promise.all([anna, cas, dana].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));

    // Dana's roster names Cas — the membership she pulled from Anna when she joined
    const casInDanasRoster = await until(async () => {
      const r = await dana.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE });
      return (r?.members ?? []).some((m) => m.webid === cas.pubKey) ? true : null;
    }, { timeout: 20_000, step: 250 });
    expect(casInDanasRoster, "Cas is not in Dana's roster — the catch-up question cannot be asked yet").toBe(true);

    const sent = await sendCircleChat(cas, { groupId: CIRCLE, msgId: 'cas-1', text: 'de container staat bij nummer 12' });
    expect(sent?.error ?? null, JSON.stringify(sent)).toBe(null);
    expect(await until(async () => (chatIn(anna).includes('de container staat bij nummer 12') ? true : null), { timeout: 20_000, step: 200 }),
      'Anna, on the same relay, never received Cas\'s statement').toBe(true);
    // the branch named: Cas's fan did not reach Dana live
    expect(chatIn(dana), 'Dana received it live — the relay reached her, so this is not the LAN-only case').not.toContain('de container staat bij nummer 12');

    // Dana's catch-up: the boot/reconnect pull, at each member's per-circle address
    const asked = await dana.chatCatchUp.requestCircle(CIRCLE, { callSkill: (app, op, args) => dana.agent.callSkill(app, op, args) });
    expect(asked.requested, 'Dana asked nobody').toBeGreaterThan(0);
    const got = await until(async () => (chatIn(dana).includes('de container staat bij nummer 12') ? true : null), { timeout: 30_000, step: 250 });
    expect(got, "Dana does not hold Cas's statement after her catch-up with Anna").toBe(true);
  }, 180_000);
});
