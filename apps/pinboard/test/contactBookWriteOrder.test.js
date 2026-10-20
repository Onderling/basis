/**
 * Two writes to one contact at once both land. `addContact` merges over the row it reads; two at once (a card's name
 * and the person key their hello brings) each read the row before the other wrote, and the later write put back the
 * row without the earlier one's field — a contact named by their key, or a key that is gone again.
 */
import { describe, it, expect } from 'vitest';
import { MemberMap } from '@onderling/identity-resolver';
import { createContactBook } from '../src/lib/ContactBook.js';

// a member map whose writes take a moment, as a persisted one does
const slowMembers = () => {
  const m = new MemberMap();
  const add = m.addMember.bind(m);
  m.addMember = async (row) => { await new Promise((r) => setTimeout(r, 5)); return add(row); };
  return m;
};

describe('the contact book, two writes at once', () => {
  it('a name and a person key for the same contact: both are on the row', async () => {
    const members = slowMembers();
    const book = createContactBook({ members, dataSource: { read: async () => null, write: async () => {} } });
    await book.addContact({ webid: 'bob', pubKey: 'bob' });   // the row their first hello made, no name yet
    await Promise.all([
      book.addContact({ webid: 'bob', pubKey: 'bob', displayName: 'Bob' }),
      book.addContact({ webid: 'bob', personKey: { version: 1, pubKey: 'pk-bob' } }),
    ]);
    const row = await members.resolveByWebid('bob');
    expect(row.displayName).toBe('Bob');
    expect(row.personKey?.pubKey).toBe('pk-bob');
  });
  it('a hide beside a re-add: the mark and the name both stand', async () => {
    const members = slowMembers();
    const book = createContactBook({ members, dataSource: { read: async () => null, write: async () => {} } });
    await book.addContact({ webid: 'bob', pubKey: 'bob' });
    await Promise.all([book.setHidden('bob', true), book.addContact({ webid: 'bob', displayName: 'Bob' })]);
    const row = await members.resolveByWebid('bob');
    expect(row.hidden).toBe(true);
    expect(row.displayName).toBe('Bob');
  });
});
