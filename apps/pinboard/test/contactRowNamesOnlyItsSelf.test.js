/**
 * A CONTACT ROW NAMES ONLY ITS OWN SELF. The book's rows ride the lane of the self they are written as, so a row on the
 * general self's lane must carry nothing of a persona's — neither its id nor its key — or a device holding only the
 * general self (a box) would learn the persona from its own store. Filed under a persona, then re-filed under the
 * general self and back: at every step, each stored row holds its own self's id and key and no other's.
 */
import { describe, it, expect } from 'vitest';
import { createContactBook } from '../src/lib/ContactBook.js';

const W = 'p-werk';
const SELVES = { default: { id: 'default', writer: 'key-general' }, [W]: { id: W, writer: 'key-werk' } };
const selfFor = (persona) => (!persona || persona === 'default' ? SELVES.default : SELVES[persona] ?? null);

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async put(item, { by } = {}) { const row = { createdAt: Date.now(), ...item, createdBy: item.createdBy ?? by }; rows.set(row.id, row); return row; },
    async get(id) { return rows.get(id) ?? null; },
    async delete(id) { rows.delete(id); },
    async listByType(type) { return [...rows.values()].filter((r) => r.type === type); },
  };
}

const otherSelf = (selfId) => Object.values(SELVES).filter((s) => s.id !== selfId);

function expectEachRowNamesOnlyItsSelf(store) {
  for (const row of store.rows.values()) {
    const selfId = row.id.slice(0, row.id.indexOf(':'));
    expect(row.createdBy, `${row.id} is written as its own self`).toBe(SELVES[selfId].writer);
    const text = JSON.stringify(row);
    for (const other of otherSelf(selfId)) {
      expect(text.includes(other.id), `${row.id} names another self's id`).toBe(false);
      expect(text.includes(other.writer), `${row.id} carries another self's key`).toBe(false);
    }
  }
}

describe('a contact row names only its own self', () => {
  it('filed under a persona, re-filed under the general self, and back: one row each time, naming only its self', async () => {
    const store = memoryStore();
    const book = createContactBook({ store: () => store, selfFor });
    await book.addContact({ webid: 'w:bea', displayName: 'Bea', persona: W, personaAt: 1 });
    expect([...store.rows.keys()]).toEqual([`${W}:w:bea`]);
    expectEachRowNamesOnlyItsSelf(store);

    await book.setPersona('w:bea', 'default', { personaAt: 2 });
    expect([...store.rows.keys()], 'the persona\'s row is deleted, the general self\'s written').toEqual(['default:w:bea']);
    expectEachRowNamesOnlyItsSelf(store);

    await book.setPersona('w:bea', W, { personaAt: 3 });
    expect([...store.rows.keys()]).toEqual([`${W}:w:bea`]);
    expectEachRowNamesOnlyItsSelf(store);
  });
});
