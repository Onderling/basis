/**
 * A circle without an Agenda (any circle that is not a household: only the household template makes one) gets one on
 * its first appointment, as a person's own calendar does — an appointment made in that circle is not refused.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeCircleCalendarOps } from '../src/v2/circleCalendarOps.js';

const NAMES = { 'circle.lists.template.schedule': 'Agenda' };
const t = (k, v) => NAMES[k] ?? (v ? `${k} ${JSON.stringify(v)}` : k);

describe('the first appointment in a circle without an Agenda', () => {
  it('makes the circle\'s Agenda and puts the appointment in it; the second one uses the same Agenda', async () => {
    const registry = createRegistry();
    registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const ops = makeCircleCalendarOps({ storeFor: (id) => stores.getStore(id), activeCircle: () => null, t, localActor: 'me' });
    // moments RELATIVE to now: the listing reads the window from now on, so a fixed date passes out of it (this one did,
    // on its own day)
    const at = (days, h) => new Date(Date.now() + days * 86_400_000 + h * 3_600_000).toISOString();
    const first = await ops.addEvent({ circleId: 'c-plus', title: 'Koffie', startsAt: at(1, 0), endsAt: at(1, 1) });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const second = await ops.addEvent({ circleId: 'c-plus', title: 'Thee', startsAt: at(2, 0), endsAt: at(2, 1) });
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const all = await stores.getStore('c-plus').list();
    const agendas = all.filter((i) => i.defaultChild === 'calendar-event');
    expect(agendas.map((a) => a.text)).toEqual(['Agenda']);
    const listed = await ops.listEvents({ circleId: 'c-plus', days: 30 });
    expect(listed.items.map((i) => i.title).sort()).toEqual(['Koffie', 'Thee']);
  });
});
