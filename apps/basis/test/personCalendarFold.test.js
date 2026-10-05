/**
 * The calendar fold on a person's node (web and mobile, one declaration): a circle's appointments are its store's
 * `calendar-event` items, read with the circle's id — the same items the household bot writes, so a person in that
 * circle sees them; an appointment of no circle stays on the person's own calendar. Both answer through the one
 * `calendar` origin; nothing is copied between them.
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';

const tomorrowAt = (h) => { const d = new Date(Date.now() + 86_400_000); d.setHours(h, 0, 0, 0); return d.toISOString(); };

describe('a person\'s calendar, folded onto the circle\'s store', () => {
  it('with a circle: that circle\'s items; without: the person\'s own — neither shows the other', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS });
    const call = (app, op, args) => a.callSkill(app, op, args);
    await call('lists', 'createList', { text: 'Agenda', defaultChild: 'calendar-event', circleId: 'household' });
    const inCircle = await call('calendar', 'addEvent', { circleId: 'household', title: 'tandarts', startsAt: tomorrowAt(10) });
    expect(inCircle?.ok, JSON.stringify(inCircle)).not.toBe(false);
    const own = await call('calendar', 'addEvent', { title: 'hardlopen', startsAt: tomorrowAt(8) });
    expect(own?.ok, JSON.stringify(own)).not.toBe(false);

    const titles = (r) => (r?.items ?? r?.events ?? []).map((e) => String(e.title ?? e.label ?? e.text).replace(/^.* · /, ''));
    expect(titles(await call('calendar', 'listEvents', { circleId: 'household', days: 7 }))).toEqual(['tandarts']);
    const mine = titles(await call('calendar', 'listEvents', { days: 7 }));
    expect(mine).toContain('hardlopen');
    expect(mine).not.toContain('tandarts');
    // the circle's appointment is an item in that circle's ONE store (what the circle syncs to its members)
    const agenda = await call('lists', 'listEntries', { list: 'Agenda', circleId: 'household' });
    expect((agenda?.items ?? []).map((i) => i.label ?? i.text).join(' ')).toContain('tandarts');
  });
});
