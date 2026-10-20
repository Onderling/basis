/**
 * Who writes, when a call names no actor, is decided PER CIRCLE: a circle with a self of its own (a pair circle's
 * lens) is written as that self — an rsvp authored by the general 'me' is a row no pair roster names (L350). An actor
 * the call names still wins.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeCircleCalendarOps } from '../src/v2/circleCalendarOps.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const setup = () => {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const ops = makeCircleCalendarOps({ storeFor: (id) => stores.getStore(id), activeCircle: () => null, t,
    localActor: (circleId) => (circleId === 'pair-x' ? 'lens-key' : circleId === 'pair-none' ? null : 'me') });
  return { ops, stores };
};
const when = '2026-11-03T13:00:00.000Z';

describe('the writer per circle', () => {
  it('an rsvp in a pair circle is the circle self\'s; elsewhere the general one', async () => {
    const { ops } = setup();
    for (const c of ['pair-x', 'household']) {
      const made = await ops.addEvent({ circleId: c, title: 'Koffie', startsAt: when });
      await ops.rsvpAccept({ circleId: c, id: made.itemId });
      const [e] = (await ops.listEvents({ circleId: c, days: 3650 })).items;
      expect(Object.keys(e.rsvp), c).toEqual([c === 'pair-x' ? 'lens-key' : 'me']);
      expect(e.createdBy, c).toBe(c === 'pair-x' ? 'lens-key' : 'me');
    }
  });
  it('an actor the call names wins', async () => {
    const { ops } = setup();
    const made = await ops.addEvent({ circleId: 'pair-x', title: 'Koffie', startsAt: when });
    await ops.rsvpAccept({ circleId: 'pair-x', id: made.itemId, actor: 'someone' });
    const [e] = (await ops.listEvents({ circleId: 'pair-x', days: 3650 })).items;
    expect(Object.keys(e.rsvp)).toEqual(['someone']);
  });
  it('a pair circle whose self this device does not run is not ours to write: refused, nothing written', async () => {
    const { ops, stores } = setup();
    const add = await ops.addEvent({ circleId: 'pair-none', title: 'Koffie', startsAt: when });
    expect(add).toMatchObject({ ok: false, code: 'no-self' });
    expect((await ops.listEvents({ circleId: 'pair-none', days: 3650 })).items).toEqual([]);
    for (const op of ['updateEvent', 'cancelEvent', 'rsvpAccept']) {
      expect(await ops[op]({ circleId: 'pair-none', id: 'x', when }), op).toMatchObject({ ok: false, code: 'no-self' });
    }
    expect((await stores.getStore('pair-none').listByType('calendar-event')) ?? []).toEqual([]);
  });
});
