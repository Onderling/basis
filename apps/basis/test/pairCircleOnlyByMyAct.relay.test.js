/**
 * A PAIR CIRCLE ENTERS MY LIST ONLY BY AN ACT OF MINE (Fable's condition, 2026-11-12). The contact door treats anyone on
 * one of my pair-circle rosters as known, so the stranger rule rests on this: an inbound frame never puts a pair circle
 * in my circle list. The writers, named: the pair roster founds one on MY outbound turn (`prepare`), answers a
 * `pairRequest` and joins on a `pairInvite` only for a turn the door let on as known (a held or dropped turn returns
 * before them; a circle member's turn has them stripped); a sibling's circle-follow is one of my own devices.
 *
 * Here: the stranger is the pair FOUNDER (their webid sorts first), so their very first turn carries the invite into
 * the pair circle they made. On my side the turn is HELD, and no pair circle appears.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown, addCardOf } from './support/pairRealAgents.js';
import { pairFounderOf, pairCircleIdFor, isPairCircleId } from '../src/v2/pairCircleId.js';

const circlesOf = async (node) => ((await node.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id)));
const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];

describe('a stranger who founds the pair circle cannot put it in my list', () => {
  let relay; let a; let b; let stranger; let me;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    a = await bootRealAgentNode('a', { contactChannel: true });
    b = await bootRealAgentNode('b', { contactChannel: true });
    await connectNodesOverRelay([a, b], { relayUrl: relay.url });
    // the stranger is whichever of the two founds their pair circle
    stranger = pairFounderOf(a.pubKey, b.pubKey) === a.pubKey ? a : b;
    me = stranger === a ? b : a;
  }, 90_000);
  afterAll(async () => { await teardown(a, b); await relay?.close?.(); });

  it('the founder\'s first turn carries the invite; on my side it is held and no pair circle appears', async () => {
    const pairId = pairCircleIdFor(stranger.pubKey, me.pubKey);
    // the stranger holds my card (a link I shared, a card passed on): whoever writes holds the card of whom they write to;
    // I hold nothing of theirs, so to MY door they are a stranger
    await addCardOf(stranger, me);
    await stranger.contactThreadChannel.sendTurn({ peerAddr: me.pubKey, text: 'hoi, ik ken je niet', messageId: 's-1' });
    // the stranger made the pair circle on their side (the invite rode the turn)
    expect(await until(async () => ((await circlesOf(stranger)).includes(pairId) ? true : null), { timeout: 20_000, step: 200 }),
      'the founder never made the pair circle, so the invite never rode the turn and this walk proves nothing').toBe(true);
    expect(await until(async () => ((await requestsOf(me)).some((q) => q.from === stranger.pubKey) ? true : null), { timeout: 20_000, step: 200 })).toBe(true);
    await new Promise((r) => { setTimeout(r, 3000); });
    expect((await circlesOf(me)).filter(isPairCircleId), 'an inbound invite put a pair circle in my list').toEqual([]);
    // and the stranger is still not known to my door by any roster
    expect(await me.agent.messageRequests.isKnown(stranger.pubKey)).toBe(false);
  }, 60_000);
});
