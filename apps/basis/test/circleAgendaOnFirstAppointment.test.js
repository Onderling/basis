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
    const first = await ops.addEvent({ circleId: 'c-plus', title: 'Koffie', startsAt: '2026-10-20T11:00:00.000Z', endsAt: '2026-10-20T12:00:00.000Z' });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const second = await ops.addEvent({ circleId: 'c-plus', title: 'Thee', startsAt: '2026-10-21T11:00:00.000Z', endsAt: '2026-10-21T12:00:00.000Z' });
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const all = await stores.getStore('c-plus').list();
    const agendas = all.filter((i) => i.defaultChild === 'calendar-event');
    expect(agendas.map((a) => a.text)).toEqual(['Agenda']);
    const listed = await ops.listEvents({ circleId: 'c-plus', days: 30 });
    expect(listed.items.map((i) => i.title).sort()).toEqual(['Koffie', 'Thee']);
  });
});
