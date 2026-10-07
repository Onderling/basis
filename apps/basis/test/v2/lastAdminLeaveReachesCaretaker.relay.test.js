/**
 * When the LAST admin leaves, the fold appoints a caretaker — but only on the devices that land the leave. If the
 * leaver's copy to the caretaker is lost, the caretaker never learns it is admin, and the members who did land it are
 * not admins, so the admins' retell never fires. Any member who lands a departure that EMPTIES the admin set tells the
 * circle again (the same signed statement, the same message id). Three real nodes on a real relay; the leaver's copy to
 * the caretaker is dropped on purpose, so only that repair can bring it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { caretakerOrder } from '@onderling/core';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootAppCircle, rosterOf, hasMember, untilTrue } from '../../../e2e-journeys/journeys/_app.mjs';
import { MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

const CIRCLE = 'last-admin-leave-reaches-caretaker';
const roleIn = (rows, pubKey) => rows.find((m) => m?.webid === pubKey)?.role ?? null;

describe('the last admin leaves and the copy to the caretaker is lost', () => {
  let relay; let circle;
  afterAll(async () => { await circle?.close?.(); await relay?.close?.(); });

  it('the caretaker still learns it is admin: a member who landed it tells the circle', async () => {
    relay = await startJourneyRelay();
    circle = await bootAppCircle({ relayUrl: relay.url, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    expect(roleIn(await rosterOf(bram, CIRCLE), anne.pubKey), 'anne founded it: the one admin').toBe('admin');
    // each of bram and cato drops the LEAVER's own copy of the leave when the fold would make THEM the caretaker
    const anneAddr = anne.agent.circleAddressFor(CIRCLE);
    const dropped = [];
    for (const me of [bram, cato]) {
      const live = me._routerRef.fn;
      me._routerRef.fn = (env) => {
        const p = env?.payload;
        if (p?.subtype === MEMBERSHIP_BROADCAST && p?.event?.body?.kind === 'leave' && (env.from === anneAddr || env.from === anne.pubKey)) {
          const [caretaker] = caretakerOrder([bram.pubKey, cato.pubKey], p.event.body.hash);
          if (caretaker === me.pubKey) { dropped.push(me.handle ?? me.pubKey); return undefined; }
        }
        return live?.(env);
      };
    }
    const left = await anne.agent.callSkill('stoop', 'leaveGroup', { groupId: CIRCLE, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeUndefined();
    // the bystander lands it, and its fold names the caretaker (the drop above picked the same one, or this says so)
    const both = [bram, cato];
    const landed = async (n) => !hasMember(await rosterOf(n, CIRCLE), anne.pubKey);
    expect(await untilTrue(async () => (await Promise.all(both.map(landed))).some(Boolean)), 'a member learns of the leave').toBe(true);
    expect(dropped.length, 'the leaver\'s copy to the caretaker was the one lost').toBeGreaterThan(0);
    const bystander = both.find((n) => !dropped.includes(n.handle ?? n.pubKey));
    const caretaker = both.find((n) => n !== bystander);
    const seen = await rosterOf(bystander, CIRCLE);
    expect(roleIn(seen, caretaker.pubKey), `the bystander's fold names the caretaker: ${JSON.stringify(seen.map((m) => [m.webid?.slice(0, 6), m.role]))}`).toBe('admin');
    // …and the caretaker learns it too: anne gone from its roster, and itself the admin
    expect(await untilTrue(async () => {
      const rows = await rosterOf(caretaker, CIRCLE);
      return !hasMember(rows, anne.pubKey) && roleIn(rows, caretaker.pubKey) === 'admin';
    }, 15_000), 'the caretaker learns it is admin').toBe(true);
  }, 180_000);
});
