/**
 * THE KEYLESS ROW IN THE CONTACT BOOK — every book method over one keyless contact.
 *
 * A person a hosting bot admitted through a door without a key (a Telegram user) is a contact row: a door-shaped
 * webid (`telegram:<uid>`), the door (`channel`), a role, and no `pubKey`. The contact type declares that shape
 * (`KEYLESS_CONTACT_EXAMPLE` in `@onderling/item-types`); here every method of the book runs over it. Each one works
 * or refuses with a reason — none throws on it, none invents a key for it. And one row per person: admitting the
 * same uid again returns the row it has.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { MemberMap } from '@onderling/identity-resolver';
import { KEYLESS_CONTACT_EXAMPLE, isKeylessContact } from '@onderling/item-types';
import { createContactBook } from '../src/lib/ContactBook.js';
import { resolve as resolveTargets, isAddressedToMe } from '../src/lib/targetResolver.js';
import { createNeighbourhoodAgent } from '../src/index.js';

const K = KEYLESS_CONTACT_EXAMPLE;
/** What an admit hands the book: the row's own fields, not the item's envelope. */
const admit = { webid: K.webid, displayName: K.displayName, channel: K.channel, role: K.role };

/** A memory data source — lists live there. */
function memorySource() {
  const blobs = new Map();
  return {
    read: async (p) => blobs.get(p) ?? null,
    write: async (p, v) => { blobs.set(p, v); },
    delete: async (p) => { blobs.delete(p); },
    list: async (prefix) => [...blobs.keys()].filter((k) => k.startsWith(prefix)),
  };
}

let members; let book;
beforeEach(() => {
  members = new MemberMap();
  book = createContactBook({ members, dataSource: memorySource() });
});

const noKey = (row) => {
  expect(row.pubKey ?? null, 'a key was invented').toBeNull();
  expect(row.peerAddr ?? null).toBeNull();
  expect(row.personKey ?? null).toBeNull();
  expect(isKeylessContact(row)).toBe(true);
};

describe('admitting a keyless person', () => {
  it('keeps the door and the role — a field the member map does not name is dropped in silence', async () => {
    const row = await book.addContact(admit);
    expect(row).toMatchObject({ webid: K.webid, displayName: K.displayName, channel: 'telegram', role: 'member', relation: 'contact' });
    noKey(row);
    expect(await members.resolveByWebid(K.webid)).toMatchObject({ channel: 'telegram', role: 'member' });
  });

  it('one row per person: a second admit for the same uid returns the row, and a bare re-add keeps its door and role', async () => {
    await book.addContact(admit);
    const again = await book.addContact({ webid: K.webid });
    expect(again).toMatchObject({ channel: 'telegram', role: 'member', displayName: K.displayName });
    expect((await book.listContacts()).filter((c) => c.webid === K.webid)).toHaveLength(1);
  });

  it('refuses a door outside the closed set, and a role core does not know — with a reason', async () => {
    await expect(book.addContact({ ...admit, channel: 'sms' })).rejects.toThrow(/channel/);
    await expect(book.addContact({ ...admit, role: 'overlord' })).rejects.toThrow(/role/);
    expect(await members.resolveByWebid(K.webid)).toBeNull();
  });
});

