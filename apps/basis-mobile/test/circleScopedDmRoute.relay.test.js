/**
 * A DIRECT MESSAGE TO A MEMBER'S CIRCLE ADDRESS IS CIRCLE TRAFFIC — it rides the circle's connection points, never a
 * transport that cannot carry a per-circle address.
 *
 * The noticeboard's Ask opens a thread at the match's CIRCLE address (askMatches.js), by design. A turn to that address
 * must carry the circle's scope (architecture §4, "Per-peer is not enough for a circle"): the circle's points narrow
 * the candidates, and a transport that cannot carry per-circle addresses is refused unless the per-user fallback is on.
 * Found on the emulator (the messaging walk, 2026-11-11): the phone's answer to such a thread left on live NKN —
 * "no identity is bound to … sending to the alias itself, which may reach nobody" — and never arrived.
 *
 * Two phones (test/support/mobileNode.js), each with NKN UP and reaching nobody (`liveNknStub`), the emulator's case.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle } from '../../basis/test/support/pairRealAgents.js';
import { bootMobileNode, liveNknStub } from './support/mobileNode.js';

const G = 'ask-circle';
const until = async (pred, ms = 20_000) => {
  const t0 = Date.now();
  while (!(await pred())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => { setTimeout(r, 100); }); }
  return true;
};

describe('a thread opened at a member\'s circle address stays on the circle\'s route, both ways', () => {
  let relay; let anna; let bob; let nknA; let nknB;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    nknA = liveNknStub(); nknB = liveNknStub();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url, nknLib: nknA });
    bob = await bootMobileNode({ name: 'bob', relayUrl: relay.url, nknLib: nknB });
    bob.sendPeerRedeem = bob.bundle.sendPeerRedeem;
    await createCircle(anna, { groupId: G, name: 'Straat' });
    const j = await joinExistingCircle(anna, bob, { groupId: G, handle: 'bob' });
    if (!j.joined?.ok) throw new Error(`join failed: ${JSON.stringify(j.joined)}`);
    await anna.bundle.registerCirclePresence?.([G]);
    await bob.bundle.registerCirclePresence?.([G]);
  }, 120_000);
  afterAll(async () => { await anna?.dispose(); await bob?.dispose(); await relay?.close(); });

  it('Anna asks Bob at his circle address (the Ask door); Bob\'s answer reaches her, and nothing rides NKN', async () => {
    // Ask exists only inside an opened circle: both phones open it as the launcher does
    await anna.openCircle(G); await bob.openCircle(G);
    const bobInCircle = bob.agent.circleAddressFor(G);
    expect(bobInCircle, 'Bob has no circle address').toBeTruthy();
    // the Ask door: the thread with the match, addressed to his CIRCLE address
    const asked = anna.bundle.contactChannel.sendTurn({ peerAddr: bobInCircle, threadId: bobInCircle, text: 'heb je een boormachine?' });
    await asked.sent;
    expect(await until(() => bob.landed.contactReplies.some((r) => r.text === 'heb je een boormachine?')),
      `Bob never got the ask; NKN sends from Anna: ${JSON.stringify(nknA.sent.map((s) => s.slice(0, 10)))}`).toBe(true);
    const got = bob.landed.contactReplies.find((r) => r.text === 'heb je een boormachine?');

    // Bob answers in the thread the way the thread screen does: to the address the turn came from
    const answered = bob.bundle.contactChannel.sendTurn({ peerAddr: got.fromAddr, threadId: got.threadId, text: 'ja, kom maar halen' });
    const sent = await answered.sent;
    const reached = await until(() => anna.landed.contactReplies.some((r) => r.text === 'ja, kom maar halen'));
    const nkn = { anna: nknA.sent.map((s) => s.slice(0, 10)), bob: nknB.sent.map((s) => s.slice(0, 10)) };
    // the branch, named: arrived, held honestly, or lost on a transport that cannot carry it
    expect(nkn.bob, `Bob's answer (to ${String(got.fromAddr).slice(0, 10)}) left over NKN; send result ${JSON.stringify(sent)}`).toEqual([]);
    expect(reached || sent?.held === true,
      `Bob's answer neither reached Anna nor was held; send result ${JSON.stringify(sent)}; nkn ${JSON.stringify(nkn)}`).toBe(true);
    expect(nkn.anna, 'Anna sent something over NKN').toEqual([]);
  }, 60_000);
});
