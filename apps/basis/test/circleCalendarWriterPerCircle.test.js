/**
 * Who writes, when a call names no actor, is decided PER CIRCLE: a circle with a self of its own (a pair circle's
 * lens) is written as that self — an rsvp authored by the general 'me' is a row no pair roster names (L350). An actor
 * the call names still wins.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeCircleCalendarOps } from '../src/v2/circleCalendarOps.js';
import { rowAuthorFor } from '../src/v2/rowAuthor.js';
import { pairCircleIdFor } from '../src/v2/pairCircleId.js';

const PAIR_X = pairCircleIdFor('addr-a', 'addr-b');      // a pair circle whose self this device runs ('lens-key')
const PAIR_NONE = pairCircleIdFor('addr-c', 'addr-d');   // one whose self it does not run

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const setup = () => {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const ops = makeCircleCalendarOps({ storeFor: (id) => stores.getStore(id), activeCircle: () => null, t,
    // the agent's rule itself (rowAuthor.js): a pair circle is written by its self only (a named actor must BE that
    // self), an ordinary circle by whoever the call names, else the circle's self ('self-h' here)
    localActor: rowAuthorFor({ circleSelf: (c) => ({ [PAIR_X]: { webid: 'lens-key' }, household: { webid: 'self-h' } })[c] ?? null }) });
  return { ops, stores };
};
// a day from now, whenever the suite runs: a fixed date became the past on its own day and the upcoming list emptied
const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe('the writer per circle', () => {
  it('an rsvp in a pair circle is the circle self\'s; in an ordinary circle the circle\'s self too (never the local "me")', async () => {
    const { ops } = setup();
    for (const c of [PAIR_X, 'household']) {
      const made = await ops.addEvent({ circleId: c, title: 'Koffie', startsAt: when });
      await ops.rsvpAccept({ circleId: c, id: made.itemId });
      const [e] = (await ops.listEvents({ circleId: c, days: 3650 })).items;
      expect(Object.keys(e.rsvp), c).toEqual([c === PAIR_X ? 'lens-key' : 'self-h']);
      expect(e.createdBy, c).toBe(c === PAIR_X ? 'lens-key' : 'self-h');
    }
  });
  it('in an ordinary circle the actor the call names is the writer', async () => {
    const { ops } = setup();
    const made = await ops.addEvent({ circleId: 'household', title: 'Koffie', startsAt: when });
    await ops.rsvpAccept({ circleId: 'household', id: made.itemId, actor: 'someone' });
    const [e] = (await ops.listEvents({ circleId: 'household', days: 3650 })).items;
    expect(Object.keys(e.rsvp)).toEqual(['someone']);
  });
  it('in a pair circle a named actor must BE its self: \'me\' (or anyone else) is refused, nothing written', async () => {
    const { ops, stores } = setup();
    expect(await ops.addEvent({ circleId: PAIR_X, title: 'Koffie', startsAt: when, actor: 'me' })).toMatchObject({ ok: false, code: 'no-self' });
    expect((await stores.getStore(PAIR_X).listByType('calendar-event')) ?? []).toEqual([]);
    const ok = await ops.addEvent({ circleId: PAIR_X, title: 'Koffie', startsAt: when, actor: 'lens-key' });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await ops.rsvpAccept({ circleId: PAIR_X, id: ok.itemId, actor: 'someone' })).toMatchObject({ ok: false, code: 'no-self' });
  });
  it('a pair circle whose self this device does not run is not ours to write: refused, nothing written', async () => {
    const { ops, stores } = setup();
    const add = await ops.addEvent({ circleId: PAIR_NONE, title: 'Koffie', startsAt: when });
    expect(add).toMatchObject({ ok: false, code: 'no-self' });
    expect((await ops.listEvents({ circleId: PAIR_NONE, days: 3650 })).items).toEqual([]);
    for (const op of ['updateEvent', 'cancelEvent', 'rsvpAccept']) {
      expect(await ops[op]({ circleId: PAIR_NONE, id: 'x', when }), op).toMatchObject({ ok: false, code: 'no-self' });
    }
    expect((await stores.getStore(PAIR_NONE).listByType('calendar-event')) ?? []).toEqual([]);
  });
});
