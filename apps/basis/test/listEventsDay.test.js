/**
 * The agenda read for ONE day ("wat heb ik morgen gepland?"): `listEvents` takes an optional `day` (YYYY-MM-DD, the
 * local day), and then answers that day's appointments only, never the coming week. One handler serves a circle and
 * the person's own agenda (`makeCircleCalendarOps`).
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeCircleCalendarOps } from '../src/v2/circleCalendarOps.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (daysAhead, hour) => { const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, 0, 0, 0); return d; };

describe('listEvents for one day', () => {
  it('a day given: that local day\'s appointments only; none given: the coming week, as before', async () => {
    const registry = createRegistry();
    registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const ops = makeCircleCalendarOps({ storeFor: (id) => stores.getStore(id), activeCircle: () => null, t });
    await ops.addEvent({ circleId: 'c', title: 'tandarts', startsAt: at(1, 10).toISOString() });
    await ops.addEvent({ circleId: 'c', title: 'kapper', startsAt: at(2, 14).toISOString() });
    const tomorrow = await ops.listEvents({ circleId: 'c', day: local(at(1, 12)) });
    expect(tomorrow.items.map((e) => e.title)).toEqual(['tandarts']);
    const week = await ops.listEvents({ circleId: 'c' });
    expect(week.items.map((e) => e.title)).toEqual(['tandarts', 'kapper']);
  });
});
