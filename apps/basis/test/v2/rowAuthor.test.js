/**
 * Who a row names as its MAKER. The local stamp 'me' never leaves a device in a circle's store: a receiver read it as
 * nobody and fell back to whoever served the snapshot, so a person's own appointment from their other device was news.
 * A row in a circle names its maker by that circle's self; the person's own scope keeps the self the call was made as,
 * else 'me' (that lane ends at their own devices).
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { rowAuthorFor, LOCAL_ME } from '../../src/v2/rowAuthor.js';
import { pairCircleIdFor } from '../../src/v2/pairCircleId.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';
import { makeCircleCalendarOps } from '../../src/v2/circleCalendarOps.js';
import { makeListsOps } from '../../src/v2/listsOps.js';
import { itemAuthor, landingKindOf, landingEntryFor } from '../../src/v2/itemLanding.js';

const PAIR = pairCircleIdFor('addr-a', 'addr-b');
const PAIR_NONE = pairCircleIdFor('addr-c', 'addr-d');
// this device: its self in the household is 'self-h', in the pair circle 'lens-key'; it runs no self for PAIR_NONE or
// for 'stranger' (a circle it holds no self in)
const selves = { household: 'self-h', [PAIR]: 'lens-key' };
const circleSelf = (circleId) => (selves[circleId] ? { webid: selves[circleId] } : null);
const author = rowAuthorFor({ circleSelf });

describe('rowAuthorFor: the maker a row names, per place', () => {
  it('an ordinary circle: the actor the call names (a door person), else the circle\'s self; never the local "me"', () => {
    expect(author('household')).toBe('self-h');
    expect(author('household', 'telegram:42')).toBe('telegram:42');
    expect(author('household', LOCAL_ME)).toBe('self-h');
    expect(author('stranger')).toBeNull();
  });
  it('a pair circle: its self only; any other name, "me" included, is refused', () => {
    expect(author(PAIR)).toBe('lens-key');
    expect(author(PAIR, 'lens-key')).toBe('lens-key');
    expect(author(PAIR, 'someone')).toBeNull();
    expect(author(PAIR, LOCAL_ME)).toBeNull();
    expect(author(PAIR_NONE)).toBeNull();
  });
  it('the own scope: the self the call was made as, else "me" (that lane ends at the person\'s own devices)', () => {
    expect(author(OWN_DEVICES_SCOPE)).toBe(LOCAL_ME);
    expect(author(OWN_DEVICES_SCOPE, null, { actAs: 'persona-p' })).toBe('persona-p');
    // in a circle the maker is the circle's self, never the self the call was made as
    expect(author('household', null, { actAs: 'persona-p' })).toBe('self-h');
  });
});

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const setup = () => {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const storeFor = (id) => stores.getStore(id);
  return {
    stores,
    calendar: makeCircleCalendarOps({ storeFor, activeCircle: () => null, t, localActor: author }),
    lists: makeListsOps({ storeFor, activeCircle: () => null, t, localActor: author }),
  };
};
const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const rows = async (stores, circleId) => (await stores.getStore(circleId).list()) ?? [];

describe('every kind that is news is written in a circle with a named maker', () => {
  it('an appointment and a chore in an ordinary circle name the circle\'s self, and each is a landing kind', async () => {
    const { stores, calendar, lists } = setup();
    expect((await calendar.addEvent({ circleId: 'household', title: 'Tandarts', startsAt: when })).ok).toBe(true);
    expect((await lists.createList({ circleId: 'household', text: 'Klusjes', defaultChild: 'task' })).ok).toBe(true);
    expect((await lists.addToList({ circleId: 'household', list: 'Klusjes', text: 'lamp vervangen' })).ok).toBe(true);
    const all = await rows(stores, 'household');
    const news = all.filter((r) => landingKindOf(r));
    expect(news.map((r) => r.type).sort()).toEqual(['calendar-event', 'task']);
    for (const r of all) expect(r.createdBy, `${r.type} ${r.text ?? ''}`).toBe('self-h');
    for (const r of news) expect(itemAuthor(r)).toBe('self-h');
  });
  it('a list op in a circle this device holds no self for is refused, nothing written', async () => {
    const { stores, lists } = setup();
    expect(await lists.createList({ circleId: 'stranger', text: 'Boodschappen' })).toMatchObject({ ok: false, code: 'no-self' });
    expect(await rows(stores, 'stranger')).toEqual([]);
  });
});

describe('who SERVED a snapshot is never who wrote the row', () => {
  it('my own appointment arriving from my other device (or a server\'s catch-up) is no news', async () => {
    const { stores, calendar } = setup();
    await calendar.addEvent({ circleId: 'household', title: 'Tandarts', startsAt: when });
    const [appt] = (await rows(stores, 'household')).filter((r) => r.type === 'calendar-event');
    // the sibling device speaks as the same self in that circle; whoever served the snapshot does not count
    expect(landingEntryFor({ circleId: 'household', item: appt, self: 'self-h', authorRef: 'server-ref' })).toBeNull();
    // someone else holding it: news, from its maker
    expect(landingEntryFor({ circleId: 'household', item: appt, self: 'self-x' })).toMatchObject({ actor: 'self-h' });
  });
  it('a row stamped "me" (an old row) names nobody, whoever served it: no author, no news', () => {
    const old = { id: 'e1', type: 'calendar-event', createdBy: LOCAL_ME };
    expect(landingEntryFor({ circleId: 'c1', item: old, authorRef: 'addr-b' })).toBeNull();
  });
});
