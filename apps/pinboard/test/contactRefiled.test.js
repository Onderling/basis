/**
 * A CONTACT RE-FILED UNDER ANOTHER SELF. When the persona a contact is filed under changes, the book records the move
 * (webid, the self it was filed under, when) so that self's lane can tell its devices — and a device that holds only
 * the old self FORGETS the contact: its contact facets go (persona, lens, trust, tags, flags, lists), its member row
 * stays (a circle may still need its name).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemberMap } from '@onderling/identity-resolver';
import { createContactBook } from '../src/lib/ContactBook.js';

let members; let book; let blobs;
beforeEach(() => {
  members = new MemberMap();
  blobs = new Map();
  book = createContactBook({ members, dataSource: {
    read: async (ref) => (blobs.has(ref) ? blobs.get(ref) : null),
    write: async (ref, value) => { blobs.set(ref, value); },
    list: async (prefix) => [...blobs.keys()].filter((k) => k.startsWith(prefix)),
  } });
});

describe('the re-file record', () => {
  it('a persona change records where the contact was filed before, and when', async () => {
    await book.addContact({ webid: 'w:bea', displayName: 'Bea', persona: 'default' });
    await book.setPersona('w:bea', 'p-000000000001', { personaAt: 500 });
    expect(await book.listRefiled()).toEqual([{ webid: 'w:bea', from: 'default', at: 500 }]);
    // the same self again is no move
    await book.setPersona('w:bea', 'p-000000000001', { personaAt: 600 });
    expect((await book.listRefiled()).length).toBe(1);
  });
});

describe('forgetContact', () => {
  it('drops the contact facets and keeps the member row (its name, its circle data)', async () => {
    await members.addMember({ webid: 'w:bea', displayName: 'Bea', role: 'member' });
    await book.addContact({ webid: 'w:bea', persona: 'default', trustLevel: 'vertrouwd' });
    await book.setTags('w:bea', ['koor']);
    await book.forgetContact('w:bea');
    expect((await book.listContacts()).map((c) => c.webid)).toEqual([]);
    const row = await members.resolveByWebid('w:bea');
    expect(row?.displayName).toBe('Bea');
    expect(row?.persona ?? null).toBe(null);
    expect(row?.trustLevel ?? null).toBe(null);
    expect(row?.tags ?? []).toEqual([]);
  });
  it('a webid that is not a contact here is left alone', async () => {
    await members.addMember({ webid: 'w:cor', displayName: 'Cor' });
    expect(await book.forgetContact('w:cor')).toBe(null);
    expect((await members.resolveByWebid('w:cor'))?.displayName).toBe('Cor');
  });
});