describe('every book method over the keyless row', () => {
  beforeEach(async () => { await book.addContact(admit); });

  it('the lists: all, by tag, by trust', async () => {
    expect((await book.listContacts()).map((c) => c.webid)).toEqual([K.webid]);
    expect(await book.listContactsByTag('koor')).toEqual([]);
    expect(await book.listContactsByMinTrust('bekend')).toEqual([]);
  });

  it('trust, tags, flags, persona — each works and none gives the row a key', async () => {
    noKey(await book.setTrustLevel(K.webid, 'bekend'));
    noKey(await book.setTags(K.webid, ['huis']));
    noKey(await book.setFlag(K.webid, 'allowAutomatching', false));
    noKey(await book.setPersona(K.webid, 'default', { personaAt: 1 }));
    expect((await book.listContactsByTag('huis')).map((c) => c.webid)).toEqual([K.webid]);
    expect((await book.listContactsByMinTrust('bekend')).map((c) => c.webid)).toEqual([K.webid]);
    expect(await members.resolveByWebid(K.webid)).toMatchObject({ channel: 'telegram', role: 'member' });
  });

  it('hide and show — the row stays, keyless', async () => {
    const hidden = await book.setHidden(K.webid, true, 10, { deleted: true });
    expect(hidden).toMatchObject({ hidden: true, hiddenAt: 10, deletedAt: 10, channel: 'telegram' });
    noKey(hidden);
    noKey(await book.setHidden(K.webid, false, 20));
  });

  it('contact lists hold it by its webid', async () => {
    const l = await book.createList('huis');
    expect((await book.addToList(l.listId, K.webid)).contactWebids).toEqual([K.webid]);
    expect((await book.removeFromList(l.listId, K.webid)).contactWebids).toEqual([]);
  });

  it('the audience resolver reaches it by webid, and a post from it is addressed to me', async () => {
    await book.setTrustLevel(K.webid, 'vertrouwd');
    const r = await resolveTargets([{ kind: 'contacts', minTrust: 'bekend' }], { members, contacts: book, selfWebid: 'me' });
    expect(r.errors).toEqual([]);
    expect([...r.recipients]).toEqual([K.webid]);
    expect(await isAddressedToMe([{ kind: 'contacts', minTrust: 'bekend' }], { selfWebid: 'me', senderWebid: K.webid, contacts: book })).toBe(true);
  });
});

describe('hiding someone the book does not hold yet', () => {
  it('a door-shaped id gets its door on the placeholder, never its id as a key', async () => {
    const row = await book.setHidden('telegram:777', true, 5);
    expect(row).toMatchObject({ webid: 'telegram:777', channel: 'telegram', hidden: true });
    noKey(row);
  });

  it('any other id is still its own chat key (a stranger who wrote over the mesh)', async () => {
    const row = await book.setHidden('stranger-key', true, 5);
    expect(row.pubKey).toBe('stranger-key');
  });
});

describe('through the stoop skills', () => {
  async function bundleFor(actor) {
    const id = await AgentIdentity.generate(new VaultMemory());
    const bundle = await createNeighbourhoodAgent({
      identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
      offeringMatch: { group: 'g', localActor: actor, peers: [] },
      members: [{ webid: actor }],
    });
    const call = (op, args) => bundle.agent.skills.get(op).handler({ parts: [DataPart(args)], from: actor, agent: bundle.agent, envelope: null });
    return { bundle, call };
  }

  it('addContact persists the door and the role; listContacts returns one row per person; a bad door is refused with a reason', async () => {
    const { call } = await bundleFor('me');
    const first = await call('addContact', admit);
    expect(first.contact).toMatchObject({ webid: K.webid, channel: 'telegram', role: 'member' });
    noKey(first.contact);
    await call('addContact', admit);
    const { contacts } = await call('listContacts', {});
    expect(contacts.filter((c) => c.webid === K.webid)).toHaveLength(1);
    expect(contacts.find((c) => c.webid === K.webid)).toMatchObject({ channel: 'telegram', role: 'member' });
    const bad = await call('addContact', { ...admit, webid: 'telegram:9', channel: 'sms' });
    expect(bad.error).toMatch(/channel/);
  });

  it('hide, persona, tags, flag, trust skills each answer with the row, keyless', async () => {
    const { call } = await bundleFor('me');
    await call('addContact', admit);
    for (const [op, args] of [
      ['setContactHidden', { webid: K.webid, hidden: true }],
      ['setContactPersona', { webid: K.webid, persona: 'default' }],
      ['setContactTags', { webid: K.webid, tags: ['huis'] }],
      ['setContactFlag', { webid: K.webid, flag: 'shareLocation', value: false }],
      ['setContactTrust', { webid: K.webid, level: 'bekend' }],
    ]) {
      const r = await call(op, args);
      expect(r.error, op).toBeUndefined();
      noKey(r.contact);
    }
  });
});
