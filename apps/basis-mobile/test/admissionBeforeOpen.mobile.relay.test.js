/**
 * AN ADMISSION BEFORE THE FOUNDER OPENED THE CIRCLE STILL GIVES THE NEWCOMER THE KEY (a normal sealed circle, no pod).
 * Every circle the wizard makes is sealed. The key owner's device builds the circle's producer when the circle is
 * opened; a founder phone that admits someone before that (the circle not opened since a restart) routed the grant to
 * no producer: no key file change, no key event, and the newcomer had no key until the founder happened to open that
 * circle. Now the admission builds the producer for any SEALED circle (or one with a pod), so the newcomer holds the
 * key with nothing opened on the founder's side. Two phones in Node on one relay, no pod.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle, until } from '../../basis/test/support/pairRealAgents.js';
import { policyPatchFromState } from '../../basis/src/core/wizards/createGroupState.js';
import { bootMobileNode } from './support/mobileNode.js';

const G = 'admitted-before-open';

describe('an admission before the founder opened the circle', () => {
  let relay; let anna; let bram;
  afterAll(async () => {
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('the newcomer holds the key of a normal sealed circle, nothing opened on the founder\'s phone', async () => {
    relay = await startJourneyRelay();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;

    // the wizard's circle (no pod; sealed, as every wizard circle) and its policy as the create modal persists it
    const { state: made } = await createCircle(anna, { groupId: G, name: 'Straat', handle: 'anna' });
    await anna.persistPolicy(G, policyPatchFromState(made));
    expect((await anna.policyOf(G))?.storagePosture, 'a wizard circle is sealed').toBe('p2');
    // Anna's phone does NOT open the circle (as after a restart): no producer is built by a view

    const joined = await joinExistingCircle(anna, bram, { groupId: G, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await anna.bundle.registerCirclePresence?.([G]);

    expect(await until(() => bram.canSeal(G), { timeout: 30_000, step: 500 }), 'Bram\'s phone holds the circle\'s key').toBe(true);
  }, 120_000);
});
