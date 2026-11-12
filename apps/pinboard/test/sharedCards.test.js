// A contact link the person hands out ("Share my contact") lets on its FIRST opener only: one link per sharing moment,
// per persona, used once, valid for a while, at most so many unused at a time, withdrawable. Rows on the own-devices
// store the contact book uses, never in the book.
import { describe, it, expect, beforeEach } from 'vitest';
import { createSharedCards, SHARED_CARD_TTL_MS, SHARED_CARDS_UNUSED_MAX } from '../src/lib/SharedCards.js';
import { createContactBook } from '../src/lib/ContactBook.js';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { encodeContactCard } from '../src/lib/contactCard.js';

const cardOf = (webid, displayName) => `onderling-contact://${encodeContactCard({ webid, pubKey: webid, displayName })}`;

const ownStore = () => createCircleStores({ dataSource: memoryDataSource(), rootPrefix: 'mem://own/' }).getStore('own-devices');

describe('shared contact links: one per sharing moment, used once', () => {
  let store; let clock; let links;
  const selves = { default: { id: 'default', writer: 'me' }, work: { id: 'work', writer: 'me-work' } };
  const selfFor = (p) => selves[p ?? 'default'] ?? null;
  beforeEach(() => {
    store = ownStore();
    clock = 1_000_000;
    links = createSharedCards({ store: () => store, selfFor, now: () => clock });
  });

  it('each share mints a fresh, unguessable token for the persona shared as; it is listed as not used yet', async () => {
    const a = await links.mint();
    const b = await links.mint();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(22);   // 128 bits, base64url
    expect(a.expiresAt).toBe(clock + SHARED_CARD_TTL_MS);
    const listed = await links.list();
    expect(listed.map((l) => l.token).sort()).toEqual([a.token, b.token].sort());
    expect(listed.every((l) => l.state === 'unused' && l.usedAt === null)).toBe(true);
    expect(await links.list({ persona: 'work' })).toEqual([]);
  });

  it('the first opener is let on and the link is then used; a second opener is not', async () => {
    const { token } = await links.mint();
    clock += 5;
    expect(await links.use({ token, by: 'bob' })).toEqual({ ok: true });
    expect(await links.use({ token, by: 'bob' })).toEqual({ ok: true });            // the same opener again (a resend, a sibling's copy)
    expect(await links.use({ token, by: 'carol' })).toEqual({ ok: false, reason: 'used' });
    const [l] = await links.list();
    expect(l).toMatchObject({ token, state: 'used', usedAt: clock, usedBy: 'bob' });
    expect(await links.usedBy(token)).toBe('bob');
  });

  it('a token of ANOTHER persona, an unknown one, an expired one or a withdrawn one lets no one on', async () => {
    const work = await links.mint({ persona: 'work' });
    expect(await links.use({ token: work.token, by: 'bob' })).toEqual({ ok: false, reason: 'unknown' });   // addressed to default
    expect(await links.use({ token: 'no-such-token-0000000', by: 'bob' })).toEqual({ ok: false, reason: 'unknown' });
    const { token } = await links.mint();
    clock += SHARED_CARD_TTL_MS + 1;
    expect(await links.use({ token, by: 'bob' })).toEqual({ ok: false, reason: 'expired' });
    expect((await links.list()).map((l) => l.token)).not.toContain(token);
    const fresh = await links.mint();
    expect(await links.withdraw(fresh.token)).toBe(true);
    expect(await links.use({ token: fresh.token, by: 'bob' })).toEqual({ ok: false, reason: 'unknown' });
    expect(await links.withdraw(fresh.token)).toBe(false);
  });

  it('at most so many UNUSED links per persona: the oldest unused goes; used ones are not counted', async () => {
    const first = await links.mint();
    clock += 1;
    const used = await links.mint();
    await links.use({ token: used.token, by: 'bob' });
    for (let i = 0; i < SHARED_CARDS_UNUSED_MAX; i += 1) { clock += 1; await links.mint(); }
    const listed = await links.list();
    expect(listed.filter((l) => l.state === 'unused')).toHaveLength(SHARED_CARDS_UNUSED_MAX);
    expect(listed.map((l) => l.token)).not.toContain(first.token);
    expect(listed.map((l) => l.token)).toContain(used.token);
  });

  it('a link is never a contact: the book stays empty', async () => {
    const book = createContactBook({ store: () => store, selfFor });
    const { token } = await links.mint();
    await links.use({ token, by: 'bob' });
    expect(await book.listContacts()).toEqual([]);
  });

  it('two devices that each let on a different first opener end on the same, earlier one (first-wins across devices)', async () => {
    const other = ownStore();
    const linksB = createSharedCards({ store: () => other, selfFor, now: () => clock });
    const { token } = await links.mint();
    const row = (await store.listByType('shared-card'))[0];
    await other.put(row, { origin: true, sync: false });                     // the unused link rode the own lane
    await links.use({ token, by: 'bob' });                                    // device A at t
    clock += 10;
    await linksB.use({ token, by: 'carol' });                                 // device B at t+10, not yet having heard
    const fromA = (await store.listByType('shared-card'))[0];
    const fromB = (await other.listByType('shared-card'))[0];
    await store.put(fromB, { origin: true, sync: false });
    await other.put(fromA, { origin: true, sync: false });
    expect(await links.usedBy(token)).toBe('bob');
    expect(await linksB.usedBy(token)).toBe('bob');                           // B now knows its opener lost
  });

  it('the first opener is named by the card their turn carried, and only when that card names them', async () => {
    const { token } = await links.mint();
    await links.use({ token, by: 'bob', card: cardOf('bob', 'Bea') });
    expect((await links.list())[0]).toMatchObject({ usedBy: 'bob', usedByName: 'Bea' });
    const other = await links.mint();
    await links.use({ token: other.token, by: 'carol', card: cardOf('mallory', 'Not Carol') });   // a card naming someone else
    expect((await links.list()).find((l) => l.token === other.token)).toMatchObject({ usedBy: 'carol', usedByName: null });
  });
});
