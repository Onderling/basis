/**
 * AN ANSWER IS ITS OWN ITEM: Bob's yes to Anne's appointment is an `rsvp` item he writes, not a field on her
 * appointment — so Anne moving the appointment before she has seen his yes (a whole-item write that never carried it)
 * cannot take the yes away, on either replica. And an answer counts only when it speaks for the self that wrote it.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeCircleCalendarOps } from '../src/v2/circleCalendarOps.js';
import { rsvpItemId } from '../src/v2/rsvpItems.js';

const NAMES = { 'circle.lists.template.schedule': 'Agenda' };
const t = (k, v) => NAMES[k] ?? (v ? `${k} ${JSON.stringify(v)}` : k);
const C = 'c-pair';

function node(self) {
  const registry = createRegistry(); registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const ops = makeCircleCalendarOps({ storeFor: (id) => stores.getStore(id), activeCircle: () => C, t, localActor: self });
  return { self, store: () => stores.getStore(C), ops };
}
/** Carry what `from` holds to `to`, as the lane does (an inbound write, the item's own clock and writer). */
async function deliver(from, to, filter = () => true) {
  for (const it of await from.store().list()) if (filter(it)) await to.store().put(it, { origin: true, sync: false });
}
const answersOn = async (n, id) => ((await n.ops.listEvents({ circleId: C, days: 30 })).items.find((e) => e.id === id)?.rsvp ?? null);
const soon = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('an answer to an appointment is its own item', () => {
  it("Anne's move that never saw Bob's yes keeps the yes — on both replicas", async () => {
    const anne = node('anne'); const bob = node('bob');
    const made = await anne.ops.addEvent({ circleId: C, title: 'Koffie', startsAt: soon(24), endsAt: soon(25) });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    await deliver(anne, bob);
    expect((await bob.ops.rsvpAccept({ circleId: C, id: made.itemId })).ok).toBe(true);
    // Anne, not having seen it, moves the appointment twice (her clock runs ahead of Bob's answer)
    await anne.ops.updateEvent({ circleId: C, id: made.itemId, when: soon(26) });
    await anne.ops.updateEvent({ circleId: C, id: made.itemId, when: soon(27) });
    await deliver(anne, bob); await deliver(bob, anne);
    expect(await answersOn(bob, made.itemId)).toEqual({ bob: 'accepted' });
    expect(await answersOn(anne, made.itemId)).toEqual({ bob: 'accepted' });
  });

  it('an answer that does not speak for its writer is ignored (Bob cannot answer as Anne)', async () => {
    const anne = node('anne');
    const made = await anne.ops.addEvent({ circleId: C, title: 'Thee', startsAt: soon(24), endsAt: soon(25) });
    await anne.store().put({ type: 'rsvp', id: rsvpItemId(made.itemId, 'anne'), event: made.itemId, by: 'anne', response: 'declined', at: 1, updatedBy: 'bob', clock: 99 }, { origin: true, sync: false });
    expect(await answersOn(anne, made.itemId)).toBeNull();
  });

  it('nothing writes the appointment when someone answers', async () => {
    const anne = node('anne');
    const made = await anne.ops.addEvent({ circleId: C, title: 'Lunch', startsAt: soon(24), endsAt: soon(25) });
    const puts = [];
    const store = anne.store(); const put = store.put.bind(store);
    store.put = (it, o) => { puts.push(it.type); return put(it, o); };
    await anne.ops.rsvpTentative({ circleId: C, id: made.itemId });
    expect(puts).toEqual(['rsvp']);
    expect((await store.get(made.itemId)).rsvp).toBeUndefined();
    // …and an appointment is made without one (the calendar's own `rsvp: {}` stays out of a circle)
    const fresh = await anne.ops.addEvent({ circleId: C, title: 'Diner', startsAt: soon(30), endsAt: soon(31) });
    expect(Object.keys(await store.get(fresh.itemId))).not.toContain('rsvp');
  });
});
