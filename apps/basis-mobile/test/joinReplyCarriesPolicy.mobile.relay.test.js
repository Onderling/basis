/**
 * THE JOIN'S REPLY CARRIES THE CIRCLE'S POLICY. A joined circle's posture is not known until its policy arrived (the
 * joiner's writes are refused meanwhile); the founder's policy statement reached the joiner only by its governance pull,
 * seconds after the join. The admitting admin's redeem reply now carries the circle's policy, and the joiner adopts it
 * when the reply came from the invite's own admin: the circle is known the moment the join returns, no refused window.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle } from '../../basis/test/support/pairRealAgents.js';
import { policyPatchFromState } from '../../basis/src/core/wizards/createGroupState.js';
import { bootMobileNode } from './support/mobileNode.js';

const G = 'reply-carries-policy';

describe('the join\'s reply carries the circle\'s policy', () => {
  let relay; let anna; let bram;
  afterAll(async () => {
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('the joiner holds the circle as sealed the moment the join returns', async () => {
    relay = await startJourneyRelay();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    const { state: made } = await createCircle(anna, { groupId: G, name: 'Meteen bekend', handle: 'anna' });
    await anna.persistPolicy(G, policyPatchFromState(made));
    await anna.openCircle(G);
    await anna.bundle.registerCirclePresence?.([G]);
    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;
    const joined = await joinExistingCircle(anna, bram, { groupId: G, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    // at once: no wait for the governance pull
    const p = await bram.policyOf(G);
    expect(p?.policyPending ?? false, 'not pending: the reply carried the policy').toBe(false);
    expect(p?.storagePosture, 'the circle\'s own posture').toBe('p2');
  }, 120_000);
});
