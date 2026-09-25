/**
 * A CONTACT RECORDS WHICH PERSONA THEY WERE ADDED THROUGH.
 *
 * The lens, not a second identity: one key, one address, one pair circle, and the persona decides what this
 * contact SEES of you (the release their pair roster carries). Ledger L123 is the other thing — a persona as
 * its own person on the wire — and it is not built.
 *
 * The field must survive `MemberMap.#normalise`, which is an explicit whitelist: a field not named there is
 * dropped silently, which is exactly how `avatarThumb` disappeared earlier today.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemberMap } from '@onderling/identity-resolver';
import { createContactBook } from '../src/lib/ContactBook.js';

let members; let book;
beforeEach(() => {
  members = new MemberMap();
  // The book persists through a dataSource; a memory stub is enough — what is under test is the FIELD's
  // survival through `MemberMap.#normalise`, not storage.
  book = createContactBook({ members, dataSource: { read: async () => null, write: async () => {} } });
});

describe('the persona a contact was added through', () => {
  it('survives the member map — a field the whitelist does not name is dropped in silence', async () => {
    const row = await book.addContact({ webid: 'w1', persona: 'buurt' });
    expect(row.persona, 'stored, not swallowed').toBe('buurt');
    expect((await members.resolveByWebid('w1')).persona).toBe('buurt');
  });

  it('is ABSENT when nothing chose one — never invented', async () => {
    // A row that predates the field, or an add that did not ask. `null` says "not recorded"; only the
    // explicit backfill may turn that into `default`, and only where it can prove it.
    const row = await book.addContact({ webid: 'w2' });
    expect(row.persona ?? null).toBeNull();
  });

  it('is upsert-shaped like the rest of the row: a later add can change which persona a contact sees', async () => {
    await book.addContact({ webid: 'w3', persona: 'default' });
    const again = await book.addContact({ webid: 'w3', persona: 'buurt' });
    expect(again.persona).toBe('buurt');
  });

  it('a re-add that does not mention the persona leaves the recorded one alone', async () => {
    // Scanning someone's card again must not quietly reset what they see of you.
    await book.addContact({ webid: 'w4', persona: 'buurt' });
    const again = await book.addContact({ webid: 'w4', displayName: 'Bea' });
    expect(again.persona, 'the earlier choice stands').toBe('buurt');
  });
});

describe('changing what a contact sees, later (L125)', () => {
  it('records the persona, the level and WHEN — and all three survive the member map', async () => {
    await book.addContact({ webid: 'w5', persona: 'default' });
    const row = await book.setPersona('w5', 'buurt', { revealPreset: 'handle', personaAt: 1000 });
    expect(row).toMatchObject({ persona: 'buurt', revealPreset: 'handle', personaAt: 1000 });
    expect(await members.resolveByWebid('w5')).toMatchObject({ persona: 'buurt', revealPreset: 'handle', personaAt: 1000 });
  });

  it('keeps the level already recorded when the change names none', async () => {
    await book.addContact({ webid: 'w6', persona: 'default', revealPreset: 'full' });
    const row = await book.setPersona('w6', 'buurt', { personaAt: 5 });
    expect(row.revealPreset).toBe('full');
  });

  it('refuses a level that is not one, and a contact the book does not hold', async () => {
    await book.addContact({ webid: 'w7' });
    await expect(book.setPersona('w7', 'buurt', { revealPreset: 'everything' })).rejects.toThrow();
    await expect(book.setPersona('nobody', 'buurt')).rejects.toThrow();
  });
});
