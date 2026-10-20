/**
 * AN ANSWER IS ITS OWN ITEM: Bob's yes to Anne's appointment is an `rsvp` item he writes, not a field on her
 * appointment — so Anne moving the appointment before she has seen his yes (a whole-item write that never carried it)
 * cannot take the yes away, on either replica. And an answer counts only when it speaks for the self that wrote it.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeCircleCalendarOps } from '../src/v2/circleCalendarOps.js';
import { rsvpItemId, rosterAnswerRule, answerStatement } from '../src/v2/rsvpItems.js';
import { AgentIdentity, b64encode } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

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

describe('who an answer is from is SIGNED, not stated', () => {
  // each self's circle identity (the address key the rails sign with), and the roster that binds a member to it
  const signedNode = async (self, keyOf, roster, { vouchers = [] } = {}) => {
    const registry = createRegistry(); registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const ops = makeCircleCalendarOps({
      storeFor: (id) => stores.getStore(id), activeCircle: () => C, t, localActor: self,
      signerFor: async () => keyOf[self] ?? null, encode: b64encode,
      answerRuleFor: async () => rosterAnswerRule({ rows: roster(), verify: AgentIdentity.verify, vouchers: vouchers.map((v) => keyOf[v].pubKey) }),
    });
    return { self, store: () => stores.getStore(C), ops };
  };
  const keys = async (...names) => Object.fromEntries(await Promise.all(names.map(async (n) => [n, await AgentIdentity.generate(new VaultMemory())])));

  it("Bob's signed yes stands on both replicas; a member's device answering AS Anne is ignored on both", async () => {
    const k = await keys('anne', 'bob', 'carol');
    const roster = () => ['anne', 'bob', 'carol'].map((w) => ({ webid: w, circleAddress: k[w].pubKey }));
    const anne = await signedNode('anne', k, roster); const bob = await signedNode('bob', k, roster); const carol = await signedNode('carol', k, roster);
    const made = await anne.ops.addEvent({ circleId: C, title: 'Koffie', startsAt: soon(24), endsAt: soon(25) });
    await deliver(anne, bob); await deliver(anne, carol);
    expect((await bob.ops.rsvpAccept({ circleId: C, id: made.itemId })).ok).toBe(true);
    // Carol's device fans an answer naming ANNE — id, by and updatedBy all Anne's — signed with Carol's own key
    const forged = { type: 'rsvp', id: rsvpItemId(made.itemId, 'anne'), event: made.itemId, by: 'anne', response: 'declined', at: 2 };
    await carol.store().put({ ...forged, signer: k.carol.pubKey, sig: b64encode(k.carol.sign(answerStatement(forged))), updatedBy: 'anne', clock: 50 }, { origin: true, sync: false });
    for (const from of [bob, carol]) { await deliver(from, anne); }
    await deliver(carol, bob);
    expect(await answersOn(anne, made.itemId)).toEqual({ bob: 'accepted' });
    expect(await answersOn(bob, made.itemId)).toEqual({ bob: 'accepted' });
  });

  it("a door person's answer counts when the vouching function profile signed it — never when a person's device did", async () => {
    const k = await keys('bot', 'frits');
    const roster = () => ['bot', 'frits'].map((w) => ({ webid: w, circleAddress: k[w].pubKey }));
    const bot = await signedNode('bot', k, roster, { vouchers: ['bot'] });
    const frits = await signedNode('frits', k, roster, { vouchers: ['bot'] });
    const made = await bot.ops.addEvent({ circleId: C, title: 'Tandarts', startsAt: soon(24), endsAt: soon(25) });
    // the bot answers for its Telegram person
    expect((await bot.ops.rsvpTentative({ circleId: C, id: made.itemId, actor: 'telegram:222' })).ok).toBe(true);
    // Frits's phone signs an answer for another door person
    const f = { type: 'rsvp', id: rsvpItemId(made.itemId, 'telegram:333'), event: made.itemId, by: 'telegram:333', response: 'accepted', at: 3 };
    await frits.store().put({ ...f, signer: k.frits.pubKey, sig: b64encode(k.frits.sign(answerStatement(f))), updatedBy: 'telegram:333', clock: 60 }, { origin: true, sync: false });
    await deliver(bot, frits); await deliver(frits, bot);
    expect(await answersOn(bot, made.itemId)).toEqual({ 'telegram:222': 'tentative' });
    expect(await answersOn(frits, made.itemId)).toEqual({ 'telegram:222': 'tentative' });
  });
});
