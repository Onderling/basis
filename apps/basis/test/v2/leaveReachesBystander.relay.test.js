/**
 * A leave reaches every member even when the leaver's own copy to one of them is lost (L128: on CI the bystander kept
 * the leaver, and kept fanning to them — a correctness AND privacy defect). Three real nodes on a real relay; the
 * leaver's copy to the bystander is dropped on purpose, so the order is forced: only a repair can bring it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootAppCircle, rosterOf, hasMember, untilTrue } from '../../../e2e-journeys/journeys/_app.mjs';
import { MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

const CIRCLE = 'leave-reaches-bystander';

describe('a leave whose copy to the bystander is lost', () => {
  let relay; let circle;
  afterAll(async () => { await circle?.close?.(); await relay?.close?.(); });

  it('still reaches the bystander: the admin, who received it, tells the circle', async () => {
    relay = await startJourneyRelay();
    circle = await bootAppCircle({ relayUrl: relay.url, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    // the bystander never receives the LEAVER's own copy of the leave
    const bramAddr = bram.agent.circleAddressFor(CIRCLE);
    const live = cato._routerRef.fn;
    let dropped = 0;
    cato._routerRef.fn = (env) => {
      const p = env?.payload;
      if (p?.subtype === MEMBERSHIP_BROADCAST && p?.event?.body?.kind === 'leave' && (env.from === bramAddr || env.from === bram.pubKey)) { dropped += 1; return undefined; }
      return live?.(env);
    };
    expect(hasMember(await rosterOf(cato, CIRCLE), bram.pubKey)).toBe(true);
    const left = await bram.agent.callSkill('stoop', 'leaveGroup', { groupId: CIRCLE, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeUndefined();
    expect(await untilTrue(async () => !hasMember(await rosterOf(anne, CIRCLE), bram.pubKey)), 'the admin learns of it').toBe(true);
    expect(dropped, 'the leaver\'s copy to the bystander was the one lost').toBeGreaterThan(0);
    expect(await untilTrue(async () => !hasMember(await rosterOf(cato, CIRCLE), bram.pubKey), 15_000), 'the bystander learns of it too').toBe(true);
  }, 180_000);
});
